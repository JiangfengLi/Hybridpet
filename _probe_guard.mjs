/**
 * 验证 integration.mjs 9b 节那条"小物件被树占位"断言**不是装饰品**：
 * 先按现状跑一遍（期望 0 例），再把一棵灌木强行挪到某棵树心，看它是否真的报出来。
 * 不改生产代码 —— 只在探针里改 instanceMatrix。
 *
 * 检测逻辑必须与 integration.mjs 里的断言**逐字同构**，否则验的是另一个东西。
 * 历史上两次"全绿"都是假的：① 用包围盒水平半径判 → 误报石头；② 粗筛半径读
 * `elements[0]`（yaw=−120.7° 时为负）→ 每棵树都被跳过，断言恒真。
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';
const DRIVER = `
${DRIVER_HEAD}
const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();

function detect() {
  const trees = [];
  for (const mesh of propMeshes) {
    if (mesh.name !== 'prop:tree-01') continue;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      m4.decompose(tp, tq, ts);
      const tx = tp.x, tz = tp.z;
      const pts = [];
      let rad = 0;
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(m4);
        pts.push([v.x, v.y, v.z]);
        const d = Math.hypot(v.x - tx, v.z - tz);
        if (d > rad) rad = d;
      }
      trees.push({ pts, tx, tz, rad });
    }
  }
  const out = [];
  for (const mesh of propMeshes) {
    if (mesh.name === 'prop:tree-01') continue;
    const bb = mesh.geometry.boundingBox;
    const rad0 = 0.5 * Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      m4.decompose(tp, tq, ts);
      const px = tp.x, py = tp.y, pz = tp.z;
      const top = py + bb.max.y * ts.y;
      const R = rad0 * ts.x;
      for (const t of trees) {
        if (Math.hypot(t.tx - px, t.tz - pz) > t.rad + R) continue;
        let lowest = Infinity;
        for (const r of t.pts) {
          if (r[1] > top) continue;
          if (Math.hypot(r[0] - px, r[2] - pz) > R) continue;
          if (r[1] < lowest) lowest = r[1];
        }
        if (lowest !== Infinity && lowest - top <= 0)
          out.push({ id: mesh.name + '#' + i, by: (lowest - top).toFixed(2) });
      }
    }
  }
  return out;
}

const before = detect();
console.log('现状检出 = ' + before.length + ' 例（期望 0）' +
            (before.length ? '  → ' + before.slice(0, 3).map(r => r.id + ' ' + r.by + 'm').join('; ') : ''));

/* 强行制造违规：把 bush 的第 0 个实例挪到第 0 棵树心上（保留自身姿态与缩放） */
const bush = propMeshes.find(m => m.name === 'prop:bush-01');
const tree = propMeshes.find(m => m.name === 'prop:tree-01');
const tm = new THREE.Matrix4(); tree.getMatrixAt(0, tm);
const tpos = new THREE.Vector3(), tq2 = new THREE.Quaternion(), tsc = new THREE.Vector3();
tm.decompose(tpos, tq2, tsc);
const bm = new THREE.Matrix4(); bush.getMatrixAt(0, bm);
const bpos = new THREE.Vector3(), bq = new THREE.Quaternion(), bsc = new THREE.Vector3();
bm.decompose(bpos, bq, bsc);
bush.setMatrixAt(0, new THREE.Matrix4().compose(tpos.clone(), bq, bsc));
bush.instanceMatrix.needsUpdate = true;
console.log('已把 bush-01#0 移到 tree-01#0 树心 (' + tpos.x.toFixed(1) + ', ' + tpos.z.toFixed(1) + ')');

const after = detect();
const hit = after.some(r => r.id === 'prop:bush-01#0');
console.log('制造违规后检出 = ' + after.length + ' 例（期望 >= 1，且包含 prop:bush-01#0）' +
            (after.length ? '  → ' + after.slice(0, 3).map(r => r.id + ' ' + r.by + 'm').join('; ') : ''));
console.log(hit ? '>>> 检测器有效，断言不是装饰品 <<<' : '>>> 检测器失效！<<<');
if (!hit) process.exitCode = 1;
`;
await runGame(DRIVER);
