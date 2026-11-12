import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten,join,dedup,prune,getBounds,weld,simplify,textureCompress} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
const [input, output, kind] = process.argv.slice(2);
if (!input || !output || !['cockpit','passenger'].includes(kind)) throw Error('Usage: node scripts/optimize-interior.mjs input.glb output.glb cockpit|passenger');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.read(input), root=doc.getRoot(), before=getBounds(root.getDefaultScene());
console.log('before',root.listNodes().length,root.listMeshes().length,JSON.stringify(before));
if(kind==='cockpit') for(const m of root.listMaterials()) if(['generic_glass','glass_t1'].includes(m.getName())) { const factor=m.getBaseColorFactor(); factor[3]=0; m.setBaseColorFactor(factor).setAlphaMode('BLEND'); }
await MeshoptSimplifier.ready;
await doc.transform(flatten(),join(),dedup(),weld(),simplify({simplifier:MeshoptSimplifier,ratio:kind==='passenger'?.55:.8,error:.0003,lockBorder:true}),prune(),textureCompress({encoder:sharp,targetFormat:'webp',quality:88,effort:4}));
const after=getBounds(root.getDefaultScene());console.log('after',root.listNodes().length,root.listMeshes().length,JSON.stringify(after));
if(['min','max'].some(k=>before[k].some((v,i)=>Math.abs(v-after[k][i])>.03)))throw Error('Unexpected change in overall bounds');
await io.write(output,doc);
