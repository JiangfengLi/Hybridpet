import * as THREE from "../vendor/three.module.min.js";
import {createChamberStage} from "../chamber-stage.mjs";
import {
  sampleRecombination, sampleRecombinationRotation, sampleStrand, sampleHybridBirth,
  smoothRange, STRAND_RADIUS, FILM_DRAWN_AT, FILM_SPIN_SPEED, FILM_BIRTH_AT,
} from "./recombination-motion.mjs";

const RINGS = 224, SIDES = 16, SPARKS = 88;
const materialsOf = (mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material];

// Owns temporary copies and result asset; the host retains its renderer and actors.
export function createRecombinationFilm({ onBirth = () => {} } = {}) {
  const scene = new THREE.Scene();
  const stage = createChamberStage(scene);
  const spinRoot = new THREE.Group(), helix = new THREE.Group();
  scene.add(spinRoot);
  spinRoot.add(helix);
  const strandMaterials = [0, 1].map(() => new THREE.MeshPhysicalMaterial({
    color: "#ffffff", roughness: .43, clearcoat: .28, clearcoatRoughness: .4, envMapIntensity: .45,
    transparent: true,
  }));
  const snapshots = [];
  const point = new THREE.Vector3(), center = new THREE.Vector3(), tangent = new THREE.Vector3();
  const next = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
  const inverseRoot = new THREE.Matrix4(), localMatrix = new THREE.Matrix4();
  let camera, entryCamera, entryHeight = 4, aspect = 1, active = false;
  let lastTime = 0, entryAngularVelocity = FILM_SPIN_SPEED, entryOrientation = 0, resultAsset = null, fired = false;
  let splitMeshes = false;

  const tubes = [0, 1].map((side) => {
    const geometry = new THREE.CylinderGeometry(STRAND_RADIUS, STRAND_RADIUS, 1, SIDES, RINGS, true);
    const position = geometry.attributes.position;
    position.setUsage(THREE.DynamicDrawUsage);
    const samples = Array.from({ length: position.count }, (_, i) => ({
      u: position.getY(i) + .5, angle: Math.atan2(position.getZ(i), position.getX(i)),
    }));
    const mesh = new THREE.Mesh(geometry, strandMaterials[side]);
    mesh.frustumCulled = false;
    helix.add(mesh);
    return { mesh, geometry, samples, side };
  });
  const sparkGeometry = new THREE.SphereGeometry(1, 6, 4);
  const sparkMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const sparks = new THREE.InstancedMesh(sparkGeometry, sparkMaterial, SPARKS);
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparks.frustumCulled = false;
  sparks.name = "HybridBirthFirework";
  scene.add(sparks);
  const palette = ["#f3c669", "#b7e5df", "#eaf2ee"];
  const velocities = Array.from({ length: SPARKS }, (_, i) => {
    const angle = i * 2.399963;
    const speed = 4.8 + (i % 7) * .32;
    sparks.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    return new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, Math.sin(i * 7.1) * 1.2);
  });
  const dummy = new THREE.Object3D();

  function clearSnapshots() {
    for (const { mesh } of snapshots) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      materialsOf(mesh).forEach((material) => material.dispose());
    }
    snapshots.length = 0;
  }

  function begin(actors, hostCamera, {
    angularVelocity = FILM_SPIN_SPEED, orientation, colors = [], environment = null,
  } = {}) {
    clearSnapshots();
    active = true;
    fired = false;
    splitMeshes = false;
    scene.environment = environment;
    entryAngularVelocity = angularVelocity;
    entryCamera = hostCamera.clone();
    camera = hostCamera.clone();
    camera.layers.set(0);
    entryHeight = (camera.top - camera.bottom) / 2 / camera.zoom;
    aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
    const bounds = actors.map((actor) => {
      actor.root.updateWorldMatrix(true, true);
      return new THREE.Box3().setFromObject(actor.root);
    });
    const centers = bounds.map((box) => box.getCenter(new THREE.Vector3()));
    const axis = centers[1].clone().sub(centers[0]);
    entryOrientation = Number.isFinite(orientation) ? orientation : Math.atan2(-axis.z, axis.x);
    const projected = centers.map((point) => point.clone().project(hostCamera).x);
    const left = projected[0] <= projected[1] ? 0 : 1;
    actors.forEach((actor, index) => {
      const size = bounds[index].getSize(new THREE.Vector3());
      const origin = bounds[index].getCenter(new THREE.Vector3());
      const side = index === 0 ? 1 : 0;
      const exitDirection = index === left ? -1 : 1;
      strandMaterials[side].color.set(colors[index] || "#f5b635");
      inverseRoot.copy(actor.root.matrixWorld).invert();
      actor.root.traverse((node) => {
        if (!node.isMesh || !node.visible) return;
        const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
        const position = geometry.attributes.position;
        const source = new Float32Array(position.count * 3);
        const samples = new Float32Array(position.count * 3);
        const restored = new Float32Array(position.count * 3);
        localMatrix.multiplyMatrices(inverseRoot, node.matrixWorld);
        for (let i = 0; i < position.count; i++) {
          point.fromBufferAttribute(position, i);
          source.set([point.x, point.y, point.z], i * 3);
          const x = (point.x - origin.x) / Math.max(.001, size.x * .5);
          const z = (point.z - origin.z) / Math.max(.001, size.z * .5);
          samples.set([
            (point.y - bounds[index].min.y) / Math.max(.001, size.y),
            Math.atan2(z, x), Math.min(1, Math.hypot(x, z)),
          ], i * 3);
          point.fromBufferAttribute(node.geometry.attributes.position, i).applyMatrix4(localMatrix);
          // Recover each original shape into fixed screen-side positions.
          restored.set([point.x * .82 + exitDirection * 3.35, point.y * .82 + .8, point.z * .82], i * 3);
        }
        geometry.setAttribute("position", new THREE.BufferAttribute(source.slice(), 3).setUsage(THREE.DynamicDrawUsage));
        const cloned = materialsOf(node).map((material) => material.clone());
        const mesh = new THREE.Mesh(geometry, Array.isArray(node.material) ? cloned : cloned[0]);
        mesh.name = "RecombinationParent";
        mesh.frustumCulled = false;
        spinRoot.add(mesh);
        snapshots.push({ mesh, source, samples, restored, side, exitDirection });
      });
    });
    update(0);
  }

  function tubePoint(u, angle, radial, side, time, pose, target) {
    sampleStrand(u, side, time, center, pose);
    sampleStrand(u + .0001, side, time, next, pose);
    tangent.subVectors(next, center).normalize();
    // Radial frames stay continuous as the helix closes into a spherical coil.
    normal.set(center.x, (center.y - 2) * pose.coil, center.z);
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < .0001) normal.crossVectors(tangent, forward);
    normal.normalize();
    binormal.crossVectors(normal, tangent).normalize();
    const taper = .15 + .85 * smoothRange(0, .03, Math.min(u, 1 - u));
    const radius = THREE.MathUtils.lerp(STRAND_RADIUS, .29, pose.coil) * taper * radial;
    return target.copy(center).addScaledVector(normal, Math.cos(angle) * radius)
      .addScaledVector(binormal, Math.sin(angle) * radius).applyAxisAngle(up, entryOrientation);
  }

  function update(time) {
    if (!active) return;
    lastTime = time;
    const pose = sampleRecombination(time);
    const overview = Math.max(6.2, 3.6 / aspect);
    const finalHeight = Math.max(3.35, 3 / aspect);
    const composition = THREE.MathUtils.lerp(overview, finalHeight, smoothRange(2.5, 4.3, time));
    spinRoot.rotation.y = sampleRecombinationRotation(time, entryAngularVelocity);
    spinRoot.updateMatrixWorld(true);
    if (pose.separate > 0 && !splitMeshes) {
      snapshots.forEach(({ mesh }) => scene.add(mesh));
      splitMeshes = true;
    }
    for (const snapshot of snapshots) {
      snapshot.mesh.visible = pose.draw < 1 || (pose.separate > 0 && pose.escape < 1);
      if (!snapshot.mesh.visible) continue;
      const position = snapshot.mesh.geometry.attributes.position;
      const fade = pose.separate > 0 ? smoothRange(0, .18, pose.separate) : 1;
      materialsOf(snapshot.mesh).forEach((material) => {
        material.transparent = fade < 1;
        material.opacity = fade;
      });
      for (let i = 0; i < position.count; i++) {
        const o = i * 3;
        tubePoint(snapshot.samples[o], snapshot.samples[o + 1], snapshot.samples[o + 2], snapshot.side, time, pose, point);
        if (pose.separate > 0) {
          point.applyMatrix4(spinRoot.matrixWorld);
          const direction = snapshot.exitDirection;
          const x = THREE.MathUtils.lerp(point.x, snapshot.restored[o], pose.separate);
          const y = THREE.MathUtils.lerp(point.y, snapshot.restored[o + 1], pose.separate);
          const z = THREE.MathUtils.lerp(point.z, snapshot.restored[o + 2], pose.separate);
          const angle = -direction * pose.escape * .8;
          const dx = (x - direction * 3.35) * (1 + .3 * pose.escape), dy = y - 1.7;
          // Accelerate beyond the current frustum, independent of viewport width.
          position.setXYZ(i,
            direction * (3.35 + (composition * aspect + 5) * pose.escape) + dx * Math.cos(angle) - dy * Math.sin(angle),
            1.7 + dx * Math.sin(angle) + dy * Math.cos(angle) + 1.6 * pose.escape,
            z);
        } else {
          position.setXYZ(i,
            THREE.MathUtils.lerp(snapshot.source[o], point.x, pose.draw),
            THREE.MathUtils.lerp(snapshot.source[o + 1], point.y, pose.draw),
            THREE.MathUtils.lerp(snapshot.source[o + 2], point.z, pose.draw));
        }
      }
      position.needsUpdate = true;
      snapshot.mesh.geometry.computeVertexNormals();
    }
    helix.visible = pose.draw > .97 && pose.separate < .2;
    if (helix.visible) for (const tube of tubes) {
      tube.mesh.material.opacity = smoothRange(.97, 1, pose.draw) * (1 - smoothRange(0, .2, pose.separate));
      const position = tube.geometry.attributes.position;
      for (let i = 0; i < tube.samples.length; i++) {
        const { u, angle } = tube.samples[i];
        tubePoint(u, angle, 1, tube.side, time, pose, point);
        position.setXYZ(i, point.x, point.y, point.z);
      }
      position.needsUpdate = true;
      tube.geometry.computeVertexNormals();
    }
    const birth = sampleHybridBirth(time);
    if (resultAsset) {
      resultAsset.root.visible = birth.visible;
      resultAsset.root.scale.setScalar(birth.scale);
      resultAsset.root.position.set(0, .8 + birth.lift, .4);
    }
    sparks.visible = birth.firework >= 0;
    if (sparks.visible) {
      const age = birth.firework;
      sparkMaterial.opacity = (1 - smoothRange(.25, 1.15, age)) * .95;
      velocities.forEach((velocity, i) => {
        dummy.position.copy(velocity).multiplyScalar(age);
        dummy.position.y += 1.85 - 1.3 * age * age;
        dummy.position.z += 1.8;
        dummy.quaternion.setFromUnitVectors(up, tangent.copy(velocity).normalize());
        const radius = (.035 + (i % 3) * .012) * (1 - age / 1.3);
        dummy.scale.set(radius, radius * (5 - age * 2), radius);
        dummy.updateMatrix();
        sparks.setMatrixAt(i, dummy.matrix);
      });
      sparks.instanceMatrix.needsUpdate = true;
    }
    const cameraBlend = smoothRange(0, FILM_DRAWN_AT, time);
    camera.position.copy(entryCamera.position).lerp(new THREE.Vector3(0, 2, 24), cameraBlend);
    camera.quaternion.copy(entryCamera.quaternion).slerp(new THREE.Quaternion(), cameraBlend);
    const halfHeight = THREE.MathUtils.lerp(entryHeight, composition, cameraBlend);
    camera.zoom = 1;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.right = halfHeight * aspect;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (resultAsset) {
      // Point the newborn's local +X axis toward the viewer, keeping it upright.
      resultAsset.root.rotation.y = Math.atan2(
        resultAsset.root.position.z - camera.position.z,
        camera.position.x - resultAsset.root.position.x,
      );
    }
    if (time >= FILM_BIRTH_AT && !fired) {
      fired = true;
      onBirth({ source: resultAsset?.source || "none", time: FILM_BIRTH_AT });
    }
  }

  return {
    begin, update,
    get active() { return active; },
    get rotation() { return spinRoot.rotation.y; },
    get orientation() { return entryOrientation + spinRoot.rotation.y; },
    get resultScale() { return resultAsset?.root.scale.x || 0; },
    get resultSource() { return resultAsset?.source || "none"; },
    setResultAsset(asset) {
      resultAsset?.dispose();
      resultAsset = asset;
      asset.root.name = "HybridResult";
      asset.root.visible = false;
      scene.add(asset.root);
    },
    resize(width, height) {
      if (width > 0 && height > 0) aspect = width / height;
      if (active) update(lastTime);
    },
    render(renderer) { if (active) renderer.render(scene, camera); },
    reset() {
      active = false; lastTime = 0; fired = false; splitMeshes = false;
      spinRoot.rotation.y = 0;
      entryOrientation = 0;
      clearSnapshots();
      sparks.visible = false;
      if (resultAsset) { resultAsset.root.visible = false; resultAsset.root.scale.setScalar(0); }
    },
    dispose() {
      active = false;
      stage.dispose();
      clearSnapshots();
      resultAsset?.dispose();
      tubes.forEach(({ geometry }) => geometry.dispose());
      strandMaterials.forEach((material) => material.dispose());
      sparks.dispose(); sparkGeometry.dispose(); sparkMaterial.dispose();
    },
  };
}
