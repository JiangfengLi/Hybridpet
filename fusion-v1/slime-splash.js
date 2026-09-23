import * as THREE from "../vendor/three.module.min.js";
import { createSplashDrops, sampleSplashDrop, SPLASH_COUNT } from "./splash-motion.mjs";

export function createSlimeSplash({ count = SPLASH_COUNT, size = 1 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 256 || !Number.isFinite(size) || size <= 0) {
    throw new Error("Splash needs 1-256 droplets and a positive size");
  }
  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const taper = .85 - .22 * positions.getY(i);
    positions.setX(i, positions.getX(i) * taper);
    positions.setZ(i, positions.getZ(i) * taper);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalMaterial({
    color: "white", roughness: .4, metalness: 0, clearcoat: .3,
    clearcoatRoughness: .4, envMapIntensity: .45,
  });
  const root = new THREE.Group();
  root.name = "ContactSlimeSplash";
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  root.add(mesh);
  const object = new THREE.Object3D(), position = new THREE.Vector3(), velocity = new THREE.Vector3();
  const vertical = new THREE.Vector3(0, 1, 0);
  let burst = null, emissions = 0, activeCount = 0;
  return {
    root,
    get activeCount() { return activeCount; },
    get emissions() { return emissions; },
    emit({ point, axis, colors, time, seed = 1 }) {
      const tangent = axis.clone().cross(vertical).normalize();
      burst = { point: point.clone(), axis: axis.clone().normalize(), tangent, time, drops: createSplashDrops(seed, count) };
      burst.drops.forEach((drop, i) => mesh.setColorAt(i, colors[drop.side]));
      mesh.instanceColor.needsUpdate = true;
      emissions++;
    },
    update(time) {
      if (!burst) { mesh.count = 0; activeCount = 0; return; }
      let active = 0;
      burst.drops.forEach((drop, i) => {
        const pose = sampleSplashDrop(drop, time - burst.time, size);
        if (!pose) { object.scale.setScalar(0); }
        else {
          position.copy(burst.point).addScaledVector(burst.axis, pose.x)
            .addScaledVector(vertical, pose.y).addScaledVector(burst.tangent, pose.z + .06);
          velocity.copy(burst.axis).multiplyScalar(pose.vx).addScaledVector(vertical, pose.vy)
            .addScaledVector(burst.tangent, pose.vz).normalize();
          object.position.copy(position);
          object.quaternion.setFromUnitVectors(vertical, velocity);
          object.scale.set(pose.width, pose.length, pose.width);
          active++;
        }
        object.updateMatrix();
        mesh.setMatrixAt(i, object.matrix);
      });
      mesh.count = active ? count : 0;
      activeCount = active;
      mesh.instanceMatrix.needsUpdate = true;
      if (!active && time > burst.time) burst = null;
    },
    clear() { burst = null; mesh.count = 0; activeCount = 0; emissions = 0; },
    dispose() { root.removeFromParent(); geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}
