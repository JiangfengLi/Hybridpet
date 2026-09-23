import assert from 'node:assert/strict';
import {createWaterCharge} from '../chamber-water.mjs';
import {runGame,DRIVER_HEAD,DRIVER_FOOTER} from './harness.mjs';

const changes=[],thresholds=[];
const charge=createWaterCharge({onChange:event=>changes.push(event),onThreshold:event=>thresholds.push(event.threshold)});
assert.equal(charge.add(NaN),false);
assert.equal(charge.add(-1),false);
charge.add(5);
assert.equal(charge.status().value,.3);
assert.deepEqual(thresholds,[.25]);
charge.add(20);
assert.equal(charge.status().value,1);
assert.deepEqual(thresholds,[.25,.5,.75,1]);
assert.equal(charge.add(5),false);
charge.reset();charge.add(5);
assert.deepEqual(thresholds,[.25,.5,.75,1,.25]);
assert.ok(changes.some(event=>event.reason==='reset'));

await runGame(`
${DRIVER_HEAD}
sec('Four windows, suspension, water tool and independent charge');
const step=(count=1)=>{for(let i=0;i<count;i++)chamberSystem.tick(.05);};
const at=(id,slot=0)=>{
  const p=CHAMBER_POSITIONS[id];
  player.x=p.x;player.z=p.z-9;player.y=0;
  camera.position.set(player.x,EYE,player.z);
  camera.lookAt(p.x+(slot===0?1.64:-1.64),2.6,p.z);
  camera.updateMatrixWorld(true);
};
const roots=[];
scene.traverse(object=>{if(object.name==='breeding-pod')roots.push(object);});
for(const root of roots) {
  const windows=[];
  root.traverse(object=>{if(object.name.startsWith('pod-observation-window'))windows.push(object);});
  ok(windows.length===4&&windows.every(window=>window.material.transparent&&!window.material.depthWrite),
    'pod '+root.userData.chamberId+' has four transparent windows');
}
animals.filter(a=>!a.captured&&!a.launch).slice(0,4).forEach(captureAnimal);
for(const id of [0,1]) {
  at(id,0);chamberSystem.fire();at(id,1);chamberSystem.fire();
}
step(40);
ok(chamberSystem.status(0).view.shakeAmount>.9,'closed incubating pod rocks');
ok(roots[0].position.x===0&&roots[0].position.z===23,'suspension does not move the collision root');
ok(chamberSystem.status(2).view.shakeAmount===0,'idle pod does not rock');
at(0);chamberSystem.interact();
ok(waterGun.equipped&&!collectorRig.visible,'E near an incubating pod equips the heart gun');
const before=mag.length;trySpit();
ok(mag.length===before,'water mode never launches a creature');
const events=[],unsubscribe=chamberWater.onThreshold(event=>events.push(event));
const origin=new THREE.Vector3(),direction=new THREE.Vector3();
for(const [x,z] of [[0,14],[0,32],[-9,23],[9,23]]) {
  origin.set(x,2.7,z);direction.set(-x,0,23-z).normalize();
  const hit=chamberSystem.sprayWater(origin,direction,.05,12);
  ok(hit?.chamberId===0,'water ray hits the central pod from '+x+','+z);
}
ok(chamberWater.getState(0).value>0&&chamberWater.getState(1).value===0,
  'only the hit pod accumulates water');
origin.set(18,2.7,14);direction.set(0,0,1);
chamberSystem.sprayWater(origin,direction,.05,12);
ok(chamberWater.getState(2).value===0,'idle pod blocks the stream but does not gain charge');
origin.set(0,2.7,14);direction.set(0,0,1);
for(let i=0;i<400;i++)chamberSystem.sprayWater(origin,direction,.05,12);
ok(chamberWater.getState(0).value===1,'water meter saturates at 100 percent');
ok(chamberSystem.status(0).phase==='generating'&&breeding.pairs[0].mutationRate===.25&&breeding.pairs[0].genesLocked,
  'full radiation automatically locks a 25 percent mutation rate and starts generation');
ok(events.length===4&&events.every(event=>event.chamberId===0&&event.taskId===1),
  'thresholds emit once with pod and task ownership');
step();
ok(chamberSystem.status(0).view.waterPercent===100,'world digital display receives the water level');
unsubscribe();
at(1);
fire('app','mousedown',{button:0});
waterGun.update(.05,{active:true,visible:true});
ok(waterGun.spraying&&scene.getObjectByName('heart-projectiles').visible,'left mouse emits heart outlines');
ok(chamberWater.getState(1).value===0,'a newly emitted heart does not instantly apply hitscan charge');
for(let i=0;i<30;i++)waterGun.update(.05,{active:true,visible:true});
ok(chamberWater.getState(1).value>0,'hearts apply charge only after travelling to the pod');
const accumulated=chamberWater.getState(1).value;
pauseGame();waterGun.update(.05,{active:false,visible:true});
ok(!waterGun.spraying&&chamberWater.getState(1).value===accumulated,'pause stops water and accumulation');
resumeFromMenu();
waterGun.update(.05,{active:true,visible:true});
ok(!waterGun.spraying,'resuming does not restart a held stream');
player.x=60;player.z=-40;
chamberSystem.interact();
ok(!waterGun.equipped&&collectorRig.visible,'E outside detection restores the original collector');
const beforeMiss=chamberWater.getState(1).value;
chamberSystem.sprayWater(origin,direction,.05,12);
ok(chamberWater.getState(1).value===beforeMiss,'unequipped shots do not add charge');
breedAdvance(BREED_MS);step(80);
ok(chamberSystem.status(0).phase==='ready'&&chamberSystem.status(0).view.shakeAmount<1e-5,
  'ready pod stops rocking and keeps its accumulated water');
ok(chamberWater.getState(0).value===1,'ready state retains the completed round meter');
at(0);chamberSystem.interact();
ok(chamberSystem.cinematic,'ready pod enters the combination presentation');
chamberSystem.cancel();
ok(chamberWater.getState(0).value===1,'cancelling a presentation preserves water for this round');
chamberSystem.interact();
for(let i=0;i<10;i++)chamberSystem.boost();
for(let i=0;i<1600&&chamberSystem.cinematic;i++)step();
ok(chamberSystem.status(0).phase==='complete','combination completes with a newborn');
ok(chamberSystem.child.mutationRate===.25&&chamberSystem.child.radiationProgress===1,
  'newborn retains the applied mutation probability after the meter resets');
ok(chamberWater.getState(0).value===0&&chamberSystem.status(0).view.waterPercent===0,
  'combination completion immediately resets both water state and display');
ok(chamberWater.getState(1).value===accumulated,'completion leaves other pods water unchanged');
${DRIVER_FOOTER}
`,{search:'?autostart=1&intro=0&pos=0,14&breed=60'});
