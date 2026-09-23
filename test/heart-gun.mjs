import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import {createWaterGun,HEART_RANGE,HEART_MAX_SIZE,HEART_MIN_SIZE,HEART_INTERVAL} from '../water-gun.mjs';

const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
camera.position.set(0,2,0);scene.add(camera);
const collector=new THREE.Group();camera.add(collector);
let target=true,hits=0,charge=0;
function trace(origin,direction,range) {
  if(!target||direction.z>=0)return null;
  const distance=(-5-origin.z)/direction.z;
  if(distance<0||distance>range)return null;
  return {distance,point:origin.clone().addScaledVector(direction,distance),chamberId:0};
}
const gun=createWaterGun({THREE,scene,camera,collector,traceWater:trace,
  sprayWater:(origin,direction,seconds,range)=>{
    const hit=trace(origin,direction,range);
    if(hit){hits++;charge+=seconds;}
    return hit;
  },getAudio:()=>null});
const update=()=>gun.update(.05,{active:true,visible:true});
gun.setEquipped(true);gun.setTrigger(true);update();gun.setTrigger(false);
assert.equal(hits,0,'no instantaneous charge before flight');
assert.equal(gun.status().projectiles.length,1);
assert.equal(gun.status().projectiles[0].size,HEART_MIN_SIZE);
update();
assert.ok(gun.status().projectiles[0].size>HEART_MIN_SIZE);
for(let i=0;i<20;i++)update();
assert.equal(hits,1,'one emitted heart applies exactly one hit');
assert.equal(charge,HEART_INTERVAL);
assert.equal(gun.status().projectiles.length,0);
target=false;
gun.setTrigger(true);update();gun.setTrigger(false);
for(let i=0;i<20;i++)update();
const far=gun.status().projectiles[0];
assert.ok(far.distance>8&&far.distance<HEART_RANGE);
assert.equal(far.size,HEART_MAX_SIZE,'growth has a fixed maximum');
for(let i=0;i<10;i++)update();
assert.equal(gun.status().projectiles.length,0,'hearts expire at maximum range');
gun.setTrigger(true);update();
gun.update(.05,{active:false,visible:true});
assert.equal(gun.status().projectiles.length,0);
update();assert.equal(gun.spraying,false,'resume cannot restart a held shot');
const outlines=scene.getObjectByName('heart-projectiles').children;
assert.equal(outlines.length,24);
assert.ok(outlines.every(mesh=>mesh.name==='heart-outline'&&mesh.geometry.type==='TubeGeometry'));
assert.ok(outlines.every(mesh=>mesh.material.color.getHex()===0xff69b0));
gun.dispose();
assert.ok(collector.visible&&!scene.getObjectByName('heart-projectiles'));
console.log('ok   heart projectiles: outline, growth, travel, single-hit charge, range and pause');
