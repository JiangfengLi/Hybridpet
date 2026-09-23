import * as THREE from './vendor/three.module.min.js';

// Shared outdoor lighting keeps the contact and DNA shots in the same world.
export function createChamberStage(scene) {
  scene.background = new THREE.Color(0xc9e8f3);
  scene.fog = new THREE.Fog(0xc9e8f3, 46, 110);
  scene.environmentIntensity = .4;
  scene.add(new THREE.HemisphereLight(0xf3fbff, 0x64875e, .95));
  const sun = new THREE.DirectionalLight(0xfff4dc, 1.8);
  sun.position.set(-4, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024,1024);
  Object.assign(sun.shadow.camera,{left:-10,right:10,top:8,bottom:-8,near:.1,far:40});
  sun.shadow.normalBias = .035;
  sun.shadow.bias = -.0002;
  sun.shadow.radius = 3;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xe9faff, .55);
  rim.position.set(5, 4, -4);
  scene.add(rim);
  const root = new THREE.Group();
  root.name = 'PastureStage';
  scene.add(root);
  const resources = [];
  const floorMat = new THREE.MeshStandardMaterial({color: 0x65ad57, roughness: 1});
  const padMat = new THREE.MeshStandardMaterial({color: 0xdce8e1, roughness: .85});
  const rimMat = new THREE.MeshStandardMaterial({color: 0x7dbbac, roughness: .72});
  resources.push(floorMat, padMat, rimMat);
  function add(geo, mat, x, y, z) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    resources.push(geo);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  }
  add(new THREE.CylinderGeometry(60, 60, .15, 64), floorMat, 0, -.27, 0);
  add(new THREE.CylinderGeometry(5.4, 5.65, .17, 80), padMat, 0, -.1, 0);
  const ring = add(new THREE.TorusGeometry(5.25, .035, 6, 80), rimMat, 0, -.005, 0);
  ring.rotation.x = Math.PI / 2;
  // Broad silhouettes only; no props in the actors' movement envelope.
  const foliage = new THREE.MeshStandardMaterial({color: 0x58ac69, roughness: 1});
  const rock = new THREE.MeshStandardMaterial({color: 0xa4c3c6, roughness: 1});
  resources.push(foliage, rock);
  for (const [x,z,s] of [[-6.9,-10,2.8],[7.2,-14,3.2],[-9,-25,3.7],[10,-28,4]]) {
    const tree = add(new THREE.IcosahedronGeometry(1, 2), foliage, x, s*.6, z);
    tree.scale.set(s, s*.8, s);
    const stone = add(new THREE.IcosahedronGeometry(.8, 1), rock, x*.75, .38, z*.8);
    stone.scale.set(1.3,.65,1);
  }
  return {dispose() { root.removeFromParent(); sun.shadow.map?.dispose(); resources.forEach(r => r.dispose()); }};
}
