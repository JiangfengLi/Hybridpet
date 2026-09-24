import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import {normalizeOffspring, cloneOffspring, createTripoClient} from '../tripo-runtime.mjs';
import {runGame,DRIVER_HEAD,DRIVER_FOOTER} from './harness.mjs';

const source=new THREE.Group();
for(const x of [-2,2]) {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshStandardMaterial({color:0x77ffaa}));
  mesh.position.set(x,1,0);source.add(mesh);
}
const shape=normalizeOffspring(THREE,source,{x:5,y:3,z:2});
const box=new THREE.Box3().setFromObject(shape),size=box.getSize(new THREE.Vector3());
assert.ok(Math.abs(size.x-5)<1e-6&&Math.abs(size.y-3)<1e-6&&Math.abs(size.z-2)<1e-6);
assert.equal(box.min.y,0);
assert.equal(shape.userData.body.children.length,2);
const copy=cloneOffspring(THREE,shape);
assert.notEqual(copy.userData.body,shape.userData.body);
copy.userData.body.children[0].geometry.translate(1,0,0);
assert.notDeepEqual(copy.userData.body.children[0].geometry.attributes.position.array,shape.userData.body.children[0].geometry.attributes.position.array);
assert.equal(source.children[0].position.x,-2);
console.log('ok   full-scene normalization, mesh placement, materials and private copies');

let submits=0;
const client=createTripoClient({required:true,pause:async()=>{},fetcher:async(path,opts)=>{
  if(path.endsWith('/config'))return {ok:true,json:async()=>({configured:true,token:'local-token'})};
  if(opts.method==='POST')submits++;
  return {ok:true,json:async()=>({status:'unconfirmed',error:'submission unknown'})};
}});
await assert.rejects(()=>client.generate({id:'test',genome:[],prompt:'test'},{}),/submission unknown/);
assert.equal(submits,1);
console.log('ok   unconfirmed submission stops without automatic resubmission');

for (const [status, confirmed, expectedRetries] of [
  ['unconfirmed',false,0], ['unconfirmed',true,1], ['rejected',false,1],
]) {
  let retries=0, prompts=0;
  const retryClient=createTripoClient({required:true,
    confirmUnsubmitted:()=>{prompts++;return confirmed;},
    fetcher:async(path,options)=>{
      if(path.endsWith('/config'))return {ok:true,json:async()=>({configured:true,token:'local-token'})};
      if(path.endsWith('/resume')) {
        retries++;
        assert.equal(JSON.parse(options.body).confirm_unsubmitted,confirmed);
        return {ok:true,json:async()=>({status:'failed',error:'retry reached server'})};
      }
      return {ok:true,json:async()=>({status,can_retry:status==='rejected',error:'original error'})};
    },
  });
  await assert.rejects(()=>retryClient.generate({id:'same-id',genome:[0],prompt:'same genes'}, {},()=>{},true),
    expectedRetries?/retry reached server/:/original error/);
  assert.equal(retries,expectedRetries);
  assert.equal(prompts,status==='unconfirmed'?1:0);
}
console.log('ok   explicit retry of rejected requests; unknown submissions require confirmation');

await runGame(`
${DRIVER_HEAD}
tripoClient.required=true;
const calls=[];
tripoClient.generate=(job,box,progress,resume)=>new Promise((resolve,reject)=>calls.push({job,box,progress,resume,resolve,reject}));
const parents=['slime-ring','slime-ball'].map(key=>animals.find(a=>a.species.key===key));
breeding.slots[0]=parents[0];breeding.slots[1]=parents[1];
ok(startMate(0),'online breeding starts');
ok(calls.length===0&&breeding.pairs[0].state==='irradiating',
  'starting a pair does not submit a paid generation before confirmation');
ok(confirmMateRadiation(0),'confirm base mutation rate before submitting');
const pr=breeding.pairs[0],genome=JSON.stringify(pr.genome),id=pr.generation.id;
breedAdvance(BREED_MS+1);
ok(pr.state==='running'&&!birthOffspring(0,'chamber'),'timer alone cannot birth a placeholder');
ok(pr.ms===0,'online generation no longer advances a local countdown');
calls[0].progress({status:'running',progress:47});
ok(offspringProgress(pr).percent===47&&!offspringProgress(pr).offline,'display uses real API percentage');
calls[0].progress({status:'success',progress:100});
ok(offspringProgress(pr).percent===100&&offspringProgress(pr).stage==='loading'&&pr.state==='running',
  'API 100 percent still waits for successful local model parsing');
calls[0].reject(new Error('network interrupted'));await tick();
ok(pr.generation.status==='error'&&JSON.stringify(pr.genome)===genome,'failure retains fixed genes');
void generateOffspringModel(pr,true);
ok(calls[1].job.id===id&&calls[1].resume,'retry uses the same request ID');
calls[1].resolve({model:buildOffspringBody(pr.genome),taskId:'remote-123',modelUrl:'/api/tripo/models/test.glb',triangles:520});await tick();
ok(pr.state==='ready'&&pr.ms===0,'loaded model unlocks birth without waiting for a local timer');
const baby=birthOffspring(0,'chamber');
ok(baby?.modelTaskId==='remote-123'&&baby.species.key==='offspring-remote-123','child carries unique generated species and model identity');
ok(JSON.stringify(baby.genome)===genome,'birth preserves exact genome');
ok(!birthOffspring(0,'chamber'),'no duplicate child');
breeding.slots[0]=baby;
ok(startMate(0)&&confirmMateRadiation(0)&&pr.generation.id!==id,'generated child can breed a new request');
const oldJob=pr.generation;
abortOffspringGeneration(pr);
calls[2].resolve({model:buildOffspringBody(oldJob.genome),taskId:'stale'});await tick();
ok(pr.state==='idle'&&!pr.model&&!pr.genome,'stale response cannot resurrect an abandoned attempt');
${DRIVER_FOOTER}
`);

