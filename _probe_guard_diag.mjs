/**
 * 诊断：为什么"把小物件挪到树心"之后，遮挡检测器仍然报 0 例。
 * 只打印数字，不下结论。跑完即删。
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';
const DRIVER = `
${DRIVER_HEAD}
const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
const dp = new THREE.Vector3(), dq = new THREE.Quaternion(), ds = new THREE.Vector3();

const tree = propMeshes.find(m => m.name === 'prop:tree-01');
const bush = propMeshes.find(m => m.name === 'prop:bush-01');
console.log('tree-01 实例数 = ' + tree.count + ' / bush-01 实例数 = ' + bush.count);
console.log('tree 几何顶点数 = ' + tree.geometry.attributes.position.count +
            ' / bush 几何顶点数 = ' + bush.geometry.attributes.position.count);

const tb = tree.geometry.boundingBox, bbB = bush.geometry.boundingBox;
console.log('tree bbox x=' + tb.min.x.toFixed(3) + '..' + tb.max.x.toFixed(3) +
            ' y=' + tb.min.y.toFixed(3) + '..' + tb.max.y.toFixed(3) +
            ' z=' + tb.min.z.toFixed(3) + '..' + tb.max.z.toFixed(3));
console.log('bush bbox x=' + bbB.min.x.toFixed(3) + '..' + bbB.max.x.toFixed(3) +
            ' y=' + bbB.min.y.toFixed(3) + '..' + bbB.max.y.toFixed(3) +
            ' z=' + bbB.min.z.toFixed(3) + '..' + bbB.max.z.toFixed(3));

/* ---- 树 #0 的三种"位置" ---- */
tree.getMatrixAt(0, m4);
m4.decompose(dp, dq, ds);
const tpx = dp.x, tpy = dp.y, tpz = dp.z, tsx = ds.x, tsy = ds.y, tsz = ds.z;
console.log('tree-01#0 变换原点 = (' + tpx.toFixed(2) + ', ' + tpy.toFixed(2) + ', ' + tpz.toFixed(2) + ')' +
            '  缩放 = (' + tsx.toFixed(2) + ', ' + tsy.toFixed(2) + ', ' + tsz.toFixed(2) + ')' +
            '  elements[0] = ' + m4.elements[0].toFixed(3));
console.log('tree-01#0 绕 y 的 yaw ≈ ' + (Math.atan2(m4.elements[8], m4.elements[10]) * 180 / Math.PI).toFixed(1) + '°');

const pos0 = tree.geometry.attributes.position;
let cx = 0, cz = 0, minY = Infinity, maxY = -Infinity;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let k = 0; k < pos0.count; k++) {
  v.fromBufferAttribute(pos0, k).applyMatrix4(m4);
  cx += v.x; cz += v.z;
  if (v.y < minY) minY = v.y;
  if (v.y > maxY) maxY = v.y;
  if (v.x < minX) minX = v.x;
  if (v.x > maxX) maxX = v.x;
  if (v.z < minZ) minZ = v.z;
  if (v.z > maxZ) maxZ = v.z;
}
cx /= pos0.count; cz /= pos0.count;
console.log('tree-01#0 顶点质心 = (' + cx.toFixed(2) + ', ' + cz.toFixed(2) + ')' +
            '   质心到变换原点 = ' + Math.hypot(cx - tpx, cz - tpz).toFixed(2) + ' m');
console.log('tree-01#0 顶点实际世界包围盒 x=' + minX.toFixed(2) + '..' + maxX.toFixed(2) +
            ' y=' + minY.toFixed(2) + '..' + maxY.toFixed(2) +
            ' z=' + minZ.toFixed(2) + '..' + maxZ.toFixed(2));
console.log('  水平半径(包围盒) = ' + (0.5 * Math.hypot(maxX - minX, maxZ - minZ)).toFixed(2) +
            ' m  粗筛 t.rad 用 elements[0] 得 ' +
            (0.5 * Math.hypot(tb.max.x - tb.min.x, tb.max.z - tb.min.z) * m4.elements[0]).toFixed(2) +
            ' m  用 decompose.sx 得 ' +
            (0.5 * Math.hypot(tb.max.x - tb.min.x, tb.max.z - tb.min.z) * tsx).toFixed(2) + ' m');

/* ---- 树几何在 y<=1.67 的分布（看树干到底有多细） ---- */
const band = [];
for (let k = 0; k < pos0.count; k++) {
  v.fromBufferAttribute(pos0, k).applyMatrix4(m4);
  if (v.y <= 1.8) band.push(Math.hypot(v.x - tpx, v.z - tpz));
}
band.sort((a, b) => a - b);
if (band.length) {
  console.log('y<=1.8 的树顶点数 = ' + band.length +
              '  水平距树心：中位 ' + band[band.length >> 1].toFixed(2) +
              ' m  最大 ' + band[band.length - 1].toFixed(2) + ' m');
} else {
  console.log('y<=1.8 的树顶点数 = 0 —— 叶团全在 1.8 m 以上');
}

/* ---- bush-01#0 现状 ---- */
bush.getMatrixAt(0, m4);
m4.decompose(dp, dq, ds);
console.log('bush-01#0 现状原点 = (' + dp.x.toFixed(2) + ', ' + dp.y.toFixed(2) + ', ' + dp.z.toFixed(2) + ')' +
            '  缩放 = (' + ds.x.toFixed(2) + ', ' + ds.y.toFixed(2) + ', ' + ds.z.toFixed(2) + ')' +
            '  顶面 y = ' + (dp.y + bbB.max.y * ds.y).toFixed(2) +
            '  水平半径 R = ' + (0.5 * Math.hypot(bbB.max.x - bbB.min.x, bbB.max.z - bbB.min.z) * ds.x).toFixed(2));
`;
await runGame(DRIVER);
