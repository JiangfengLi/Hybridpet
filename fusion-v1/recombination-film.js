import * as THREE from "../vendor/three.module.min.js";
import {
  sampleRecombination, sampleRecombinationRotation, sampleStrand, sampleHybridBirth,
  smoothRange, STRAND_RADIUS, FILM_DRAWN_AT, FILM_SPIN_SPEED, FILM_BIRTH_AT,
} from "./recombination-motion.mjs";

const RINGS = 224, SIDES = 16, SPARKS = 132, LASERS = 24, SCANLINES = 22;
const materialsOf = (mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material];
const clamp01 = (value) => Math.max(0, Math.min(1, value));
// Entry is the two complete parent slimes on the stage. Fusion blends those
// silhouettes directly into the biological coil, without the retired bars.
const FUSION_ENTRY_SHAPE = .96;

// Owns temporary copies and result asset; the host retains its renderer and actors.
export function createRecombinationFilm({ onBirth = () => {} } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#2ca34e");
  scene.fog = new THREE.FogExp2("#2c9d4d", .015);
  const spinRoot = new THREE.Group(), helix = new THREE.Group();
  scene.add(spinRoot);
  spinRoot.add(helix);
  const ambient = new THREE.HemisphereLight("#efffe8", "#124628", 1.18);
  scene.add(ambient);
  const key = new THREE.DirectionalLight("#e7ffd9", 3.1);
  key.position.set(-4, 7, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#b9ffd0", 2.15);
  rim.position.set(5, 5, -4);
  scene.add(rim);
  const discoLights = [
    new THREE.PointLight("#ff236f", 0, 9, 1.7),
    new THREE.PointLight("#15f1ff", 0, 9, 1.7),
    new THREE.PointLight("#fff04a", 0, 9, 1.7),
    new THREE.PointLight("#8dff4f", 0, 9, 1.7),
  ];
  discoLights.forEach((light) => scene.add(light));

  const backdropWaves = [
    { color: "#3bb85d", opacity: .62, z: -4.8, speed: 0.34, twist: .22 },
    { color: "#c5db3d", opacity: .12, z: -4.5, speed: -0.47, twist: .34 },
    { color: "#15c990", opacity: .15, z: -4.2, speed: 0.63, twist: .46 },
  ].map((layer, index) => {
    const geometry = new THREE.PlaneGeometry(28, 20, 32, 22);
    const position = geometry.attributes.position;
    const base = new Float32Array(position.array);
    const material = new THREE.MeshBasicMaterial({
      color: layer.color, transparent: true, opacity: layer.opacity,
      depthWrite: false, blending: index ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `PsychedelicBackdrop${index + 1}`;
    mesh.position.z = layer.z;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { ...layer, geometry, position, base, mesh };
  });

  const stageRoot = new THREE.Group();
  stageRoot.name = "FusionStage";
  stageRoot.visible = false;
  scene.add(stageRoot);
  const stageMaterial = new THREE.MeshStandardMaterial({
    color: "#163d2a", roughness: .2, metalness: .72, emissive: "#0a5b2f", emissiveIntensity: 1.45,
  });
  const stageTrimMaterial = new THREE.MeshBasicMaterial({
    color: "#ffef55", transparent: true, opacity: .9, blending: THREE.AdditiveBlending,
  });
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.6, .26, 64), stageMaterial);
  stage.position.y = .08;
  stage.castShadow = true;
  stage.receiveShadow = true;
  stageRoot.add(stage);
  const stageTrim = new THREE.Mesh(new THREE.TorusGeometry(2.48, .055, 8, 96), stageTrimMaterial);
  stageTrim.rotation.x = Math.PI / 2;
  stageTrim.position.y = .24;
  stageRoot.add(stageTrim);
  const stageRings = [1.35, 1.8, 2.15].map((radius, index) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, .024 + index * .012, 6, 96),
      new THREE.MeshBasicMaterial({ color: index % 2 ? "#f4ff4f" : "#31f5ac", transparent: true }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .24 + index * .012;
    stageRoot.add(ring);
    return ring;
  });
  const stageColumns = [-1, 1].flatMap((x) => [-1, 1].map((z) => {
    const column = new THREE.Mesh(
      new THREE.BoxGeometry(.12, 1.1, .12),
      new THREE.MeshBasicMaterial({ color: "#36dbff", transparent: true }),
    );
    column.position.set(x * 2.2, -.48, z * 2.2);
    stageRoot.add(column);
    return column;
  }));
  const stageSpokes = Array.from({ length: 12 }, (_, index) => {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(.035, .035, 2.25),
      new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? "#ff287d" : index % 3 === 1 ? "#1ff5ff" : "#ffe84e",
        transparent: true, opacity: .75, blending: THREE.AdditiveBlending,
      }),
    );
    spoke.rotation.y = index * Math.PI / 12;
    spoke.position.y = .255;
    stageRoot.add(spoke);
    return spoke;
  });
  const stageNodes = Array.from({ length: 12 }, (_, index) => {
    const node = new THREE.Mesh(
      new THREE.IcosahedronGeometry(.085, 1),
      new THREE.MeshBasicMaterial({
        color: "#b9ff43", transparent: true, opacity: .9, blending: THREE.AdditiveBlending,
      }),
    );
    stageRoot.add(node);
    return node;
  });
  const stagePanels = Array.from({ length: 16 }, (_, index) => {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(.11, .09, .34),
      new THREE.MeshBasicMaterial({
        color: "#9dff3c", transparent: true, opacity: .78, blending: THREE.AdditiveBlending,
      }),
    );
    stageRoot.add(panel);
    return panel;
  });

  const discoRoot = new THREE.Group();
  discoRoot.name = "DiscoLight";
  discoRoot.visible = false;
  scene.add(discoRoot);
  const discoShell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(.44, 2),
    new THREE.MeshPhysicalMaterial({
      color: "#d9ffe2", metalness: .88, roughness: .1, clearcoat: 1, emissive: "#1b6338", emissiveIntensity: 1.3,
    }),
  );
  discoRoot.add(discoShell);
  const discoBands = [0, 1, 2].map((index) => {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(.57 + index * .1, .028, 8, 64),
      new THREE.MeshBasicMaterial({ color: ["#ff3d94", "#32efff", "#ffe25a"][index] }),
    );
    band.rotation.set(index * .5, index * .8, index * .3);
    discoRoot.add(band);
    return band;
  });
  const discoBeam = new THREE.Mesh(
    new THREE.ConeGeometry(2.65, 5.8, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: "#55eaff", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  discoBeam.rotation.x = Math.PI;
  discoBeam.position.y = -2.85;
  discoRoot.add(discoBeam);
  const discoPoint = new THREE.PointLight("#65edff", 0, 12, 2);
  discoRoot.add(discoPoint);
  const discoPrisms = Array.from({ length: 6 }, (_, index) => {
    const prism = new THREE.Mesh(
      new THREE.CylinderGeometry(.07, .18, 1.25, 5, 1, true),
      new THREE.MeshBasicMaterial({
        color: ["#ff328e", "#20f5ff", "#ffe04d"][index % 3],
        transparent: true, opacity: .82, blending: THREE.AdditiveBlending,
      }),
    );
    prism.rotation.set(index * .4, index * .8, index * .22);
    discoRoot.add(prism);
    return prism;
  });
  const laserBeams = Array.from({ length: LASERS }, (_, index) => {
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(.035 + (index % 3) * .012, 1, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#44efff", transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    );
    beam.frustumCulled = false;
    scene.add(beam);
    return beam;
  });
  const scanlines = Array.from({ length: SCANLINES }, (_, index) => {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(11 + (index % 4) * 2, .018 + (index % 3) * .012),
      new THREE.MeshBasicMaterial({
        color: "#b9ff43", transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    line.position.z = -2.9;
    line.frustumCulled = false;
    scene.add(line);
    return line;
  });

  const glitchBars = Array.from({ length: 38 }, (_, index) => {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(.08 + (index % 4) * .06, .015 + (index % 3) * .012, .04 + (index % 5) * .02),
      new THREE.MeshBasicMaterial({ color: index % 2 ? "#c9ff3d" : "#39e7ff", transparent: true, opacity: 0 }),
    );
    bar.visible = false;
    scene.add(bar);
    return bar;
  });
  const strandMaterials = [0, 1].map(() => new THREE.MeshPhysicalMaterial({
    color: "#ffffff", roughness: .26, clearcoat: 1, clearcoatRoughness: .2, envMapIntensity: .65,
    transparent: true,
  }));
  const snapshots = [];
  const point = new THREE.Vector3(), center = new THREE.Vector3(), tangent = new THREE.Vector3();
  const next = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3();
  const laserStart = new THREE.Vector3(), laserEnd = new THREE.Vector3(), laserDirection = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
  const resultFacing = new THREE.Quaternion().setFromAxisAngle(up, -Math.PI / 2);
  const inverseRoot = new THREE.Matrix4(), localMatrix = new THREE.Matrix4();
  let camera, entryCamera, entryHeight = 4, aspect = 1, active = false;
  let lastTime = 0, entryAngularVelocity = FILM_SPIN_SPEED, entryOrientation = 0, resultAsset = null, fired = false;
  let birthStartedAt = -1;
  let spinAngle = 0, spinVelocity = 0, visualProgress = 0;
  let lastProgress = null, lastCompleted = false;
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
  const palette = ["#f3b42d", "#ef5771", "#30bbae", "#b383ef", "#ffdd77"];
  const velocities = Array.from({ length: SPARKS }, (_, i) => {
    const angle = i * 2.399963;
    const speed = 4.8 + (i % 7) * .32;
    sparks.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    return new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, Math.sin(i * 7.1) * 1.2);
  });
  const dummy = new THREE.Object3D();
  const shockwave = new THREE.Mesh(
    new THREE.TorusGeometry(1, .055, 8, 96),
    new THREE.MeshBasicMaterial({ color: "#ffe867", transparent: true, opacity: 0 }),
  );
  shockwave.rotation.x = Math.PI / 2;
  shockwave.position.y = .55;
  scene.add(shockwave);
  const burstLight = new THREE.PointLight("#fff4ae", 0, 14, 2);
  burstLight.position.set(0, 1.55, 1.4);
  scene.add(burstLight);
  const fusionOrb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 5),
    new THREE.MeshPhysicalMaterial({
      color: "#d85d4a", roughness: .2, metalness: .12, clearcoat: 1, clearcoatRoughness: .16,
      emissive: "#4d122d", emissiveIntensity: .75, transparent: true, opacity: .92,
    }),
  );
  fusionOrb.name = "FusionOrb";
  fusionOrb.visible = false;
  fusionOrb.position.set(0, 1.55, .35);
  scene.add(fusionOrb);

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
    birthStartedAt = -1;
    spinAngle = 0;
    spinVelocity = angularVelocity;
    visualProgress = 0;
    lastProgress = 0;
    lastCompleted = false;
    splitMeshes = false;
    scene.environment = environment;
    scene.background.set("#2ca34e");
    scene.fog.color.set("#2c9d4d");
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
    // Initialize directly in the playable stage mode. The first frame is
    // already a curled biological fusion, with no straight-bar intro.
    update(0, { progress: 0, completed: false });
  }

  function frenzyRotation(time) {
    const t = Math.max(0, time);
    const base = sampleRecombinationRotation(t, entryAngularVelocity);
    const ramp = smoothRange(1.7, 3.35, t);
    const chaos = smoothRange(3.35, 4.3, t);
    return base + ramp * ramp * 3.4 * t + chaos * chaos * 8.5 * t;
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

  function bioPoint(u, angle, radial, side, time, progress, target) {
    const p = Math.max(0, Math.min(1, progress));
    const dir = side ? -1 : 1;
    const coil = smoothRange(.18, .92, p);
    const phase = side * Math.PI + u * Math.PI * (2.2 + coil * 3.8) + time * (.4 + coil * 5.2);
    const outer = 3.15 * (1 - u);
    const arch = Math.sin(Math.PI * u);
    const base = target.set(
      dir * (outer + arch * (.55 + coil * .25)),
      1.08 + u * 1.55 + Math.sin(Math.PI * u + side * .7 + time * 1.4) * .22,
      Math.sin(Math.PI * u * 1.15 + time * 1.1) * (.22 + coil * .24) + dir * arch * .16,
    );
    const radius = .22 + (1 - u) * (1.05 - coil * .45);
    const coilPoint = new THREE.Vector3(
      Math.cos(phase) * radius,
      1.55 + Math.sin(phase * 1.12) * (.3 + coil * .2),
      .35 + Math.sin(phase) * radius,
    );
    base.lerp(coilPoint, coil);
    const thickness = radial * (.1 + .18 * (1 - u));
    base.x += Math.cos(angle + phase) * thickness;
    base.y += Math.sin(angle + phase) * thickness;
    base.z += Math.sin(angle) * thickness;
    return base.applyAxisAngle(up, entryOrientation);
  }

  function update(time, options = {}) {
    if (!active) return;
    const previousTime = lastTime;
    const delta = Math.max(0, time - previousTime);
    lastTime = time;
    const progressiveMode = Number.isFinite(options.progress);
    const progress = progressiveMode ? Math.max(0, Math.min(1, options.progress)) : 0;
    const completed = progressiveMode && options.completed === true;
    lastProgress = progressiveMode ? progress : null;
    lastCompleted = completed;
    if (progressiveMode) {
      const smoothing = Math.min(1, delta * 9);
      visualProgress += (progress - visualProgress) * smoothing;
    } else {
      visualProgress = progress;
    }
    const pose = sampleRecombination(time);
    const overview = Math.max(6.2, 3.6 / aspect);
    const finalHeight = Math.max(3.35, 3 / aspect);
    const composition = progressiveMode
      ? finalHeight
      : THREE.MathUtils.lerp(overview, finalHeight, smoothRange(2.5, 4.3, time));
    const progressiveEntrySpacing = Math.min(1.45, composition * aspect * .4);
    const baseSpin = sampleRecombinationRotation(time, entryAngularVelocity);
    let spin;
    if (progressiveMode) {
      const targetVelocity = entryAngularVelocity * (
        .82 + visualProgress * 6.8 + visualProgress * visualProgress * 5.5
      );
      const acceleration = Math.min(1, delta * (2.2 + visualProgress * 8));
      spinVelocity += (targetVelocity - spinVelocity) * acceleration;
      spinAngle += spinVelocity * delta;
      spin = spinAngle;
    } else {
      spin = frenzyRotation(time);
    }
    spinRoot.rotation.y = spin;
    spinRoot.updateMatrixWorld(true);
    if (!progressiveMode && pose.separate > 0 && !splitMeshes) {
      snapshots.forEach(({ mesh }) => scene.add(mesh));
      splitMeshes = true;
    }
    for (const snapshot of snapshots) {
      snapshot.mesh.visible = progressiveMode
        ? !completed || progress < 1
        : pose.draw < 1 || (pose.separate > 0 && pose.escape < 1);
      if (!snapshot.mesh.visible) continue;
        const position = snapshot.mesh.geometry.attributes.position;
        const fade = progressiveMode
          ? 1 - smoothRange(.62, 1, progress) * .82
        : pose.separate > 0 ? smoothRange(0, .18, pose.separate) : 1;
      materialsOf(snapshot.mesh).forEach((material) => {
        material.transparent = fade < 1;
        material.opacity = fade;
      });
        for (let i = 0; i < position.count; i++) {
          const o = i * 3;
          if (progressiveMode) {
            const shapeProgress = FUSION_ENTRY_SHAPE +
              (1 - FUSION_ENTRY_SHAPE) * visualProgress;
            const entryBlend = smoothRange(0, .82, visualProgress);
            const entryX = snapshot.restored[o] -
              snapshot.exitDirection * 3.35 +
              snapshot.exitDirection * progressiveEntrySpacing;
            bioPoint(
              snapshot.samples[o], snapshot.samples[o + 1], snapshot.samples[o + 2],
              snapshot.side, time, shapeProgress, point,
            );
            // Start from the original silhouettes at the two stage positions,
            // then blend straight into the biological coil as the player presses.
            position.setXYZ(
              i,
              THREE.MathUtils.lerp(entryX, point.x, entryBlend),
              THREE.MathUtils.lerp(snapshot.restored[o + 1], point.y, entryBlend),
              THREE.MathUtils.lerp(snapshot.restored[o + 2], point.z, entryBlend),
            );
        } else {
          tubePoint(snapshot.samples[o], snapshot.samples[o + 1], snapshot.samples[o + 2], snapshot.side, time, pose, point);
        }
        if (!progressiveMode && pose.separate > 0) {
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
        } else if (!progressiveMode) {
          position.setXYZ(i,
            THREE.MathUtils.lerp(snapshot.source[o], point.x, pose.draw),
            THREE.MathUtils.lerp(snapshot.source[o + 1], point.y, pose.draw),
            THREE.MathUtils.lerp(snapshot.source[o + 2], point.z, pose.draw));
        }
      }
      position.needsUpdate = true;
      snapshot.mesh.geometry.computeVertexNormals();
    }
    // The old rigid double-helix tubes are retired from the playable film.
    helix.visible = false;
    const stageIn = progressiveMode ? 1 : smoothRange(3.25, 4.05, time);
    const lightIn = progressiveMode ? 1 : smoothRange(3.45, 4.25, time);
    const frenzy = progressiveMode ? smoothRange(.34, .96, visualProgress) : smoothRange(2.2, 4.35, time);
    backdropWaves.forEach((layer, layerIndex) => {
      const { position, base } = layer;
      for (let i = 0; i < position.count; i++) {
        const o = i * 3;
        const x = base[o], y = base[o + 1];
        const phase = time * layer.speed + layerIndex * 1.7;
        const swayX = Math.sin(y * (.34 + layer.twist) + phase + x * .08) * (.22 + frenzy * .28);
        const swayY = Math.cos(x * (.27 + layer.twist) - phase * 1.23 + y * .1) * (.18 + frenzy * .22);
        const depth = Math.sin(x * .42 + y * .31 + phase * 1.8) * (.18 + frenzy * .34);
        position.setXYZ(i, x + swayX, y + swayY, depth);
      }
      position.needsUpdate = true;
      layer.mesh.rotation.z = Math.sin(time * (.17 + layerIndex * .08) + layerIndex) * (.018 + frenzy * .04);
      layer.mesh.scale.set(
        1 + Math.sin(time * .31 + layerIndex) * (.015 + frenzy * .06),
        1 + Math.cos(time * .27 + layerIndex) * (.018 + frenzy * .05),
        1,
      );
      layer.mesh.material.opacity = layer.opacity * (.78 + frenzy * .22);
      layer.mesh.material.color.setHSL(
        (.28 + layerIndex * .055 + Math.sin(time * (.13 + layerIndex * .04)) * .035) % 1,
        .82 + frenzy * .16,
        .52 + Math.sin(time * 1.1 + layerIndex) * .06,
      );
    });
    stageRoot.visible = stageIn > 0;
    stageRoot.position.y = -2.2 + stageIn * 2.2;
    stageRoot.rotation.y = spin * .18;
    stageMaterial.emissiveIntensity = .7 + frenzy * 1.9;
    stageRings.forEach((ring, index) => {
      ring.rotation.z = spin * (.6 + index * .28);
      ring.material.opacity = .5 + frenzy * .55;
      ring.material.color.setHSL((time * (.19 + index * .08) + index * .18) % 1, .98, .62);
    });
    stageColumns.forEach((column, index) => {
      column.material.opacity = .42 + frenzy * .72;
      column.material.color.setHSL((time * (.18 + frenzy * .08) + index * .16) % 1, .92, .62);
    });
    stageSpokes.forEach((spoke, index) => {
      spoke.rotation.y = spin * (.16 + index * .012);
      spoke.material.opacity = .26 + frenzy * .72;
      spoke.material.color.setHSL((time * .22 + index * .083) % 1, .98, .62);
    });
    stageNodes.forEach((node, index) => {
      const angle = spin * .16 + index * Math.PI / 6;
      const radius = 2.23 + Math.sin(time * 5 + index) * .045;
      node.position.set(Math.cos(angle) * radius, .29 + Math.sin(time * 7 + index) * .04, Math.sin(angle) * radius);
      node.scale.setScalar(.65 + frenzy * .8 + Math.sin(time * 11 + index) * .16);
      node.material.opacity = .42 + frenzy * .58;
      node.material.color.setHSL((time * .25 + index * .09) % 1, 1, .64);
    });
    stagePanels.forEach((panel, index) => {
      const angle = spin * .13 + index * Math.PI * 2 / stagePanels.length;
      panel.position.set(Math.cos(angle) * 2.35, .34 + Math.sin(time * 8 + index) * .025, Math.sin(angle) * 2.35);
      panel.rotation.y = angle;
      panel.material.opacity = .26 + frenzy * .72;
      panel.material.color.setHSL((time * .28 + index * .065) % 1, 1, .54);
    });
    discoRoot.visible = lightIn > 0;
    discoRoot.position.set(0, 7.4 - lightIn * 3.1, .55);
    discoRoot.rotation.y = spin * 1.2;
    discoRoot.rotation.z = Math.sin(time * 4.2) * .12 * frenzy;
    discoShell.material.emissiveIntensity = 1.2 + frenzy * 3.5;
    discoBands.forEach((band, index) => {
      band.rotation.x = time * (.8 + frenzy * (2.8 + index * .7));
      band.rotation.y = time * (1.2 + frenzy * (3.6 + index * .9));
      band.rotation.z = time * (.4 + frenzy * (1.4 + index * .35));
      band.material.color.setHSL((time * (.16 + index * .08) + index * .22) % 1, .9, .64);
    });
    discoPrisms.forEach((prism, index) => {
      const angle = time * (.7 + frenzy * 3.4) + index * Math.PI / 3;
      prism.position.set(Math.cos(angle) * (.42 + frenzy * .12), Math.sin(angle * 1.7) * .34, Math.sin(angle) * (.42 + frenzy * .12));
      prism.rotation.x = time * (1.4 + frenzy * 4.5) + index;
      prism.rotation.y = time * (1.1 + frenzy * 3.1) - index * .7;
      prism.material.opacity = .32 + frenzy * .62;
      prism.material.color.setHSL((time * .21 + index * .17) % 1, 1, .62);
    });
    discoBeam.material.opacity = .06 + frenzy * .17;
    discoBeam.material.color.setHSL((time * .18 + frenzy * .2) % 1, .98, .68);
    discoPoint.intensity = lightIn * (2.2 + frenzy * 8.5);
    discoLights.forEach((light, index) => {
      const angle = spin * (.22 + index * .05) + index * Math.PI / 2;
      light.position.set(
        Math.cos(angle) * (2.2 + frenzy * .8),
        2.4 + Math.sin(time * 2 + index) * .5,
        Math.sin(angle) * (2.2 + frenzy * .8),
      );
      light.intensity = stageIn * (frenzy * 4.5 + .25);
      light.color.setHSL((time * (.14 + index * .03) + index * .23) % 1, .92, .62);
    });
    laserBeams.forEach((beam, index) => {
      const angle = spin * (.1 + index * .006) + index * Math.PI * 2 / LASERS + time * (.18 + frenzy * .9);
      const innerRadius = 1.2 + frenzy * 1.5 + (index % 3) * .18;
      const outerRadius = 2.1 + frenzy * 2.2 + (index % 4) * .25;
      const flicker = ((index * 7 + Math.floor(time * (9 + frenzy * 23))) % 13 < 2) ? .3 : 1;
      laserStart.set(
        Math.cos(angle) * innerRadius,
        3.4 + Math.sin(time * 2.7 + index) * (.25 + frenzy * .45),
        .35 + Math.sin(angle) * innerRadius,
      );
      laserEnd.set(
        Math.cos(angle + .45 + Math.sin(time * 2 + index) * .12) * outerRadius,
        .22 + Math.sin(time * 3.4 + index) * (.15 + frenzy * .22),
        .1 + Math.sin(angle + .45) * outerRadius,
      );
      laserDirection.subVectors(laserEnd, laserStart);
      const length = laserDirection.length();
      beam.position.copy(laserStart).add(laserEnd).multiplyScalar(.5);
      beam.quaternion.setFromUnitVectors(up, laserDirection.normalize());
      beam.scale.set(1, length, 1);
      beam.visible = stageIn > .05;
      beam.material.opacity = flicker * stageIn * (.16 + frenzy * .82);
      beam.material.color.setHSL((time * (.28 + frenzy * .16) + index * .071) % 1, 1, .52);
    });
    scanlines.forEach((line, index) => {
      const activeLine = stageIn > .1 && ((index * 5 + Math.floor(time * (8 + frenzy * 22))) % 9 < 6);
      line.visible = activeLine;
      if (!activeLine) return;
      line.position.y = -2.8 + index * .43 + Math.sin(time * (2.4 + frenzy * 4) + index) * (.06 + frenzy * .18);
      line.rotation.z = Math.sin(time * 1.7 + index) * (.015 + frenzy * .07);
      line.material.opacity = stageIn * (.035 + frenzy * .23) * (index % 4 === 0 ? 1.35 : 1);
      line.material.color.setHSL((time * .31 + index * .11) % 1, 1, .5);
    });
    glitchBars.forEach((bar, index) => {
      const activeBar = stageIn > .12 && ((index * 13 + Math.floor(time * (7 + frenzy * 19))) % 7 < 3);
      bar.visible = activeBar;
      if (!activeBar) return;
      const seed = index * 1.618;
      bar.position.set(
        Math.sin(seed + time * (2 + frenzy * 7)) * (3.4 + frenzy * 2),
        .7 + (index % 7) * .48 + Math.sin(seed + time * 5) * .16,
        -1.5 + Math.cos(seed + time * 4) * 1.7,
      );
      bar.rotation.set(time * (index % 2 ? -7 : 9), time * 4, time * 6);
      bar.material.opacity = .16 + frenzy * .8;
      bar.material.color.setHSL((time * (.35 + frenzy * .12) + index * .07) % 1, 1, .52);
    });
    if (progressiveMode && completed && birthStartedAt < 0) birthStartedAt = time;
    const birthAge = birthStartedAt >= 0 ? Math.max(0, time - birthStartedAt) : -1;
    const birthProgress = birthAge >= 0 ? clamp01(birthAge / .92) : 0;
    const birth = progressiveMode
      ? {
        visible: birthAge >= 0,
        scale: birthProgress === 0 ? 0 : 1 + 2.45 * (birthProgress - 1) ** 3 + 1.45 * (birthProgress - 1) ** 2,
        lift: Math.sin(Math.PI * birthProgress) * .72,
        firework: birthAge >= 0 && birthAge < 1.25 ? birthAge : -1,
      }
      : sampleHybridBirth(time);
    const explosion = progressiveMode
      ? smoothRange(0, .5, birthAge)
      : smoothRange(3.65, 4.45, time);
    fusionOrb.visible = progressiveMode && visualProgress > .42 && birthAge < 0;
    if (fusionOrb.visible) {
      fusionOrb.scale.setScalar(.28 + visualProgress * .9 + Math.sin(time * 8) * frenzy * .06);
      fusionOrb.rotation.set(time * (1.2 + frenzy * 8), spin * .3, time * (1.8 + frenzy * 6));
      fusionOrb.material.color.setHSL(.02 + visualProgress * .11, .78, .48 + frenzy * .1);
      fusionOrb.material.emissiveIntensity = .7 + frenzy * 4;
      fusionOrb.material.opacity = .48 + visualProgress * .42;
    }
    shockwave.visible = explosion > 0 && explosion < 1;
    shockwave.scale.setScalar(1 + explosion * 6);
    shockwave.material.opacity = (1 - explosion) * .85;
    shockwave.material.color.setHSL((.12 + time * .1) % 1, .95, .68);
    burstLight.intensity = explosion > 0 ? (1 - explosion) * 15 : 0;
    if (resultAsset) {
      resultAsset.root.visible = birth.visible;
      resultAsset.root.scale.setScalar(birth.scale);
      resultAsset.root.position.set(0, .8 + birth.lift, .4);
    }
    sparks.visible = birth.firework >= 0 || (explosion > 0 && explosion < 1);
    if (sparks.visible) {
      const age = birth.firework >= 0 ? birth.firework : explosion * 1.15;
      sparkMaterial.opacity = birth.firework >= 0
        ? (1 - smoothRange(.25, 1.15, age)) * .95
        : (1 - explosion) * .8;
      velocities.forEach((velocity, i) => {
        const burstAge = birth.firework >= 0 ? age : Math.max(0, age - .18);
        dummy.position.copy(velocity).multiplyScalar(burstAge);
        dummy.position.y += 1.35 - 1.3 * burstAge * burstAge;
        dummy.position.z += 1.8;
        dummy.quaternion.setFromUnitVectors(up, tangent.copy(velocity).normalize());
        const radius = (.035 + (i % 3) * .012) * (1 - age / 1.3);
        dummy.scale.set(radius, radius * (5 - age * 2), radius);
        dummy.updateMatrix();
        sparks.setMatrixAt(i, dummy.matrix);
      });
      sparks.instanceMatrix.needsUpdate = true;
    }
    const cameraBlend = progressiveMode ? 1 : smoothRange(0, FILM_DRAWN_AT, time);
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
    const shake = frenzy * frenzy * .055 + explosion * .08;
    camera.position.x = Math.sin(time * 27) * shake;
    camera.position.z = 24 + Math.cos(time * 23) * shake;
    camera.lookAt(
      Math.sin(time * 19) * shake * .4,
      2 + Math.sin(time * 17) * shake * .3,
      0,
    );
    // Local +X faces out of the screen; retain the camera's up direction.
    if (resultAsset) resultAsset.root.quaternion.copy(camera.quaternion).multiply(resultFacing);
    const birthReady = progressiveMode ? birthProgress >= .78 : time >= FILM_BIRTH_AT;
    if (birthReady && !fired) {
      fired = true;
      onBirth({ source: resultAsset?.source || "none", time: progressiveMode ? birthStartedAt : FILM_BIRTH_AT });
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
      if (active) {
        update(lastTime, Number.isFinite(lastProgress)
          ? { progress: lastProgress, completed: lastCompleted }
          : {});
      }
    },
    render(renderer) { if (active) renderer.render(scene, camera); },
    reset() {
      active = false; lastTime = 0; fired = false; splitMeshes = false;
      birthStartedAt = -1;
      spinAngle = 0; spinVelocity = 0; visualProgress = 0;
      lastProgress = null; lastCompleted = false;
      spinRoot.rotation.y = 0;
      entryOrientation = 0;
      clearSnapshots();
      sparks.visible = false;
      stageRoot.visible = false;
      discoRoot.visible = false;
      glitchBars.forEach((bar) => { bar.visible = false; });
      laserBeams.forEach((beam) => { beam.visible = false; });
      scanlines.forEach((line) => { line.visible = false; });
      shockwave.visible = false;
      burstLight.intensity = 0;
      fusionOrb.visible = false;
      if (resultAsset) { resultAsset.root.visible = false; resultAsset.root.scale.setScalar(0); }
    },
    dispose() {
      active = false;
      clearSnapshots();
      resultAsset?.dispose();
      tubes.forEach(({ geometry }) => geometry.dispose());
      strandMaterials.forEach((material) => material.dispose());
      sparks.dispose(); sparkGeometry.dispose(); sparkMaterial.dispose();
      stage.geometry.dispose(); stageMaterial.dispose();
      stageTrim.geometry.dispose(); stageTrimMaterial.dispose();
      stageRings.forEach((ring) => { ring.geometry.dispose(); ring.material.dispose(); });
      stageColumns.forEach((column) => { column.geometry.dispose(); column.material.dispose(); });
      stageSpokes.forEach((spoke) => { spoke.geometry.dispose(); spoke.material.dispose(); });
      stageNodes.forEach((node) => { node.geometry.dispose(); node.material.dispose(); });
      stagePanels.forEach((panel) => { panel.geometry.dispose(); panel.material.dispose(); });
      discoShell.geometry.dispose(); discoShell.material.dispose();
      discoBands.forEach((band) => { band.geometry.dispose(); band.material.dispose(); });
      discoPrisms.forEach((prism) => { prism.geometry.dispose(); prism.material.dispose(); });
      discoBeam.geometry.dispose(); discoBeam.material.dispose(); discoPoint.dispose();
      discoLights.forEach((light) => light.dispose());
      laserBeams.forEach((beam) => { beam.geometry.dispose(); beam.material.dispose(); });
      scanlines.forEach((line) => { line.geometry.dispose(); line.material.dispose(); });
      backdropWaves.forEach((layer) => { layer.geometry.dispose(); layer.mesh.material.dispose(); });
      glitchBars.forEach((bar) => { bar.geometry.dispose(); bar.material.dispose(); });
      shockwave.geometry.dispose(); shockwave.material.dispose(); burstLight.dispose();
      fusionOrb.geometry.dispose(); fusionOrb.material.dispose();
    },
  };
}
