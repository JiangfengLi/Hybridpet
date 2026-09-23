import {runGame,DRIVER_HEAD,DRIVER_FOOTER} from './harness.mjs';

await runGame(`
${DRIVER_HEAD}
sec('Three independent world pods sharing one presentation');
const step=(n=1)=>{for(let i=0;i<n;i++)chamberSystem.tick(1/60);};
const at=(id,slot=0)=>{
  const pos=CHAMBER_POSITIONS[id];
  player.x=pos.x;player.z=pos.z-9;player.y=sampleHeight(player.x,player.z);
  camera.position.set(player.x,player.y+EYE,player.z);
  camera.lookAt(pos.x+(slot===0?1.64:slot===1?-1.64:0),2.6,pos.z);
  camera.updateMatrixWorld(true);
};
const pods=[];
scene.traverse(object=>{if(object.name==='breeding-pod')pods.push(object);});
ok(pods.length===3&&BREED_PAIRS===3&&BREED_SLOTS===6,'three pods and three separate parent pairs');
ok(pods.every((pod,id)=>pod.userData.chamberId===id
  &&pod.position.x===CHAMBER_POSITIONS[id].x&&pod.position.z===CHAMBER_POSITIONS[id].z),
  'each pod has an ID and its own world position');
ok((globalThis.__L['chamber-interact']?.click||[]).length===1,'shared HUD binds one interaction handler');
for(const pos of CHAMBER_POSITIONS) {
  const body={x:pos.x,z:pos.z,y:0};
  chamberSystem.constrain(body,.3);
  ok(Math.abs(body.x-pos.x)>=3.95-1e-8||Math.abs(body.z-pos.z)>=3.15-1e-8,'each pod constrains collisions');
}
const parents=animals.filter(a=>!a.captured&&!a.launch).slice(0,6);
parents.forEach(captureAnimal);
const plans=[];
for(let id=0;id<3;id++) {
  at(id,0);ok(chamberSystem.fire(),'deposit first parent at pod '+id);
  at(id,1);ok(chamberSystem.fire(),'deposit second parent at pod '+id);
  ok(breeding.slots[id*2]===parents[id*2]&&breeding.slots[id*2+1]===parents[id*2+1],
    'parent ownership stays with pod '+id);
  plans.push(JSON.stringify(breeding.pairs[id].genome));
  if(id<2)breedAdvance(500);
}
ok(mag.length===0&&new Set(breeding.slots).size===6,'six distinct parents leave the magazine once');
ok(breeding.pairs[0].ms===1000&&breeding.pairs[1].ms===500&&breeding.pairs[2].ms===0,
  'pods keep their independent countdown start times');
step(120);
ok(chamberSystem.status().chambers.every(pod=>pod.phase==='generating'&&pod.view.incubating),
  'all three pods can incubate concurrently');
for(let id=0;id<3;id++) {
  at(id);step();
  ok(chamberSystem.status().id===id&&el('chamber-hud').dataset.chamber===String(id),
    'HUD follows focused pod '+id);
  ok(el('chamber-name').textContent==='GENESIS / '+String(id+1).padStart(2,'0'),
    'HUD displays the selected pod number '+id);
}
const before=chamberSystem.status().chambers.map(pod=>pod.view.incubationTime);
pauseGame();step(30);
ok(chamberSystem.status().chambers.every((pod,id)=>pod.view.incubationTime===before[id]),
  'pause freezes all three world animations');
resumeFromMenu();
breedAdvance(BREED_MS);step();
ok(chamberSystem.status().chambers.every(pod=>pod.phase==='ready'),'each countdown becomes ready');
at(0);chamberSystem.interact();chamberSystem.boost();
ok(chamberSystem.status(0).phase==='playing'&&chamberSystem.status(1).phase==='ready',
  'only the selected pod owns the full-screen presentation');
chamberSystem.cancel();
at(1);chamberSystem.interact();
ok(chamberSystem.status(1).performance.presses===0,'another pod starts a fresh presentation');
chamberSystem.cancel();
ok(breeding.pairs.every((pair,id)=>JSON.stringify(pair.genome)===plans[id]),
  'switching and cancelling do not reroll any offspring');
const initialCount=animals.length;
for(const id of [1,0,2]) {
  at(id);chamberSystem.interact();
  ok(chamberSystem.status().id===id&&chamberSystem.cinematic,'start correct pod '+id);
  for(let j=0;j<10;j++)chamberSystem.boost();
  for(let j=0;j<1600&&chamberSystem.cinematic;j++)step();
  const baby=chamberSystem.child;
  ok(chamberSystem.status(id).phase==='complete'&&!!baby,'finish correct pod '+id);
  ok(!!baby&&JSON.stringify(baby.genome)===plans[id],'correct genome after shared-player switch '+id);
  ok(!!baby&&baby.genome.length===GENE_COUNT,'genetics preserved '+id);
  step(90);
  ok(chamberSystem.collect()&&mag.includes(baby),'collect only this pod offspring '+id);
  ok(!chamberSystem.collect(),'repeat collection cannot duplicate offspring '+id);
}
ok(animals.length===initialCount+3&&mag.length===3,'three tasks produce exactly three collectible offspring');
ok(breeding.slots.every((parent,id)=>parent===parents[id]),'all six parents remain in their original pods');
ok(chamberSystem.status().chambers.every(pod=>pod.phase==='loading'&&!pod.view.incubating),
  'all three pods return to idle after collection');
${DRIVER_FOOTER}
`,{search:'?autostart=1&intro=0&pos=0,14&breed=5'});
