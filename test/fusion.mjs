import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import {createCombineSession} from '../fusion-v1/combine-session.mjs';
import {createGameActor,createFilmResult} from '../fusion-v1/game-actor.mjs';
import {createRecombinationFilm} from '../fusion-v1/recombination-film.js';
import {createCombineAudio} from '../fusion-v1/combine-audio.js';

const session=createCombineSession({progressive:true});
session.start(true);
assert.equal(session.state,'cinematic');
for(let i=0;i<900;i++)assert.deepEqual(session.update(1/60),[]);
assert.equal(session.cinematicPhase,'entry','idle time must not advance a retired film timeline');
assert.equal(session.progress,0);
session.press();
assert.equal(session.progress,.04);
assert.equal(session.press({repeat:true}),false);
let guard=0;
while(session.progress<.8&&guard++<100)session.press();
assert.equal(session.cinematicPhase,'sphere');
const high=session.progress,speed=session.speed;
session.update(.05);
assert(session.progress<high&&session.speed<speed);
while(session.progress>0)session.update(.05);
session.press();
assert.equal(session.progress,.04,'high progress cannot permanently reduce the initial press gain');
while(!session.completed&&guard++<200)session.press();
assert(session.completed);
assert.equal(session.cinematicPhase,'birth');
for(let i=0;i<60;i++)session.update(1/60);
assert.equal(session.cinematicPhase,'result');
assert.equal(session.progress,1);
session.reset();session.start(true);
assert.equal(session.cinematicPhase,'entry');

const sources=[0,1].map(i=>{
  const root=new THREE.Group();
  root.add(new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshStandardMaterial({color:i?'#72b444':'#e85858'})));
  return root;
});
const originals=sources.map(root=>root.children[0].geometry.attributes.position.array.slice());
const actors=sources.map((source,side)=>createGameActor(source,{side,initialWave:false}));
let births=0,scene,camera;
const film=createRecombinationFilm({onBirth:()=>births++});
film.setResultAsset(createFilmResult(sources[0],'generated-fixture'));
const hostCamera=new THREE.OrthographicCamera(-6,6,4,-4,.1,100);
hostCamera.position.set(0,2,24);hostCamera.updateMatrixWorld(true);
const renderer={render(s,c){scene=s;camera=c;s.updateMatrixWorld(true);}};
for(const [width,height] of [[1280,800],[390,844]]) {
  film.reset();film.begin(actors,hostCamera);film.resize(width,height);film.render(renderer);
  const parents=[];
  scene.traverse(n=>{if(n.name==='RecombinationParent')parents.push(n);});
  assert.equal(parents.length,2);
  assert(scene.getObjectByName('FusionStage').visible);
  assert(scene.getObjectByName('DiscoLight').visible);
  for(const mesh of parents) {
    mesh.geometry.computeBoundingBox();
    const box=mesh.geometry.boundingBox,size=box.getSize(new THREE.Vector3());
    assert(Math.abs(size.x-size.y)<.01,'first-frame sphere must not be stretched into a bar');
    assert(box.min.x>camera.left&&box.max.x<camera.right,'whole parent fits the viewport');
  }
  let rotation=film.rotation;
  for(let frame=1;frame<=300;frame++) {
    film.update(frame/60,{progress:frame<60?.85:0,completed:false});
    assert(film.rotation>=rotation,'press/decay must never rewind spin');
    rotation=film.rotation;
  }
  film.render(renderer);
  for(const mesh of parents) {
    mesh.geometry.computeBoundingBox();
    const size=mesh.geometry.boundingBox.getSize(new THREE.Vector3());
    assert(Math.abs(size.x-size.y)<.01,'idle restores original proportions, not bars');
  }
  assert.equal(births,0,'time alone cannot trigger birth');
}
film.update(6,{progress:1,completed:true});
for(let frame=1;frame<=120;frame++) {
  film.update(6+frame/60,{progress:1,completed:true});
  film.render(renderer);
  const result=scene.getObjectByName('HybridResult');
  const facing=new THREE.Vector3(1,0,0).applyQuaternion(result.quaternion);
  const towardViewer=new THREE.Vector3(0,0,1).applyQuaternion(camera.quaternion);
  const modelUp=new THREE.Vector3(0,1,0).applyQuaternion(result.quaternion);
  const screenUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
  assert(facing.dot(towardViewer)>1-1e-10,'offspring local +X faces the viewer throughout birth');
  assert(modelUp.dot(screenUp)>1-1e-10,'offspring stays upright');
}
assert.equal(births,1);
assert.equal(film.resultSource,'generated-fixture');
assert.equal(film.resultScale,1);
sources.forEach((root,i)=>assert.deepEqual(root.children[0].geometry.attributes.position.array,originals[i]));
film.dispose();actors.forEach(actor=>actor.dispose());
sources.forEach(root=>root.traverse(n=>{n.geometry?.dispose();n.material?.dispose();}));

const oldFetch=globalThis.fetch,oldAudio=globalThis.AudioContext;
const nodes=[];
const parameter=()=>({value:0,setValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;}});
function node() {
  const n={gain:parameter(),frequency:parameter(),detune:parameter(),playbackRate:parameter(),
    connect(target){return target;},disconnect(){},start(){this.started=true;},stop(){}};
  nodes.push(n);return n;
}
globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
globalThis.AudioContext=class {
  state='running';currentTime=0;destination={};
  createGain(){return node();}
  createOscillator(){return node();}
  createBufferSource(){return node();}
  async resume(){}
  async decodeAudioData(){return {};}
  async close(){}
};
const audio=createCombineAudio('fixture',undefined,{music:true});
const incubation=createCombineAudio('fixture');
try {
  await audio.activate();
  assert(audio.musicPlaying);
  const count=nodes.length;
  await audio.activate();
  assert.equal(nodes.length,count,'repeated presses must not restart the BGM');
  assert(audio.press(3));assert.equal(audio.activeVoices,2);
  audio.setMuted(true);assert.equal(audio.press(3),false);
  audio.setVolume(.24);audio.setMuted(false);
  assert.equal(nodes[0].gain.value,.24);
  assert.equal(nodes[1].gain.value,.16,'effects level does not change BGM');
  audio.setMusicVolume(.08);
  assert.equal(nodes[1].gain.value,.08);
  assert.equal(nodes[0].gain.value,.24,'BGM level does not change press sounds');
  audio.setVolume(0);
  assert.equal(nodes[1].gain.value,.08,'BGM stays audible with effects set to zero');
  audio.setVolume(.24);
  audio.stop();assert.equal(audio.musicPlaying,false);assert.equal(audio.activeVoices,0);
  assert.equal(audio.press(),false);
  await audio.activate();assert(audio.musicPlaying,'resume restarts music');
  await incubation.activate();
  assert.equal(incubation.musicPlaying,false,'world incubation keeps its existing contact-only audio');
  assert(incubation.impact());
} finally {
  audio.dispose();incubation.dispose();
  globalThis.fetch=oldFetch;globalThis.AudioContext=oldAudio;
}
console.log('Fusion: progressive input, zero-progress recovery, original entry models, continuous spin, birth, BGM and press audio passed.');
