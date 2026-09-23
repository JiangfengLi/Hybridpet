import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT, runGame, DRIVER_HEAD, DRIVER_FOOTER} from './harness.mjs';

const readJson = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/asset-guide', name), 'utf8'));
const records = readJson('import-map.json');
const environment = readJson('environment.json');
const pets = readJson('pets.json');
assert.ok(!records.some(record => record.target === 'models/tree-01.glb'),
  'asset pack import must not replace the original tree');
assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'models/tree-01.glb'))).digest('hex'),
  '253a8c2b50a7efd3b2bff6ff0d9593a8921c30623cbea1881c1ce4b3c62d465e',
  'original project tree retained by user request');
assert.equal(new Set(records.map(record => record.target)).size, records.length);
for (const {source, target, sha256} of records) {
  const bytes = fs.readFileSync(path.join(ROOT, target));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, source + ' matches imported bytes');
  if (!target.endsWith('.glb')) continue;
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.ok(gltf.buffers.every(buffer => !buffer.uri), source + ' geometry is embedded');
  assert.ok(gltf.images.every(image => image.bufferView !== undefined), source + ' textures are embedded');
}
assert.equal(records.filter(record => record.source.startsWith('environment/') && record.target.endsWith('.glb')).length, 17);
assert.equal(records.filter(record => record.source.startsWith('pets/') && record.target.endsWith('.glb')).length, 13);
for (const asset of environment.assets.filter(asset => asset.file)) {
  assert.ok(records.some(record => record.source === 'environment/' + asset.file), asset.file);
}
for (const pet of [...pets.pets, ...pets.variants]) {
  assert.ok(records.some(record => record.source === 'pets/' + pet.file), pet.file);
}
console.log('ok   asset provenance: 17 environment GLBs, 8 pets, 5 reserved variants, embedded textures');

await runGame(`
${DRIVER_HEAD}
const sourcePets = ${JSON.stringify(pets.pets)};
const sourceSlots = ${JSON.stringify(pets.geneSlots.map(slot => slot.key))};
ok(JSON.stringify(GENE_DEFS.slice(0,32).map(slot=>slot.key))===JSON.stringify(sourceSlots),
  'source genome slot order matches the runtime schema');
ok(GENE_COUNT===36,'existing 36-slot genetics retained');
const imported=SPECIES_LIST.filter(sp=>sp.glb);
ok(imported.length===8&&slimeStats.failed.length===0,'all eight pet species parsed by the real GLTFLoader');
for(const source of sourcePets) {
  const sp=imported.find(sp=>sp.key===source.key);
  ok(!!sp,source.key+' registered');
  const members=animals.filter(a=>a.species===sp);
  ok(members.length===(source.key.startsWith('slime-')?20:3),source.key+' exact population');
  const a=members[0],mesh=a.g.userData.body;
  const size=mesh.geometry.boundingBox.getSize(new THREE.Vector3());
  ok(['x','y','z'].every(axis=>Math.abs(size[axis]-BODY_BOX.A[axis])<1e-5),
    source.key+' normalized to grade A');
  ok(Math.abs(mesh.geometry.boundingBox.min.y)<1e-6,source.key+' feet grounded');
  ok(Math.abs(a.cyl.h-BODY_BOX.A.y)<1e-5&&a.cyl.r>0,source.key+' valid collider');
  ok(!!mesh.material.map&&!(mesh.material.transmission>0),source.key+' texture retained, no transmission pass');
  ok(members.every(member=>member.g.userData.body.geometry===mesh.geometry),
    source.key+' shares one geometry per species');
  const gene=genomeOfPal(a);
  ok(gene.length===36&&gene.every((value,i)=>Number.isInteger(value)&&value>=0&&value<GENE_DEFS[i].opts.length),
    source.key+' every gene value valid');
  if(sp.genomeSeed) {
    ok(JSON.stringify(gene.slice(0,32))===JSON.stringify(source.genome),source.key+' imported 32-slot seed');
    const fresh=initialGenomeFor(sp);
    fresh[0]=999;
    ok(sp.genomeSeed[0]===0&&gene[0]===0,source.key+' seed and cached genome are not mutated');
  }
}
const shiba=animals.find(a=>a.species.key==='knife-shiba');
ok(attachListOf(genomeOfPal(shiba)).join(',')==='剑,盾牌','shiba uses existing sword and shield accessory slots');
ok(initialGenomeFor(imported.find(sp=>sp.key==='slime-ring'))[G_BODYCOLOR]===COLOR_WHITE,
  'existing ring slime gene choices unchanged');
for(const key of ['knife-shiba','kangaroo-peek','bull-aloof','baby-laugh','mind-sphere']) {
  const material=animals.find(a=>a.species.key===key).g.userData.body.material;
  ok(!material.transparent&&material.opacity===1,key+' keeps opaque surface');
}
const sunny=animals.find(a=>a.species.key==='sunny-sun').g.userData.body.material;
ok(sunny.transparent&&Math.abs(sunny.opacity-.9)<1e-6,'Sunny retains the supplied translucent material');

// Exercise the same inventory and world launch paths for every newly added pet.
player.x=0;player.z=0;camera.position.set(0,EYE,0);camera.lookAt(0,EYE,-10);camera.updateMatrixWorld(true);
const newPets=imported.filter(sp=>sp.genomeSeed).map(sp=>animals.find(a=>a.species===sp));
for(const pet of newPets) {
  const original=pet.g.userData.body.geometry;
  ok(captureAnimal(pet)&&mag.includes(pet),pet.species.key+' captured');
  ok(magToBag(mag.indexOf(pet))&&pals.includes(pet),pet.species.key+' moved to bag');
  renderBag();
  ok(el('bagPage0').innerHTML.includes(pet.species.name),pet.species.key+' name in inventory');
  ok(bagToMag(pals.indexOf(pet)),pet.species.key+' returned to magazine');
  trySpit();
  ok(!pet.captured&&!!pet.launch&&pet.g.visible,pet.species.key+' launched into world');
  for(let frame=0;frame<90;frame++)updateAnimalTransition(pet,1/60);
  ok(!pet.launch&&Number.isFinite(pet.x)&&pet.g.userData.body.geometry===original,
    pet.species.key+' lands without replacing the imported model');
}

// All six new models can be deposited as parents and returned without starting a paid job.
const step=()=>{for(let i=0;i<90;i++)chamberSystem.tick(1/60);};
for(const pet of newPets) {
  const pod=CHAMBER_POSITIONS[0];
  player.x=pod.x;player.z=pod.z-9;player.y=0;
  camera.position.set(player.x,EYE,player.z);
  camera.lookAt(pod.x+1.64,2.6,pod.z);camera.updateMatrixWorld(true);
  captureAnimal(pet);
  ok(chamberSystem.fire()&&breeding.slots[0]===pet,pet.species.key+' deposited in capsule');
  step();
  ok(chamberSystem.suck()&&mag.includes(pet)&&!breeding.slots[0],pet.species.key+' retrieved from capsule');
  magToBag(mag.indexOf(pet));
}
ok(breeding.pairs.every(pair=>!pair.generation),'asset verification never starts an external generation');
${DRIVER_FOOTER}
`, {search:'?autostart=1&intro=0'});
