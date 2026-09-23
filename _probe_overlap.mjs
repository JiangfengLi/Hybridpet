/**
 * 交叉遮挡体检：prop 之间**互不避让**（8c 的 avoidList 只避信号源和素材），
 * 所以小模型可能整个藏进大树冠里、或与大石头重叠。
 * 这里逐实例两两算 2D 距离，和两者水平半径之和比，列出重叠最严重的。
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';
const DRIVER = `
${DRIVER_HEAD}
const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
const insts = [];
for (const mesh of propMeshes) {
  const def = PROP_DEFS.find(d => 'prop:' + d.name === mesh.name);
  const bb = mesh.geometry.boundingBox;
  /* 水平半径用包围盒的 XZ 半对角线（含旋转的最坏情形），比"看上去的半径"保守 */
  const radXZ = 0.5 * Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  const radX = (bb.max.x - bb.min.x) / 2, radZ = (bb.max.z - bb.min.z) / 2;
  const hy  = (bb.max.y - bb.min.y);
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
    insts.push({ def: def.name, i, x: p.x, z: p.z, radX: radX * s.x, radZ: radZ * s.x, radXZ: radXZ * s.x, h: hy * s.x, isTree: def.name === 'tree-01' });
  }
}
console.log('实例总数 ' + insts.length);

/* 树冠在地面附近的水平投影半径 —— 树干细但树叶宽；用整棵树的 radXZ 作为"被挡住"的判据 */
const trees = insts.filter(a => a.isTree);
const small = insts.filter(a => !a.isTree);

let hidden = [];
for (const a of small) {
  let best = null;
  for (const t of trees) {
    const d = Math.hypot(t.x - a.x, t.z - a.z);
    /* 树冠在"小模型顶部"那个高度的实际半径 ≈ 整棵树的 radXZ（树是下宽上窄与否未知，
       这里用保守上界）。判据：小模型完全落在树冠水平投影内 */
    const inside = d + Math.max(a.radX, a.radZ) <= Math.max(t.radX, t.radZ);
    if (!best || d < best.d) best = { d, t };
    if (inside) hidden.push({ ...a, tree: t, d });
  }
  a.nearestTree = best;
}

const byType = {};
for (const a of small) {
  (byType[a.def] ||= { n: 0, hidden: 0, near: 0, minD: 1e9, sumD: 0 });
  const b = byType[a.def];
  b.n++; b.sumD += a.nearestTree.d; b.minD = Math.min(b.minD, a.nearestTree.d);
  if (a.nearestTree.d < Math.max(a.radX, a.radZ) + 2) b.near++;
}
console.log('\\n类型        实例  被树冠完全罩住  离树<自半径+2m  离最近树(最小/平均)');
for (const [k, b] of Object.entries(byType)) {
  console.log('  ' + k.padEnd(10) + String(b.n).padStart(3) + String(b.hidden).padStart(14) +
              String(b.near).padStart(16) + '   ' + b.minD.toFixed(1) + ' / ' + (b.sumD / b.n).toFixed(1) + ' m');
}
console.log('\\n=== 被树冠罩住的实例（完全落在树冠水平投影内）===');
if (!hidden.length) console.log('  无');
for (const h of hidden.sort((a, b) => a.d - b.d))
  console.log('  ' + h.def.padEnd(10) + '#' + String(h.i).padStart(2) + ' @(' + h.x.toFixed(1) + ',' + h.z.toFixed(1) + ')' +
              '  自身半径 ' + Math.max(h.radX, h.radZ).toFixed(2) + ' m  树顶半径 ' + Math.max(h.tree.radX, h.tree.radZ).toFixed(2) + ' m  中心距 ' + h.d.toFixed(2) + ' m');

/* 同类之间是否也有重叠（同类有 minGap，应该没有） */
console.log('\\n=== 任意两实例的水平重叠（判据：中心距 < 两者最大水平半径之和 × 0.8）===');
let ov = [];
for (let a = 0; a < insts.length; a++) for (let b = a + 1; b < insts.length; b++) {
  const A = insts[a], B = insts[b];
  const d = Math.hypot(A.x - B.x, A.z - B.z);
  const lim = (Math.max(A.radX, A.radZ) + Math.max(B.radX, B.radZ)) * 0.8;
  if (d < lim) ov.push({ A, B, d, lim });
}
console.log('  重叠对数 = ' + ov.length);
for (const o of ov.sort((p, q) => (p.d / p.lim) - (q.d / q.lim)).slice(0, 12)) {
  console.log('  ' + o.A.def.padEnd(9) + '#' + String(o.A.i).padStart(2) + '  ×  ' + o.B.def.padEnd(9) + '#' + String(o.B.i).padStart(2) +
              '   距 ' + o.d.toFixed(2) + ' m / 阈 ' + o.lim.toFixed(2) + ' m');
}
`;
await runGame(DRIVER);