await runGame(`
${DRIVER_HEAD}
sec('Three pods retain independent generated models and recovery controls');
tripoClient.required=true;
const calls=[];
tripoClient.generate=(job,box,progress,resume)=>new Promise((resolve,reject)=>
  calls.push({job,box,progress,resume,resolve,reject}));
const step=(n=1)=>{for(let i=0;i<n;i++)chamberSystem.tick(1/60);};
const at=(id,slot=0)=>{
  const pos=CHAMBER_POSITIONS[id];
  player.x=pos.x;player.z=pos.z-9;player.y=0;
  camera.position.set(player.x,EYE,player.z);
  camera.lookAt(pos.x+(slot===0?1.64:-1.64),2.6,pos.z);
  camera.updateMatrixWorld(true);
};
const parents=animals.filter(a=>!a.captured&&!a.launch).slice(0,6);
parents.forEach(captureAnimal);
for(let id=0;id<3;id++) {
  at(id,0);chamberSystem.fire();
  at(id,1);chamberSystem.fire();
  at(id);chamberSystem.interact();
  step(90);chamberSystem.confirmRadiation();
}
ok(calls.length===3&&new Set(calls.map(call=>call.job.id)).size===3,
  'each pod submits one unique generation request');
const plans=breeding.pairs.map(pair=>JSON.stringify(pair.genome));
breedAdvance(BREED_MS);step(120);
ok(chamberSystem.status().chambers.every(pod=>pod.phase==='generating'),
  'all pods wait for their own model after the countdown');
const resolveModel=(call,id)=>call.resolve({
  model:buildOffspringBody(call.job.genome),taskId:'remote-pod-'+id,
  modelUrl:'/api/tripo/models/pod-'+id+'.glb',triangles:520,
});
resolveModel(calls[2],2);await tick();step();
ok(chamberSystem.status(2).phase==='ready'&&chamberSystem.status(0).phase==='generating',
  'out-of-order completion unlocks only its own pod');
calls[1].progress({status:'unconfirmed',submission_status:'unconfirmed'});
calls[1].reject(new Error('pod 02 interrupted'));await tick();at(1);step();
ok(chamberSystem.status(1).phase==='error'&&el('chamber-countdown').textContent==='pod 02 interrupted',
  'selected pod displays its own generation failure');
ok(el('chamber-interact').textContent==='核对后重试','unknown submission offers console-check recovery');
breeding.pairs[1].generation.submission_status='rejected';step();
ok(el('chamber-interact').textContent==='重试提交','rejected submission offers explicit retry');
const originalId=calls[1].job.id;
chamberSystem.interact();
ok(calls.length===4&&calls[3].job.id===originalId&&calls[3].resume,
  'retry queries the selected pod request without rerolling');
ok(JSON.stringify(breeding.pairs[1].genome)===plans[1],'retry keeps fixed genetics');
resolveModel(calls[0],0);calls[3].reject(new Error('still interrupted'));await tick();step();
camera.lookAt(player.x,EYE,player.z-10);camera.updateMatrixWorld(true);step();
fire('chamber-suck','click');
ok(chamberSystem.status(1).phase==='loading'&&!breeding.pairs[1].generation,
  'error HUD can end the nearby selected attempt without aiming at a slot');
ok(chamberSystem.status(0).phase==='ready'&&chamberSystem.status(2).phase==='ready',
  'ending one attempt preserves other ready models');
at(1);chamberSystem.interact();
step(90);chamberSystem.confirmRadiation();
ok(calls.length===5&&calls[4].job.id!==originalId,'next attempt gets a new request ID');
plans[1]=JSON.stringify(breeding.pairs[1].genome);
resolveModel(calls[4],1);await tick();breedAdvance(BREED_MS);step(120);
for(const id of [2,0,1]) {
  at(id);chamberSystem.interact();
  for(let i=0;i<100&&chamberSystem.status(id).performance.progress<1;i++)chamberSystem.boost();
  ok(chamberSystem.status(id).performance.progress===1,'generated model presentation completes its progress bar '+id);
  for(let i=0;i<1600&&chamberSystem.cinematic;i++)step();
  const baby=chamberSystem.child;
  ok(chamberSystem.status(id).phase==='complete'&&baby?.modelTaskId==='remote-pod-'+id,
    'presentation and birth retain model ownership for pod '+id);
  ok(!!baby&&JSON.stringify(baby.genome)===plans[id],'birth retains matching genome '+id);
  step(90);
  ok(chamberSystem.collect()&&mag.includes(baby),'collect generated offspring '+id);
}
ok(mag.length===3&&new Set(mag.map(baby=>baby.modelTaskId)).size===3,
  'three separate model identities survive shared-player switching');
ok(breeding.slots.every((parent,id)=>parent===parents[id]),'all original parents remain');
${DRIVER_FOOTER}
`,{search:'?autostart=1&intro=0&pos=0,14&breed=5'});
