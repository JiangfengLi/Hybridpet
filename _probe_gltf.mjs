/**
 * 探针：在**没有 DOM、没有 WebGL** 的 Node 里，能不能真的跑通 GLTFLoader.parse？
 * 这一步决定 harness 要怎么挡纹理加载那条路（否则 await 会永久挂住，测试不是失败而是卡死）。
 *
 * 结论要拿到的三件事：
 *   1) 纹理路径到底卡在哪一步（createImageBitmap? URL.createObjectURL? ImageLoader 的 onload 永不触发?）
 *   2) 9 个模型解析出来的真实顶点数 / 材质 / side
 *   3) node 上带不带变换（要不要 bake 进 geometry）
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

const DIR = './models';
const names = fs.readdirSync(DIR).filter(f => f.endsWith('.glb')).sort();
let texAttempts = 0;

/* ---------- 桩：三处都要挡，缺一处就会静默挂住 ---------- */
// ① GLTFLoader.js:3377 直接引 `self.URL` —— Node 里没有 self，一个 ReferenceError 从
//    loadImageSource 里同步抛出，会把整条 parse 打掉（不是降级，是直接失败）。
globalThis.self = globalThis;
// ② 让 GLTFLoader 走 ImageBitmapLoader 分支（`typeof createImageBitmap !== 'undefined'`）
globalThis.createImageBitmap = async () => { texAttempts++; return { width: 1, height: 1, close() {} }; };
// ③ 把该分支的 loader.load 换掉：否则它会去 fetch 一个 blob: URL，
//    Node 的 undici 不支持 blob:，结果是"靠实现细节恰好失败"，不如显式挡掉。
THREE.ImageBitmapLoader.prototype.load = function (url, onLoad) {
  texAttempts++;
  onLoad({ width: 1, height: 1, close() {} });
  return this;
};

const loader = new GLTFLoader();
let totalTris = 0;

for (const fn of names) {
  const buf = fs.readFileSync(path.join(DIR, fn));
  // Node 的 Buffer 是 Uint8Array 的子类，但 .buffer 可能是共享池里更大的那一块 → 必须切片
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const t0 = Date.now();
  const gltf = await loader.parseAsync(ab, DIR + '/');
  const ms = Date.now() - t0;

  gltf.scene.updateMatrixWorld(true);
  let mesh = null;
  gltf.scene.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
  const g = mesh.geometry;
  const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;

  const m = mesh.material;
  const matDesc = m
    ? [m.type, '#' + (m.color ? m.color.getHexString() : '?'),
       'metal=' + (m.metalness ?? '-'), 'rough=' + (m.roughness ?? '-'),
       m.map ? 'map' : 'nomap',
       'side=' + (m.side === THREE.DoubleSide ? 'Double' : m.side === THREE.FrontSide ? 'Front' : m.side)].join(' ')
    : '（无材质）';

  // node 自带变换吗？把 matrixWorld 套上去看 bbox 变化
  const bbBefore = g.boundingBox ? g.boundingBox.clone() : (g.computeBoundingBox(), g.boundingBox.clone());
  const g2 = g.clone().applyMatrix4(mesh.matrixWorld);
  g2.computeBoundingBox();
  const bbAfter = g2.boundingBox;
  const same = bbBefore.min.distanceTo(bbAfter.min) < 1e-6 && bbBefore.max.distanceTo(bbAfter.max) < 1e-6;

  totalTris += tris;
  // 注意：这里不能用 '...%d' % (...) —— 那是 Python 的写法，在 JS 里 % 是取模，
  // 一个字符串 % 数组 会得到 NaN（本探针第一版就栽在这上面，打印出一片 NaN）。
  console.log(
    fn.padEnd(14),
    '顶点', String(g.attributes.position.count).padStart(5),
    '三角', String(tris).padStart(6),
    ' index=' + (g.index ? g.index.count : '-'),
    '|', matDesc);
  console.log('               node 变换: %s   bbox: [%s] → [%s]',
    same ? '恒等（不用 bake）' : '非恒等（要 bake）',
    bbBefore.min.toArray().map(v => v.toFixed(2)).join(',') + ' .. ' + bbBefore.max.toArray().map(v => v.toFixed(2)).join(','),
    bbAfter.min.toArray().map(v => v.toFixed(2)).join(',') + ' .. ' + bbAfter.max.toArray().map(v => v.toFixed(2)).join(','));
  console.log('               解析耗时 %d ms   attributes: %s', ms, Object.keys(g.attributes).join(','));
}

console.log('\n三角形合计 = %d' % totalTris);
console.log('纹理加载尝试次数 = %d（>0 说明桩生效了；若为 0 说明根本没走到纹理路径）', texAttempts);
