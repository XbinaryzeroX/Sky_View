// Build the annual photographic globe fallback and a coastline mask for the older land mosaic.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { feature } from 'topojson-client';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const output = new URL('../public/optical-water/', import.meta.url);
const cache = join(tmpdir(), 'atlas-public-optical-observations-v1');
await Promise.all([mkdir(output, {recursive:true}), mkdir(cache, {recursive:true})]);
const width = 4320, height = 2160;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [];
async function download(url) {
  const name = join(cache,digest(url));
  let data;
  try { data = await readFile(name); }
  catch {
    const response = await fetch(url,{signal:AbortSignal.timeout(180000)});
    assert.equal(response.status,200,url);
    data = Buffer.from(await response.arrayBuffer());
    assert(data.length > 7000 && data.length < 100_000_000, url);
    await writeFile(name,data);
  }
  sources.push({url,sha256:digest(data)});
  return data;
}
async function band(year, nm) {
  const path = 'https://www.oceancolour.org/thredds/dodsC/cci/v6.0-release/geographic/annual/rrs/' + year +
    '/ESACCI-OC-L3S-RRS-MERGED-1Y_YEARLY_4km_GEO_PML_RRS-' + year + '-fv6.0.nc';
  // Every second cell from the native 4 km grid. DAP2 arrays carry two XDR element counts.
  const field = 'Rrs_' + nm;
  const data = await download(path + '.dods?' + field + '.' + field + '%5B0%5D%5B1:2:4319%5D%5B1:2:8639%5D');
  const end = data.indexOf('Data:\n');
  assert(end > 0 && data.toString('ascii',0,end).includes('Float32 '+field));
  const offset = end+6;
  assert.equal(data.readUInt32BE(offset),width*height);
  assert.equal(data.readUInt32BE(offset+4),width*height);
  assert.equal(data.length-offset-8,width*height*4);
  return data.subarray(offset+8);
}
async function opticalBackdrop(year) {
  const pixels = Buffer.alloc(width*height*4);
  const minimum = new Uint16Array(width*height).fill(65535);
  const second = new Uint16Array(width*height).fill(65535);
  const runnerUp = Buffer.alloc(width*height*4);
  const count = new Uint8Array(width*height);
  // Select one complete RGB observation per pixel. Clouds and sunglint tend to have the
  // highest visible-band brightness. Keep dark valid returns from different passes and seasons.
  for (const day of ['01-15','03-22','05-18','07-15','09-22','11-18']) {
    const params = new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',
      LAYERS:'MODIS_Terra_CorrectedReflectance_TrueColor',STYLES:'',SRS:'EPSG:4326',BBOX:'-180,-90,180,90',
      WIDTH:'2160',HEIGHT:'1080',FORMAT:'image/png',TRANSPARENT:'TRUE',TIME:year+'-'+day});
    const data = await download('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?'+params);
    const rgb = await sharp(data).ensureAlpha().resize(width,height,{kernel:'nearest'}).raw().toBuffer();
    for(let i=0;i<minimum.length;i++) {
      const p=i*4, score=rgb[p]+rgb[p+1]+rgb[p+2];
      // NASA GIBS encodes the detector and polar-night gaps in black.
      if(rgb[p+3]===0 || score < 5) continue;
      count[i]++;
      if(score < minimum[i]) {
        second[i]=minimum[i]; pixels.copy(runnerUp,p,p,p+4);
        minimum[i]=score; rgb.copy(pixels,p,p,p+4);
      } else if(score < second[i]) {
        second[i]=score; rgb.copy(runnerUp,p,p,p+4);
      }
    }
  }
  // A second clear sample avoids single anomalously dark scan-edge observations.
  for(let i=0;i<count.length;i++) if(count[i]>=4) runnerUp.copy(pixels,i*4,i*4,i*4+4);
  return pixels;
}
for(const year of [2020,2021]) {
  const [r,g,b] = await Promise.all([665,560,490].map(nm=>band(year,nm)));
  const pixels = await opticalBackdrop(year);
  let waterSamples=0, gaps=0;
  for(let p=0;p<pixels.length;p+=4) {
    const red=r.readFloatBE(p),green=g.readFloatBE(p),blue=b.readFloatBE(p);
    // Rrs is in sr^-1. Convert to water-leaving reflectance, and use the same linear
    // 0–0.26 display range as the overlying Terrascope Sentinel-2 true-colour tiles.
    if([red,green,blue].every(v=>Number.isFinite(v)&&v>=-.02&&v<1)) {
      const scale=Math.PI*255/.26;
      pixels[p]=Math.min(255,Math.max(0,Math.round(red*scale)));
      pixels[p+1]=Math.min(255,Math.max(0,Math.round(green*scale)));
      pixels[p+2]=Math.min(255,Math.max(0,Math.round(blue*scale)));
      pixels[p+3]=255;
      waterSamples++;
    }
    if(!pixels[p+3]) gaps++;
  }
  assert(waterSamples>4_000_000);
  for(let z=0;z<=2;z++) {
    const rows=2**z, side=height/rows;
    for(let y=0;y<rows;y++){
      const dir=join(fileURLToPath(output),String(year),String(z),String(y));
      await mkdir(dir,{recursive:true});
      for(let x=0;x<rows*2;x++){
        const tile=await sharp(pixels,{raw:{width,height,channels:4}}).extract({left:x*side,top:y*side,width:side,height:side})
          .resize(540,540).webp({quality:95,alphaQuality:100}).toBuffer();
        await writeFile(join(dir,x+'.webp'),tile);
      }
    }
  }
  console.log({year,width,height,waterSamples,gaps});
}
// This mask only controls where the NASA LAND reference can cover the photographic background.
// Erode it by a few km so the older, generalized bathymetric shoreline cannot bleed out to sea.
const land=require('world-atlas/land-10m.json'), geometry=feature(land,land.objects.land).features[0].geometry;
const size=8192;
const project=([lon,lat])=>[(lon+180)/360*size,(1-Math.asinh(Math.tan(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180))/Math.PI)*size/2];
function polygonPath(polygon) {
  const path=polygon.map(ring=>ring.map((point,i)=>{const [x,y]=project(point);return (i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)}).join('')+'Z').join('');
  return '<path d="'+path+'" fill-rule="evenodd"/>';
}
const shapes = geometry.coordinates.map(polygonPath).join('');
// The land dataset includes inland lakes. Cut the published lake polygons out, retaining
// islands, so the same optical observations are visible on both coasts and inland water.
const lakePaths = [];
for (const name of ['lakes', 'lakes_europe', 'lakes_north_america', 'lakes_australia']) {
  const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_' + name + '.geojson';
  const collection = JSON.parse((await download(url)).toString('utf8'));
  for (const { geometry: lake } of collection.features) {
    const polygons = lake.type === 'Polygon' ? [lake.coordinates] : lake.coordinates;
    for (const polygon of polygons) lakePaths.push(polygonPath(polygon));
  }
}
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">' +
  '<g fill="white" stroke="black" stroke-width="3" stroke-linejoin="round">'+shapes+'</g>' +
  '<g fill="black" stroke="black" stroke-width="0.6">'+lakePaths.join('')+'</g></svg>');
