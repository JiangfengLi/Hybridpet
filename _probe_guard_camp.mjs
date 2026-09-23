/**
 * 守卫探针：验证 9c 节那几条营地断言**不是装饰品**。
 * 做法和 _probe_guard.mjs 一样 —— 按现状跑一遍（期望 0 例），
 * 然后在探针里**人为制造违规**（只改 instanceMatrix，不碰生产代码），看检测器会不会响。
 *
 * 为什么必须做这一步：上一轮的"小物件被树占位"断言两次"全绿"都是假的
 * （先是用包围盒半径误报、后是粗筛半径读到负数导致恒真）。
 * 检测逻辑必须与 test/integration.mjs 里的**逐字同构**，否则验的是另一个东西。
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';

const DRIVER = `
${DRIVER_HEAD}
const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();

/* ---- 与 integration.mjs 9c 节逐字同构的两个检测器 ---- */
function detectOverlap() {
  const bodies = [];
  for (const mesh of campMeshes) {
    const bb = mesh.geometry.boundingBox;
    const rad0 = 0.5 * Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
      bodies.push({ name: mesh.name + '#' + i, x: p.x, z: p.z,
                    r: rad0 * s.x, y0: p.y + bb.min.y * s.y, y1: p.y + bb.max.y * s.y });
    }
  }
  const hits = [];
  for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) {
    const A = bodies[a], B = bodies[b];
    if (A.name.startsWith('prop:camp-fence') && B.name.startsWith('prop:camp-fence')) continue;
    if (A.y0 > B.y1 || B.y0 > A.y1) continue;
    const d = Math.hypot(A.x - B.x, A.z - B.z);
    const gap = d - (A.r + B.r);
    if (gap < -1e-6) hits.push(A.name + ' ↔ ' + B.name);
  }
  return hits;
}

function detectFenceGap() {
  const fm = campMeshes.find(m => m.name === 'prop:camp-fence');
  const pts = [];
  for (let i = 0; i < fm.count; i++) { fm.getMatrixAt(i, m4); m4.decompose(p, q, s); pts.push({ x: p.x, z: p.z }); }
  const chord = 0.393 * FENCE_S;
  let maxErr = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(pts[i+1].x - pts[i].x, pts[i+1].z - pts[i].z) - chord));
  }
  return { maxErr, chord, bad: maxErr >= chord * 0.05 };
}

function detectOffGround() {
  const bad = [];
  for (const mesh of campMeshes) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
    if (Math.abs(p.y - GROUND_Y) > 1e-6) bad.push(mesh.name + '#' + i + ' y=' + p.y.toFixed(3));
  }
  return bad;
}

console.log('营地中心 = (' + campStats.center.x + ', ' + campStats.center.z + ')，围栏 R = ' + FENCE_R.toFixed(2));
console.log('现状：重叠 ' + detectOverlap().length + ' 例（期望 0）｜离地 ' + detectOffGround().length +
            ' 例（期望 0）｜围栏弦长偏差 ' + detectFenceGap().maxErr.toFixed(3) + ' m（期望 ~0）');

/* ---- 违规 1：把 Cube 挪到营地中心（一定和 Dome 相交） ---- */
const cube = campMeshes.find(m => m.name === 'prop:camp-cube');
cube.getMatrixAt(0, m4);
m4.decompose(p, q, s);
const moved = new THREE.Matrix4().compose(
  new THREE.Vector3(campStats.center.x, p.y, campStats.center.z), q, s);
cube.setMatrixAt(0, moved);
cube.instanceMatrix.needsUpdate = true;
const ov = detectOverlap();
console.log('违规 1（Cube 挪到营地中心）→ 重叠 ' + ov.length + ' 例：' + (ov.slice(0, 2).join('; ') || '无'));
const g1 = ov.length > 0;

/* ---- 违规 2：把一段围栏甩到 20 m 外（一定裂出缝） ---- */
const fence = campMeshes.find(m => m.name === 'prop:camp-fence');
fence.getMatrixAt(0, m4);
m4.decompose(p, q, s);
fence.setMatrixAt(0, new THREE.Matrix4().compose(
  new THREE.Vector3(campStats.center.x + 20, p.y, campStats.center.z + 20), q, s));
fence.instanceMatrix.needsUpdate = true;
const fg = detectFenceGap();
console.log('违规 2（围栏第 0 段甩到 20 m 外）→ 弦长偏差 ' + fg.maxErr.toFixed(3) +
            ' m（阈值 ' + (fg.chord * 0.05).toFixed(3) + '），会报 = ' + fg.bad);
const g2 = fg.bad;

/* ---- 违规 3：把 Lamp 抬高 0.5 m（一定离地） ---- */
const lamp = campMeshes.find(m => m.name === 'prop:camp-lamp');
lamp.getMatrixAt(0, m4);
m4.decompose(p, q, s);
lamp.setMatrixAt(0, new THREE.Matrix4().compose(
  new THREE.Vector3(p.x, p.y + 0.5, p.z), q, s));
lamp.instanceMatrix.needsUpdate = true;
const og = detectOffGround();
console.log('违规 3（Lamp 抬高 0.5 m）→ 离地 ' + og.length + ' 例：' + (og.slice(0, 2).join('; ') || '无'));
const g3 = og.length > 0;

console.log('');
console.log('重叠检测器 ' + (g1 ? '有效' : '**失效**') +
            '｜围栏裂缝检测器 ' + (g2 ? '有效' : '**失效**') +
            '｜离地检测器 ' + (g3 ? '有效' : '**失效**'));
if (!(g1 && g2 && g3)) process.exitCode = 1;
`;
await runGame(DRIVER);
