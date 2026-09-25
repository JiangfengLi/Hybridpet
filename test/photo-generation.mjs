import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import {normalizeOffspring,createTripoClient} from '../tripo-runtime.mjs';
import {readPhoto} from '../photo-input.mjs';
import {runGame,DRIVER_HEAD,DRIVER_FOOTER} from './harness.mjs';

await assert.rejects(()=>readPhoto({type:'text/plain',size:100}),/PNG/);
await assert.rejects(()=>readPhoto({type:'image/png',size:11*1024*1024}),/10 MB/);
const source=new THREE.Group();
source.add(new THREE.Mesh(new THREE.BoxGeometry(4,2,1),new THREE.MeshStandardMaterial()));
const normalized=normalizeOffspring(THREE,source,{x:2,y:2,z:2,preserveAspect:true});
const size=new THREE.Box3().setFromObject(normalized).getSize(new THREE.Vector3());
assert.deepEqual(size.toArray(),[2,1,.5]);
const images={a:'data:image/png;base64,aGVhZA==',b:'data:image/png;base64,cG9zZQ=='};
let posts=0,polls=0;
const client=createTripoClient({required:true,pause:async()=>{},fetcher:async(path,options)=>{
  if(path.endsWith('/config'))return {ok:true,json:async()=>({configured:true,token:'local'})};
  if(options.method==='POST') {
    posts++;
    assert.equal(options.headers['X-Tripo-Token'],'local');
    assert.equal(JSON.parse(options.body).mode,'creative_fusion');
    assert.deepEqual(JSON.parse(options.body).images,images);
    return {ok:true,json:async()=>({status:'uploading',progress:0})};
  }
  polls++;return {ok:true,json:async()=>({status:'rejected',error:'upload unavailable'})};
}});
await assert.rejects(()=>client.generate({id:'photos',mode:'creative_fusion',genome:[],prompt:'photo',images},{}),/upload unavailable/);
assert.equal(posts,1);assert.equal(polls,1);
console.log('ok   photo validation, aspect ratio, creative-fusion serialization and upload polling');

await runGame(`
${DRIVER_HEAD}
tripoClient.required=true;
const calls=[];
tripoClient.generate=(job,box,progress,resume)=>new Promise((resolve,reject)=>
  calls.push({job,box,progress,resume,resolve,reject}));
const at=id=>{
  const pos=CHAMBER_POSITIONS[id];
  player.x=pos.x;player.z=pos.z-9;player.y=0;
  camera.position.set(player.x,EYE,player.z);camera.lookAt(pos.x,2.6,pos.z);
  camera.updateMatrixWorld(true);chamberSystem.tick(1/60);
};
const images={a:'person-image',b:'pose-image'};
at(0);
chamberSystem.interact();
ok(photoInput.open&&calls.length===0,'E opens photo picker without paid submission');
const x=player.x,z=player.z;
fire('window','keydown',{code:'KeyW',preventDefault(){}});
loop();
ok(player.x===x&&player.z===z,'picker blocks gameplay input');
photoInput.close();
ok(chamberSystem.startPhotos(0,images),'empty nearby pod accepts two views');
ok(!chamberSystem.startPhotos(0,images)&&calls.length===1,'double submit blocked');
ok(calls[0].job.mode==='creative_fusion'&&calls[0].box.preserveAspect,'creative fusion retains proportions');
ok(calls[0].job.images.a==='person-image'&&calls[0].job.images.b==='pose-image','reference order is preserved without fixed head/body roles');
ok(!chamberSystem.startPhotos(2,images),'remote pod cannot accept photo submission');
const firstId=calls[0].job.id;
calls[0].progress({status:'rejected',submission_status:'rejected'});
calls[0].reject(new Error('upload failed'));await tick();chamberSystem.tick(1/60);
ok(chamberSystem.status(0).phase==='error','upload failure is recoverable in pod');
chamberSystem.interact();
ok(calls.length===2&&calls[1].resume&&calls[1].job.id===firstId,'retry preserves images and job ID');
calls[1].resolve({model:buildOffspringBody(calls[1].job.genome),taskId:'photo-model-01',
  modelUrl:'/api/tripo/models/photo.glb',triangles:520});
await tick();chamberSystem.tick(1/60);
const baby=chamberSystem.child;
ok(chamberSystem.status(0).phase==='complete'&&baby?.modelTaskId==='photo-model-01','photo model appears without parents or fusion film');
ok(baby.parentSpecies.length===0&&baby.generationSource==='creative_fusion','photo creature records its true origin');
ok(!chamberSystem.cinematic,'no parent-only cinematic');
for(let i=0;i<3;i++)chamberSystem.tick(1/60);
ok(chamberSystem.child===baby,'no duplicate birth on later frames');
mag.length=MAG_MAX;pals.length=BAG_MAX;
ok(!chamberSystem.collect()&&chamberSystem.child===baby,'full inventory retains photo creature');
mag.length=0;pals.length=0;
ok(chamberSystem.collect()&&mag.includes(baby),'photo creature enters normal inventory');
ok(chamberSystem.status(0).phase==='loading','collection releases pod');
breeding.slots[0]=baby;
ok(!chamberSystem.startPhotos(0,images),'occupied parent pod cannot be overwritten');
breeding.slots[1]=animals.find(a=>a!==baby&&!a.captured);
ok(startMate(0)&&confirmMateRadiation(0),'photo creature participates in existing breeding');
abortOffspringGeneration(breeding.pairs[0]);
calls[2].resolve({model:buildOffspringBody(calls[2].job.genome),taskId:'discarded'});await tick();
${DRIVER_FOOTER}
`,{search:'?autostart=1&intro=0&pos=0,14'});