const mask=await sharp(svg,{limitInputPixels:100_000_000}).flatten({background:'black'}).greyscale().raw().toBuffer();
const transparentTile = await sharp(Buffer.alloc(4), {raw:{width:1,height:1,channels:4}}).png().toBuffer();
for(let z=0;z<=3;z++) {
  const rows=2**z, side=size/rows;
  for(let y=0;y<rows;y++){
    const dir=join(fileURLToPath(output),'land',String(z),String(y));
    await mkdir(dir,{recursive:true});
    for(let x=0;x<rows;x++){
      const stencil = await sharp(mask,{raw:{width:size,height:size,channels:1}}).extract({left:x*side,top:y*side,width:side,height:side})
        .resize(1024,1024).greyscale().raw().toBuffer();
      let tile = transparentTile;
      if (stencil.some(value => value !== 0)) {
        const alpha = Buffer.alloc(stencil.length * 2, 255);
        for (let i=0; i<stencil.length; i++) alpha[i*2+1] = stencil[i];
        tile = await sharp(alpha,{raw:{width:1024,height:1024,channels:2}}).png({palette:true}).toBuffer();
      }
      await writeFile(join(dir,x+'.png'),tile);
    }
  }
}
await writeFile(new URL('SOURCES.json',output),JSON.stringify({years:[2020,2021],width,height,
  description:'ESA OC-CCI annual Rrs (665/560/490 nm, 4 km native grid sampled at 1/12 degree); six sampled NASA Terra MODIS RGB dates, selecting the second-darkest observation where four or more are present, in coverage gaps.',
  attribution:'The European Space Agency (ESA) Climate Change Initiative (CCI) Ocean Colour data are developed and produced through funding and resources from ESA, Copernicus Climate Change Service (C3S) and the NERC EO Data Analysis and AI Service (NEODAAS). NASA EOSDIS GIBS / Terra MODIS. Land mask: Natural Earth, public domain.',
  sources},null,2)+'\n');
