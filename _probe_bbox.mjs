import { runGame, DRIVER_HEAD } from './test/harness.mjs';
const DRIVER = `
${DRIVER_HEAD}
console.log('name        bboxY(min~max)     sizeX  sizeY  sizeZ   scale范围      实际高(m) 实际宽(m)  材质');
for (const mesh of propMeshes) {
  const def = PROP_DEFS.find(d => 'prop:' + d.name === mesh.name);
  const bb = mesh.geometry.boundingBox;
  const mt = mesh.material;
  console.log(
    def.name.padEnd(10) +
    (bb.min.y.toFixed(3) + '~' + bb.max.y.toFixed(3)).padEnd(18) +
    (bb.max.x - bb.min.x).toFixed(3).padStart(6) +
    (bb.max.y - bb.min.y).toFixed(3).padStart(7) +
    (bb.max.z - bb.min.z).toFixed(3).padStart(7) + '   ' +
    (def.s[0] + '~' + def.s[1]).padEnd(14) +
    ((bb.max.y - bb.min.y) * def.s[1]).toFixed(2).padStart(7) +
    ((bb.max.x - bb.min.x) * def.s[1]).toFixed(2).padStart(8) + '   ' +
    ('metal ' + (mt.metalness ?? '-') + ' rough ' + (mt.roughness ?? '-') + ' map ' + (mt.map ? 'Y' : 'N') + (mt.vertexColors ? ' vc' : ''))
  );
}
/* 贴地核验：模型空间最低点 × 该实例缩放 + 实例位置 y，必须恒为 0 */
let worst = 0, worstN = '';
const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
for (const mesh of propMeshes) {
  const lo = mesh.geometry.boundingBox.min.y;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
    const base = p.y + lo * s.y;
    if (Math.abs(base) > Math.abs(worst)) { worst = base; worstN = mesh.name + '#' + i; }
  }
}
console.log('\\n模型空间底面 min.y × 缩放 + 位置 y → 最大偏离 ' + worst.toFixed(6) + ' （' + worstN + '）');
`;
await runGame(DRIVER);
