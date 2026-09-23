import assert from 'node:assert/strict';
import {mutationRateForRadiation,createInheritancePlan,resolveInheritancePlan} from '../mutation-rate.mjs';
import {runGame,DRIVER_HEAD,DRIVER_FOOTER} from './harness.mjs';

for(const [progress,rate] of [[0,.05],[.25,.1],[.5,.15],[.75,.2],[1,.25],[-1,.05],[2,.25],[NaN,.05]]) {
  assert.ok(Math.abs(mutationRateForRadiation(progress)-rate)<1e-12);
}
const definitions=Array.from({length:6},(_,i)=>({n:i+1,opts:i===0?['fixed']:['a','b','c']}));
const thresholds=[0,.01,.07,.14,.21,.26];
const plan=thresholds.map(roll=>({inherited:0,alternative:1,roll}));
const low=resolveInheritancePlan(definitions,plan,0);
const mid=resolveInheritancePlan(definitions,plan,.5);
const high=resolveInheritancePlan(definitions,plan,1);
assert.deepEqual(low.mutations.map(d=>d.n),[2]);
assert.deepEqual(mid.mutations.map(d=>d.n),[2,3,4]);
assert.deepEqual(high.mutations.map(d=>d.n),[2,3,4,5]);
assert.equal(high.genome[0],0,'single-option loci never mutate');
assert.deepEqual(resolveInheritancePlan(definitions,plan,1),high,'same plan never rerolls');
let draws=0;
const generated=createInheritancePlan(definitions,new Array(6).fill(0),new Array(6).fill(1),
  ()=>{draws++;return .1;});
assert.ok(Object.isFrozen(generated)&&generated.every(Object.isFrozen));
const used=draws;
for(let i=0;i<=100;i++)resolveInheritancePlan(definitions,generated,i/100);
assert.equal(draws,used,'raising progress does not request new random samples');
assert.ok(generated.slice(1).every(locus=>locus.inherited!==locus.alternative));

await runGame(`
${DRIVER_HEAD}
sec('Radiation probability, one submission, retries and independent pods');
tripoClient.required=true;
const calls=[];
tripoClient.generate=(job,box,progress,resume)=>new Promise((resolve,reject)=>
  calls.push({job,box,progress,resume,resolve,reject}));
const step=(n=1)=>{for(let i=0;i<n;i++)chamberSystem.tick(.05);};
const at=id=>{
  const pos=CHAMBER_POSITIONS[id];
  player.x=pos.x;player.z=pos.z-9;player.y=0;
  camera.position.set(player.x,EYE,player.z);
  camera.lookAt(pos.x,2.6,pos.z);camera.updateMatrixWorld(true);
};
const parents=animals.filter(a=>!a.captured&&!a.launch).slice(0,6);
parents.forEach(captureAnimal);
for(let id=0;id<3;id++) {
  at(id);
  for(const x of [1.64,-1.64]) {
    camera.lookAt(player.x+x,2.6,23);camera.updateMatrixWorld(true);chamberSystem.fire();
  }
}
ok(calls.length===0,'sealed pairs do not create early API tasks');
step(40);
at(0);chamberSystem.interact();
const origin=new THREE.Vector3(0,2.7,14),direction=new THREE.Vector3(0,0,1);
for(let i=0;i<100;i++)chamberSystem.sprayWater(origin,direction,1/12,12);
const pair=breeding.pairs[0];
ok(Math.abs(pair.radiation-.5)<1e-10&&Math.abs(pair.mutationRate-.15)<1e-10,
  '50 percent radiation applies 15 percent per-locus probability');
ok(breeding.pairs[1].mutationRate===.05&&breeding.pairs[2].mutationRate===.05,
  'other pods retain the baseline probability');
step();
ok(el('chamber-mutation').textContent.includes('15.0%'),'HUD shows the selected pod probability');
const halfGenome=JSON.stringify(pair.genome);
chamberSystem.interact();
ok(calls.length===1&&pair.genesLocked&&pair.state==='running',
  'E while equipped confirms current progress and submits exactly once');
ok(JSON.stringify(calls[0].job.genome)===halfGenome&&calls[0].job.prompt===genomeToPrompt(pair.genome),
  'API receives the finalized genes and matching prompt');
for(let i=0;i<100;i++)chamberSystem.sprayWater(origin,direction,.1,12);
ok(JSON.stringify(pair.genome)===halfGenome&&calls.length===1,
  'post-confirmation hits cannot alter genes or resubmit');
ok(!confirmMateRadiation(0,1),'repeated confirmation is idempotent');
calls[0].reject(new Error('interrupted'));await tick();step();
const requestId=pair.generation.id;
void generateOffspringModel(pair,true);
ok(calls.length===2&&calls[1].job.id===requestId&&calls[1].resume,
  'retry resumes the same finalized request');
calls[1].resolve({model:buildOffspringBody(pair.genome),taskId:'mutation-half'});await tick();
const baby=birthOffspring(0,'chamber');
ok(baby&&Math.abs(baby.mutationRate-.15)<1e-10&&JSON.stringify(baby.genome)===halfGenome,
  'offspring retains the actual probability and immutable generated genes');
ok(pair.radiation===0&&pair.mutationRate===.05&&!pair.genesLocked,'next round starts without inherited bonus');
at(1);origin.x=CHAMBER_POSITIONS[1].x;
for(let i=0;i<170;i++)chamberSystem.sprayWater(origin,direction,.1,12);
ok(breeding.pairs[1].mutationRate===.25&&breeding.pairs[1].genesLocked&&calls.length===3,
  'full radiation automatically submits once at 25 percent');
at(2);fire('chamber-interact','click');
ok(calls.length===4&&breeding.pairs[2].mutationRate===.05,
  'HUD allows explicit generation at zero radiation without changing its genes');
const pending=calls[2].job;
abortOffspringGeneration(breeding.pairs[1]);
calls[2].resolve({model:buildOffspringBody(pending.genome),taskId:'stale'});await tick();
ok(breeding.pairs[1].state==='idle'&&!breeding.pairs[1].genome,'stale response cannot revive aborted genes');
calls[3].reject(new Error('fixture ended'));await tick();
${DRIVER_FOOTER}
`,{search:'?autostart=1&intro=0&pos=0,14'});
