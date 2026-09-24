import assert from 'node:assert/strict';
import {createCombineSession, QTE_LIMIT, SURGE_ROUNDS} from '../fusion-v1/combine-session.mjs';
import {runGame, DRIVER_HEAD, DRIVER_FOOTER} from './harness.mjs';

const session = createCombineSession();
assert.equal(session.start(false), false);
assert.equal(session.start(true), true);
assert.equal(session.press({repeat:true}), false);
for (let i=0;i<QTE_LIMIT;i++) assert.equal(session.press(),true);
assert.equal(session.press(),false);
let contacts=0;
for(let i=0;i<1000&&session.state!=='cinematic';i++) {
  for(const event of session.update(1/60)) {
    assert.equal(session.confirmContact(event),true);
    assert.equal(session.confirmContact(event),false);
    contacts++;
  }
}
assert.equal(contacts,SURGE_ROUNDS);
assert.equal(session.surgeRound,SURGE_ROUNDS);
assert.equal(session.state,'cinematic');
assert.equal(session.speed,6);
session.reset();
assert.equal(session.state,'setup');
console.log('ok   session: 10 inputs, 4 unique contacts, reset');

await runGame(`
${DRIVER_HEAD}
sec('Capsule lifecycle, replay, capacity and ownership');
globalThis.Audio=class {
  constructor(src){this.src=src;this.paused=true;this.currentTime=0;this.plays=0;}
  addEventListener(){}
  play(){this.plays++;this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}
};
initAudio();
const step = (n=1) => { for(let i=0;i<n;i++)chamberSystem.tick(1/60); };
const aim = slot => {
  camera.position.set(player.x,EYE,player.z);
  camera.lookAt(slot===0?1.64:slot===1?-1.64:0,2.6,slot===2?21.4:23);
  camera.updateMatrixWorld(true);
};
const fingerprint = a => {
  const meshes=[];
  a.g.traverse(n=>{if(n.isMesh)meshes.push(Array.from(n.geometry.attributes.position.array));});
  return JSON.stringify(meshes);
};
const parents=['slime-ring','slime-ball'].map(key=>animals.find(a=>a.species.key===key));
const initialAnimalCount=animals.length;
const original=parents.map(fingerprint);
parents.forEach(captureAnimal);
aim(0);
ok(chamberSystem.fire()&&breeding.slots[0]===parents[0], 'first parent moves from magazine to selected slot');
ok(!mag.includes(parents[0])&&!pals.includes(parents[0]), 'one carrying owner');
const n=mag.length;
ok(chamberSystem.fire()&&mag.length===n, 'occupied slot consumes input without ejecting a creature');
ok(chamberSystem.suck()&&mag.includes(parents[0])&&!breeding.slots[0], 'idle parent can be withdrawn');
// Restore known FIFO order after withdrawal.
mag.splice(mag.indexOf(parents[0]),1);mag.unshift(parents[0]);
chamberSystem.fire();aim(1);chamberSystem.fire();
ok(chamberSystem.status().phase==='loading'&&!chamberSystem.status().view.closed
  &&!chamberSystem.status().view.incubating, 'two parents wait in the open capsule');
ok(chamberSystem.status().view.parentHints, 'parent gene hints appear between the parents');
ok(chamberSystem.interact()&&chamberSystem.status().phase==='sealing',
  'confirm interaction starts sealing');
const planned=JSON.stringify(breeding.pairs[0].genome);
ok(chamberSystem.suck()&&breeding.slots.slice(0,2).every(Boolean), 'sealed parent cannot be withdrawn');
ok(!birthOffspring(0,'chamber'), 'cannot birth before incubation is ready');
step(120);
const podLoop=scene.getObjectByName('pod-incubation');
const windowMesh=scene.getObjectByName('pod-observation-window');
ok(chamberSystem.status().view.closed&&chamberSystem.status().view.incubating,
  'closed capsule loops its parents during incubation without entering the presentation');
ok(windowMesh.material.transparent&&!windowMesh.material.depthWrite&&!windowMesh.castShadow,
  'observation window is transparent and does not cast an opaque shadow');
ok(podLoop.visible&&podLoop.children.length===2&&!chamberSystem.cinematic,
  'two private actors play in the existing world');
const incubationBefore=chamberSystem.status().view.incubationTime;
const actorRotations=podLoop.children.map(actor=>actor.rotation.y);
paused=true;step(30);
ok(chamberSystem.status().view.incubationTime===incubationBefore, 'pause freezes the window animation');
paused=false;step(240);
ok(chamberSystem.status().view.incubationTime>incubationBefore+3.9,
  'window animation continues across cycles without acceleration inputs');
ok(podLoop.rotation.y===0&&podLoop.children.every((actor,i)=>actor.rotation.y===actorRotations[i]),
  'window actors keep their facing with no spinning');
ok(JSON.stringify(breeding.pairs[0].genome)===planned, 'window loop does not reroll offspring');
ok(chamberSystem.confirmRadiation(),'confirm zero radiation at the base mutation rate');
breedAdvance(BREED_MS);
step(90);
ok(chamberSystem.status().phase==='ready'&&chamberSystem.status().view.closed
  &&chamberSystem.status().view.observationWindow, 'windowed capsule stays closed until presentation finishes');
ok(!chamberSystem.status().view.incubating&&!podLoop.visible,
  'countdown completion ends the window loop and retains the existing ready flow');
ok(chamberSystem.interact()&&chamberSystem.cinematic, 'ready task starts presentation');
ok(chamberSystem.status().performance.state==='cinematic'&&chamberSystem.status().performance.progress===0,
  'ready task enters the new progress stage directly without QTE or a second parent selector');
backgroundTrack.media.currentTime=12;
syncGameAudio();
ok(backgroundTrack.media.paused&&backgroundTrack.media.currentTime===12,
  'fusion BGM has the stage to itself while world music retains its position');
chamberSystem.boost();
const t=chamberSystem.status().performance.cinematicTime;
el('fusion-pause').onclick();step(30);
ok(chamberSystem.status().performance.cinematicTime===t, 'presentation pause stops animation time');
el('fusion-pause').onclick();step(4);
ok(chamberSystem.status().performance.cinematicTime>t, 'presentation resumes');
el('fusion-replay').onclick();
ok(chamberSystem.status().performance.presses===0, 'replay resets presses');
ok(JSON.stringify(breeding.pairs[0].genome)===planned, 'replay preserves genetics');
ok(chamberSystem.cancel()&&chamberSystem.status().phase==='ready', 'return retains ready task');
ok(animals.length===initialAnimalCount, 'return does not register a child');
chamberSystem.interact();
let attempts=0;
while(chamberSystem.status().performance.progress<1&&attempts<240) {
  chamberSystem.boost();attempts++;
}
ok(chamberSystem.status().performance.progress===1, 'progress reaches 100% with sustained input');
const phases=new Set();
for(let i=0;i<1600&&chamberSystem.cinematic;i++) {
  step();phases.add(chamberSystem.status().performance.cinematicPhase);
}
for(const phase of ['birth','result'])
  ok(phases.has(phase),'full film contains '+phase);
ok(birthTrack.media.src==='./assets/birth-mama.wav'&&birthTrack.media.plays===1,
  'new fusion birth plays the original mama cue exactly once');
syncGameAudio();
ok(!backgroundTrack.media.paused&&backgroundTrack.media.currentTime===12,
  'returning from fusion resumes world music without restarting it');
const baby=chamberSystem.child;
ok(!!baby&&animals.length===initialAnimalCount+1, 'one child registered after full film');
ok(JSON.stringify(baby.genome)===planned, 'birth uses the precomputed genome');
ok(baby.species.speed===.62&&baby.g.userData.speed===.62, 'inherited movement speed applied');
ok(baby.captured&&!baby.g.visible&&!mag.includes(baby)&&!pals.includes(baby), 'child is safely held by capsule before claiming');
step(120);
ok(chamberSystem.status().view.openness===1, 'capsule reopens');
ok(!podLoop.visible&&!chamberSystem.status().view.incubating,
  'reopened capsule does not continue the combination loop');
ok(animals.length===initialAnimalCount+1, 'subsequent frames do not duplicate birth');
const count=chamberSystem.status().task;
mag.length=0;pals.length=0;
for(let i=0;i<MAG_MAX;i++)mag.push({species:{name:'capacity fixture'}});
for(let i=0;i<BAG_MAX;i++)pals.push({species:{name:'capacity fixture'}});
ok(!chamberSystem.collect()&&chamberSystem.child===baby, 'full inventory does not lose the child');
ok(chamberSystem.status().phase==='complete', 'full capacity keeps claimable state');
pals.pop();
ok(chamberSystem.collect()&&pals.includes(baby)&&!mag.includes(baby), 'full magazine falls back to backpack');
ok(!chamberSystem.collect()&&animals.length===initialAnimalCount+1, 'repeat claim has no side effects');
ok(breeding.slots.slice(0,2).every(Boolean), 'parents retained after collection');
parents.forEach((p,i)=>ok(fingerprint(p)===original[i], 'original parent geometry unchanged '+i));
mag.length=0;pals.length=0;pals.push(baby);
aim(0);chamberSystem.suck();
aim(1);chamberSystem.suck();
ok(breeding.slots.every(x=>!x)&&parents.every(p=>mag.includes(p)), 'parents can both be recovered');
magToBag(0);magToBag(0);
bagToMag(pals.indexOf(baby));
bagToMag(pals.indexOf(parents[0]));
aim(0);chamberSystem.fire();aim(1);chamberSystem.fire();chamberSystem.interact();
ok(breeding.slots[0]===baby, 'offspring can become a parent');
ok(chamberSystem.status().task===count+1, 'next generation has a new task');
/* ⚠️ 长度这里原来写死 32 —— 加附属物（33~36 位）之后必然失配。
   改成跟 GENE_COUNT 走：基因位数变了它自己会跟上，不用回来改断言。 */
ok(breeding.pairs[0].genome.length===GENE_COUNT, 'next generation reuses original inheritance');
${DRIVER_FOOTER}
`,{search:'?autostart=1&intro=0&pos=0,14&breed=2'});
