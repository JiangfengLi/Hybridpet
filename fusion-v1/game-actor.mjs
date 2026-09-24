import * as THREE from '../vendor/three.module.min.js';
import {createJellyDeformer} from './jelly-deform.mjs';
import {HOME,sampleWave,waveSections} from './wave-motion.mjs';

const materialsOf=mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material];

// Bake a private presentation copy. Never deform the world pet or cached GLB.
function snapshot(source,height=2.15) {
  source.updateWorldMatrix(true,true);
  const root=new THREE.Group(),meshes=[],bounds=new THREE.Box3();
  source.traverse(node=>{
    if(!node.isMesh||!node.visible)return;
    const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld);
    geometry.computeBoundingBox();bounds.union(geometry.boundingBox);
    const materials=materialsOf(node).map(m=>m.clone());
    const mesh=new THREE.Mesh(geometry,Array.isArray(node.material)?materials:materials[0]);
    mesh.castShadow=true;mesh.receiveShadow=true;
    root.add(mesh);meshes.push(mesh);
  });
  if(!meshes.length)throw new Error('结合模型没有可见网格。');
  const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const scale=Math.min(height/Math.max(size.y,.001),2.8/Math.max(size.x,size.z,.001));
  for(const mesh of meshes) {
    mesh.geometry.translate(-center.x,-bounds.min.y,-center.z).scale(scale,scale,scale);
    const old=mesh.geometry.attributes.position,positions=new Float32Array(old.count*3);
    for(let i=0;i<old.count;i++)positions.set([old.getX(i),old.getY(i),old.getZ(i)],i*3);
    mesh.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    mesh.frustumCulled=false;
  }
  return {root,meshes,dispose(){
    root.removeFromParent();
    meshes.forEach(mesh=>{mesh.geometry.dispose();materialsOf(mesh).forEach(m=>m.dispose());});
  }};
}

export function createGameActor(source,{side=0,modelId,initialWave=true}={}) {
  const asset=snapshot(source);
  const deformers=asset.meshes.map(mesh=>{
    const yaw=modelId==='tripotest1'?-Math.PI/2:Math.PI;
    mesh.geometry.rotateY(yaw+(side?Math.PI:0));
    mesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    return createJellyDeformer(mesh.geometry.attributes.position.array);
  });
  asset.root.position.x=side?HOME:-HOME;
  asset.root.rotation.y=side?Math.PI:0;
  asset.applySections=sections=>{
    asset.meshes.forEach((mesh,i)=>{
      const geometry=mesh.geometry;
      deformers[i](sections,geometry.attributes.position.array);
      geometry.attributes.position.needsUpdate=true;
      geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    });
  };
  if(initialWave)asset.applySections(waveSections(sampleWave(0).points));
  const largest=[...asset.meshes].sort((a,b)=>{
    const volume=m=>{m.geometry.computeBoundingBox();const s=m.geometry.boundingBox.getSize(new THREE.Vector3());return s.x*s.y*s.z;};
    return volume(b)-volume(a);
  })[0];
  asset.color=materialsOf(largest)[0]?.color?.clone()||new THREE.Color('#70a99a');
  return asset;
}

export function createFilmResult(source,kind) {
  return {...snapshot(source,2.15),source:kind};
}
