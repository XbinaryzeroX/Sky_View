import { Resource, UrlTemplateImageryProvider, type Request } from 'cesium';
import { oceanMask } from './vectorTiles';

const SIZE = 256, PAD = 28, EDGE = SIZE + 2 * PAD;
const HALF_WORLD = Math.PI * 6378137;
type Year = 2020 | 2021;
interface Coverage { image: ImageBitmap | OffscreenCanvas; fade: OffscreenCanvas; amount: Uint8ClampedArray }
let pending = 0;
const waiting: (()=>void)[]=[];

async function loadCoverage(year:Year,x:number,y:number,z:number) {
  if(pending >= 4) {
    if(waiting.length>=28) throw Error('Satellite overview queue is full');
    await new Promise<void>((resolve,reject)=>{
      const start=()=>{clearTimeout(timeout);resolve();};
      const timeout=setTimeout(()=>{
        const index=waiting.indexOf(start);
        if(index>=0)waiting.splice(index,1);
        reject(new Error('Satellite overview busy'));
      },2500);
      waiting.push(start);
    });
  } else pending++;
  try { return await coverage(year,x,y,z); }
  finally {
    const next=waiting.shift();
    if(next)next();
    else pending--;
  }
}

export function worldCoverUrl(year: Year) {
  const name = 'esa-worldcover-s2rgbnir-10m-' + year + '-v' + (year === 2020 ? '1' : '2') + '_tcc';
  return 'https://wmts.terrascope.be/?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
    '&layer=' + name + '&style=default&tilematrixset=EPSG%3A3857&format=image%2Fpng&TIME=' + year +
    '-01-01&tilematrix={z}&tilecol={x}&tilerow={y}';
}

// Adjacent native tiles supply real pixels outside the requested coverage footprint.
const nativeTiles = new Map<string, Promise<ImageBitmap>>();
function nativeTile(year: Year, x: number, y: number, level: number) {
  const width = 2 ** level;
  const wrappedX = (x + width) % width;
  const key = `${year}/${level}/${wrappedX}/${y}`;
  let image = nativeTiles.get(key);
  if (!image) {
    const url = worldCoverUrl(year).replace('{z}',String(level)).replace('{x}',String(wrappedX)).replace('{y}',String(y));
    image = fetch(url, {signal:AbortSignal.timeout(9000)}).then(async response => {
      if (!response.ok) throw Error('Native Sentinel-2 tile HTTP '+response.status);
      return createImageBitmap(await response.blob());
    });
    nativeTiles.set(key,image);
    void image.catch(()=>{if(nativeTiles.get(key)===image)nativeTiles.delete(key);});
    if(nativeTiles.size>96)nativeTiles.delete(nativeTiles.keys().next().value!);
  }
  return image;
}

async function coverageFromNative(year: Year, x: number, y: number, level: number) {
  const canvas = new OffscreenCanvas(EDGE,EDGE), ctx = canvas.getContext('2d',{willReadFrequently:true})!;
  const tiles: Promise<void>[] = [];
  const nativeLevel = Math.max(8, level);
  const scale = 2 ** (nativeLevel-level);
  for(let row=-1;row<=scale;row++) for(let col=-1;col<=scale;col++) {
    const childY=scale*y+row;
    if(childY<0 || childY>=2 ** nativeLevel)continue;
    tiles.push(nativeTile(year,scale*x+col,childY,nativeLevel).then(tile=>{
      ctx.drawImage(tile,PAD+col*SIZE/scale,PAD+row*SIZE/scale,SIZE/scale,SIZE/scale);
    }));
  }
  await Promise.all(tiles);
  return makeCoverage(canvas,y,level);
}

async function coverage(year: Year, x: number, y: number, z: number): Promise<Coverage> {
  const metres = 2 * HALF_WORLD / (2 ** z * SIZE);
  const west = -HALF_WORLD + x * SIZE * metres, north = HALF_WORLD - y * SIZE * metres;
  const bbox = [west-PAD*metres, north-(SIZE+PAD)*metres, west+(SIZE+PAD)*metres, north+PAD*metres];
  const layer = 'esa-worldcover-s2rgbnir-10m-' + year + '-v' + (year===2020?'1':'2') + '_tcc';
  const query = new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:layer,STYLES:'',
    FORMAT:'image/png',TRANSPARENT:'TRUE',WIDTH:String(EDGE),HEIGHT:String(EDGE),CRS:'EPSG:3857',BBOX:bbox.join(','),TIME:year+'-01-01'});
  const res = await fetch('https://titiler.terrascope.be/wms?' + query,{signal:AbortSignal.timeout(9000)});
  if (!res.ok) throw Error('Sentinel-2 coverage HTTP '+res.status);
  const image = await createImageBitmap(await res.blob());
  if (image.width !== EDGE || image.height !== EDGE) throw Error('Invalid satellite coverage dimensions');
  return makeCoverage(image,y,z);
}

function makeCoverage(image: ImageBitmap | OffscreenCanvas, y: number, z: number): Coverage {
  const metres = 2 * HALF_WORLD / (2 ** z * SIZE);
  const scratch = new OffscreenCanvas(EDGE,EDGE), ctx=scratch.getContext('2d',{willReadFrequently:true})!;
  ctx.drawImage(image,0,0);
  const rgba=ctx.getImageData(0,0,EDGE,EDGE).data;
  const distance=new Float32Array(EDGE*EDGE);
  for(let i=0;i<distance.length;i++) distance[i]=rgba[i*4+3]<128 ? 0 : EDGE;
  // A two-pass distance transform. The halo contains actual neighbouring source pixels,
  // so a valid edge of a map tile never becomes an artificial edge of the observation.
  for(let y=1;y<EDGE;y++) for(let x=1;x<EDGE-1;x++){
    const i=y*EDGE+x;
    distance[i]=Math.min(distance[i],distance[i-1]+1,distance[i-EDGE]+1,distance[i-EDGE-1]+Math.SQRT2,distance[i-EDGE+1]+Math.SQRT2);
  }
  for(let y=EDGE-2;y>=0;y--) for(let x=EDGE-2;x>=1;x--){
    const i=y*EDGE+x;
    distance[i]=Math.min(distance[i],distance[i+1]+1,distance[i+EDGE]+1,distance[i+EDGE+1]+Math.SQRT2,distance[i+EDGE-1]+Math.SQRT2);
  }
  const lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/2**z)));
  // Keep land photographs and soften real water-coverage gaps over the adjoining
  // imagery. The halo prevents seams at individual map tiles.
  const ramp=Math.max(2,Math.min(PAD-2,11000/(metres*Math.cos(lat))));
  const fade=new OffscreenCanvas(SIZE,SIZE), fg=fade.getContext('2d')!, mask=fg.createImageData(SIZE,SIZE),amount=new Uint8ClampedArray(SIZE*SIZE);
  for(let row=0;row<SIZE;row++)for(let col=0;col<SIZE;col++){
    const n=row*SIZE+col,t=Math.min(1,Math.max(0,(distance[(row+PAD)*EDGE+col+PAD]-.75)/ramp));
    amount[n]=mask.data[n*4+3]=255*(1-t*t*(3-2*t));
  }
  fg.putImageData(mask,0,0);
  return {image,fade,amount};
}

export class WorldCoverImageryProvider extends UrlTemplateImageryProvider {
  private readonly parents=new Map<string,Promise<Coverage>>();
  private readonly unavailable=new Map<string,number>();
  constructor(options:ConstructorParameters<typeof UrlTemplateImageryProvider>[0],private readonly year:Year){super(options);}

  private parent(x:number,y:number,z:number){
    const key=z+'/'+x+'/'+y;
    if((this.unavailable.get(key) ?? 0) > Date.now()) return Promise.reject(new Error('Satellite footprint temporarily unavailable'));
    let p=this.parents.get(key);
    if(!p){
      p=loadCoverage(this.year,x,y,z).catch(error=>{
        if(z>=7)return coverageFromNative(this.year,x,y,z);
        throw error;
      });
      this.parents.set(key,p);
      void p.catch(()=>{
        if(this.parents.get(key)===p)this.parents.delete(key);
        this.unavailable.set(key, Date.now()+60000);
        if(this.unavailable.size>48)this.unavailable.delete(this.unavailable.keys().next().value!);
      });
      if(this.parents.size>32)this.parents.delete(this.parents.keys().next().value!);
    }
    return p;
  }

  override requestImage(x:number,y:number,level:number,request?:Request){
    if(level<5)return createImageBitmap(new ImageData(1,1));
    const parentZ=Math.min(7,level),scale=2**(level-parentZ);
    let source:Promise<ImageBitmap> | undefined;
    if(level>=8){
      const url=worldCoverUrl(this.year).replace('{z}',String(level)).replace('{x}',String(x)).replace('{y}',String(y));
      const data=new Resource({url,request}).fetchBlob();
      if(!data)return undefined;
      source=data.then(blob=>createImageBitmap(blob));
    }
    const footprint=this.parent(Math.floor(x/scale),Math.floor(y/scale),parentZ);
    return this.render(x,y,level,scale,footprint,source);
  }

  private async render(x:number,y:number,level:number,scale:number,footprint:Promise<Coverage>,source?:Promise<ImageBitmap>){
    const [parent,photo]=await Promise.all([footprint.catch(()=>null),source]);
    const canvas=new OffscreenCanvas(SIZE,SIZE),ctx=canvas.getContext('2d')!;
    if(photo){ctx.drawImage(photo,0,0,SIZE,SIZE);photo.close();}
    else if(parent)ctx.drawImage(parent.image,PAD,PAD,SIZE,SIZE,0,0,SIZE,SIZE);
    if(!parent){
      // WMTS is independent of WMS. Preserve its native coastline and real alpha even on
      // islands too small for the global outline. Actual observation gaps reveal the optical base.
      return createImageBitmap(canvas,{imageOrientation:'flipY'});
    }
    const span=SIZE/scale,left=(x%scale)*span,top=(y%scale)*span;
    let fade=false;
    for(let row=Math.floor(top);row<top+span&&!fade;row++)
      for(let col=Math.floor(left);col<left+span;col++) if(parent.amount[row*SIZE+col]){fade=true;break;}
    if(fade){
      const mask=new OffscreenCanvas(SIZE,SIZE),g=mask.getContext('2d')!;
      g.drawImage(parent.fade,left,top,span,span,0,0,SIZE,SIZE);
      const water=await oceanMask(level,x,y,true);
      // Only blend pixels positively identified as water. If the vector service is down,
      // retain the actual source coastline, including its smallest islands.
      if(water){
        g.globalCompositeOperation='destination-in';g.drawImage(water,0,0);
        ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0);
      }
    }
    return createImageBitmap(canvas,{imageOrientation:'flipY'});
  }
}
