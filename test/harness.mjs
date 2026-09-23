/**
 * 共享测试夹具：把 index.html 里的 module script 抽出来，注入最小 DOM / 渲染器桩，
 * 用**真实 three.js** 在 Node 里跑完整模块。
 *
 * 关键设计：桩与主体拼成**同一个 module**，所以 driver 代码能直接访问模块内部变量
 * （scene / player / state / keys / loop …），不需要为了测试改一行生产代码。
 * 这也意味着**桩要能接收并记录事件监听器**，否则"用户按下 W 会发生什么"这类接线永远测不到。
 *
 * 用法：
 *   import { runGame } from './harness.mjs';
 *   await runGame(`...driver 源码...`);
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ============================================================
   桩：DOM / 环境 / 渲染器
   —— 所有元素都记录监听器，挂到 globalThis.__L，供 driver 合成事件
   ============================================================ */
const STUBS = `
import * as THREE from '../vendor/three.module.min.js';
/* GLTFLoader 必须由桩提供：extractBody() 抽取时**故意丢掉了引导段**
   （它从"0. 世界参数"开始切），而 GLTFLoader 正是在那一段里声明的 ——
   不补这一行，8c 节会立刻 "GLTFLoader is not defined"。
   这里静态引入**真实的那个类**；它自己 import 的 './three.module.min.js'
   与上面那行指向同一个文件 —— ESM 缓存保证两者拿到**同一个模块实例**，
   所以 GLTFLoader 造出来的 geometry/material 与游戏手里的 THREE 是同一套类。
   若将来 extractBody 改成保留引导段，这里会和源码里的 let GLTFLoader 重名，记得一起去掉。 */
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { createChamberSystem, CHAMBER_POSITIONS } from '../chamber-system.mjs';
import {createWaterGun} from '../water-gun.mjs';
import {createBonePhysics} from '../bone-physics.mjs';
import {createTripoClient, cloneOffspring, disposeModel} from '../tripo-runtime.mjs';

/* ---------- 事件注册表：__L[elemId][type] = [fn, ...] ---------- */
const __L = Object.create(null);
globalThis.__L = __L;
function rec(id, type, fn) {
  ((__L[id] ||= {})[type] ||= []).push(fn);
}

/* 可控的指针锁：driver 可以改 __lockMode 来模拟成功／被拒／静默失败 */
globalThis.__lockMode = 'reject';      // 'ok' | 'reject' | 'throw' | 'silent'
globalThis.__lockCalls = 0;

/* 2D 上下文桩：只需要"存在的、不会抛错的方法"。
   被测代码在 Node 里画出来的像素没人看，但**调用不存在的 API 会直接抛错**
   ⇒ 这里宁可多列几个方法，也不要在加了新 canvas 代码之后再回来补
   （已经踩过一次：cloudTexture 里一句 clearRect 就把整个模块打挂了）。 */
const ctxStub = {
  fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
  globalAlpha: 1, font: '', textAlign: '', globalCompositeOperation: 'source-over',
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  fillRect() {}, strokeRect() {}, clearRect() {},
  beginPath() {}, closePath() {}, fill() {}, stroke() {}, clip() {},
  arc() {}, arcTo() {}, ellipse() {}, rect() {},
  moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {},
  save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
  drawImage() {}, fillText() {}, strokeText() {},
  measureText: () => ({ width: 0 }),
  createPattern: () => null, getImageData: () => ({ data: [] }), putImageData() {},
};
/* 注意 createElement：**每次都要给一个新的对象**。
   早先是按标签名缓存（EL['new:canvas'] 永远返回同一个），于是"画了多少张 canvas、
   每张多大"在 Node 里都被串成同一份 —— 断言 贴图.image.width === 512 会读到
   别人刚写进去的值（实测读到 64，来自 three.js 内部的空贴图），
   而这类"测量工具自己把数据搅浑"的错最难查。
   真实 DOM 的 createElement 本来就是新建元素，这里对齐它。
   另外：本段整体在 STUBS 模板字符串里，注释里不许出现反引号。 */
let __createdSeq = 0;
const EL = Object.create(null);
function fakeEl(id) {
  if (EL[id]) return EL[id];
  const e = {
    id,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (on ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); },
    },
    style: {}, dataset: {}, hidden: false, textContent: '', innerHTML: '', width: 0, height: 0,
    firstElementChild: { style: {} },
    children: [],
    appendChild() {}, append() {}, remove() {},
    addEventListener(t, fn) { rec(id, t, fn); },
    requestPointerLock() {
      globalThis.__lockCalls++;
      if (globalThis.__lockMode === 'throw') throw new Error('pointer lock denied');
      if (globalThis.__lockMode === 'reject') return Promise.reject(new Error('pointer lock denied'));
      return undefined;                 // 'ok' / 'silent'
    },
    querySelector() { return { textContent: '', style: {} }; },
    querySelectorAll() { return []; },
    getContext() { return ctxStub; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
  };
  EL[id] = e;
  return e;
}

globalThis.document = {
  body: fakeEl('body'),
  getElementById: fakeEl,
  querySelector: s => fakeEl('sel:' + s),
  createElement: t => fakeEl('new:' + t + '#' + (++__createdSeq)),
  addEventListener: (t, fn) => rec('document', t, fn),
  hidden: false,
  pointerLockElement: null,
  exitPointerLock() {},
};
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
/* 下面这个查询串占位符由 runGame 替换成 driver 指定的值 ——
   这样「启动参数」这条真实入口（?autostart=1&…）也能被测到，
   它和 location.search='' 走的是完全不同的分支。
   注意：用 replaceAll，且注释里不要写出占位符本身，否则替换会打在注释上。 */
globalThis.location = { search: '@@SEARCH@@', href: 'http://127.0.0.1:8766/' };
globalThis.addEventListener = (t, fn) => rec('window', t, fn);
globalThis.AudioContext = undefined;      // 音频走早退分支
globalThis.webkitAudioContext = undefined;

/* ---------- GLTFLoader（8c 节的植被/岩石）在 Node 里需要的三处桩 ----------
   三处缺一处都会出问题，而且是**三种不同的问题**：
   ① \`self\` —— GLTFLoader.js:3377 直接写 \`const URL = self.URL || self.webkitURL\`。
      Node 里没有 self，这是**同步 ReferenceError**，一抛就把整条 parse 打掉
      （表现为 parseAsync 直接拒绝，而不是降级）。
   ② \`createImageBitmap\` —— GLTFLoader 靠 \`typeof createImageBitmap !== 'undefined'\`
      决定用哪个纹理加载器。不定义它就会落到 TextureLoader 分支，那条路靠 <img> 的 onload，
      在 Node 里**永远不会触发** ⇒ await 永久挂住（测试不是失败，是卡死，最难查）。
   ③ \`ImageBitmapLoader.prototype.load\` —— 光有 ② 还不够：它接下来会去 fetch 一个 blob: URL，
      而 Node 的 undici 不支持 blob: 协议。"碰巧失败"太依赖实现细节，这里显式换成
      同步返回一个假位图 —— 几何与材质仍然是真解析出来的，只是贴图不参与。 */
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
THREE.ImageBitmapLoader.prototype.load = function (url, onLoad) {
  onLoad({ width: 1, height: 1, close() {} });
  return this;
};

/* 固定步长：否则紧凑循环里 Clock.getDelta() ≈ 0，动画分支根本跑不到 */
THREE.Clock.prototype.getDelta = function () { return 1 / 60; };
THREE.Clock.prototype.getElapsedTime = function () { return 0; };
`;

/* ============================================================
  把 models/*.glb 预读成 ArrayBuffer，挂到 globalThis.__propBuffers
  ------------------------------------------------------------
  为什么要有这一手：游戏里 propBytes() 的取数有三条路（fetch / 内联 base64 /
  注入的 ArrayBuffer）。Node 里没有"相对路径 fetch 本地文件"这条路，
  所以由 harness 用 fs 读盘注入 —— **只换字节从哪来，解析那一段完全一致**，
  几何/材质/顶点数都是真的 GLTFLoader 解析结果。
  浏览器那条 fetch 路径由无头截图端到端覆盖。
  （缓存住：多个测试文件都会调 runGame，别每次重读 1.2 MB。）
  ============================================================ */
let __propBuffers = null;
export function primePropBuffers() {
  if (__propBuffers) return __propBuffers;
  const dir = path.join(ROOT, 'models');
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(n => n.endsWith('.glb')).sort();
  } catch (e) {
    console.warn('警告：读不到 models/ 目录，8c 节的模型测试会全部失败：', e.message);
  }
  for (const f of files) {
    const b = fs.readFileSync(path.join(dir, f));
    // Buffer 的 .buffer 可能落在共享内存池里、比这个文件大 —— 必须按 offset 切片
    out[f.replace(/\.glb$/, '')] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  __propBuffers = out;
  globalThis.__propBuffers = out;
  return out;
}

/* ============================================================
   抽取 + 注入
   ============================================================ */
export function extractBody() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('index.html 里找不到 <script type="module">');

  const js = m[1];
  const start = js.lastIndexOf('/* ====', js.indexOf('0. 世界参数'));
  if (start < 0) throw new Error('找不到"0. 世界参数"章节标记');

  let body = js.slice(start);
  const NEEDLE = "const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });";
  if (!body.includes(NEEDLE)) {
    throw new Error('找不到渲染器创建语句 —— 模块结构变了，请更新 test/harness.mjs');
  }
  body = body.replace(NEEDLE, `const renderer = {
    shadowMap: { enabled: false, type: null },
    setPixelRatio() {}, setSize() {},
    render() { globalThis.__renders = (globalThis.__renders || 0) + 1; },
    setAnimationLoop(fn) { globalThis.__loop = fn; },
    outputColorSpace: null, toneMapping: null, toneMappingExposure: 1,
  };`);
  return body;
}

/**
 * 跑一份 driver（会与游戏主体拼进同一个 module）。
 * driver 里可以直接用 scene / player / state / keys / loop / mag / corpses … 以及合成事件工具：
 *   fire('window','keydown',{code:'KeyW'})
 *   fire('startBtn','click')
 *
 * opts.search：可指定 location.search（默认 ''），用来测 ?autostart=1&… 这条启动入口。
 *
 * ⚠️ 同一个进程里**可以调用多次**（每次用不同的临时文件名）。
 *    为什么名字必须换：临时文件路径就是 ESM 的缓存键 —— 路径一样时第二次 import
 *    会直接返回**缓存模块**，driver 一个字都不执行，而且**不报错**，
 *    只是静默地什么都不做。2026-09-22 给 boot-params 加"&slay 两轮"时踩到：
 *    第二轮只打印了标题、零条断言，却被判成"全部通过"。加序号即可。
 */
let __runSeq = 0;
export async function runGame(driverSource, opts) {
  const body = extractBody();
  const stubs = STUBS.replaceAll('@@SEARCH@@', String((opts && opts.search) || ''));
  primePropBuffers();

  const HELPERS = `
/* ---------- driver 可用的合成事件工具（与游戏同作用域） ---------- */
function fire(elemId, type, ev) {
  const list = (globalThis.__L[elemId] || {})[type] || [];
  const e = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, ev || {});
  for (const fn of list.slice()) fn(e);
  return list.length;
}
function fireKey(type, code, extra) { return fire('window', type, Object.assign({ code }, extra || {})); }
function fireDoc(type, ev) { return fire('document', type, ev); }
function pressKey(code) { fireKey('keydown', code); }
function releaseKey(code) { fireKey('keyup', code); }
function holdFrames(code, n) { pressKey(code); for (let i = 0; i < (n || 1); i++) loop(); releaseKey(code); }
/* 等一轮宏任务：让 Promise 链（如 requestPointerLock 的 catch）跑完 */
function tick() { return new Promise(r => setTimeout(r, 0)); }
`;

  const out = path.join(HERE, '.tmp-harness-' + (++__runSeq) + '.mjs');
  fs.writeFileSync(out, stubs + body + HELPERS + driverSource, 'utf8');
  try {
    await import(url.pathToFileURL(out).href);
  } finally {
    try {
      /* ⚠️ 调试用逃生口：`KEEP_TMP=1 node test/xxx.mjs` 会把拼出来的临时模块**留在磁盘上**。
         为什么需要它：driver 是模板字符串，写错一个反引号或一个转义序列时，
         报出来的是".tmp-harness-1.mjs:5844 附近 SyntaxError" —— 而那个行号在 driver 的
         **源文件**里对不上（拼接之后行号变了）。这时候唯一的办法就是把拼好的文件留下来、
         对它跑一次 node --check 拿到真实行号。
         2026-09-23 靠这个一次定位到：driver 里的 split('\n') 被外层模板先求值成了真换行。 */
      if (!process.env.KEEP_TMP) fs.unlinkSync(out);
    } catch (e) {
      /* ⚠️ **不能静默吞掉**。Windows 上 ESM 还挂着时 unlink 会 EBUSY/EPERM，
         于是临时模块留在 test/ 里。留一两个无害，但它是**会随包发出去**的 ——
         2026-09-23 打包副本时就真发出去过 4 个。
         ⇒ 这里报一声；run.sh 的第 0 步也会先清一遍。 */
      console.warn('[harness] 临时模块没能删掉，留在 ' + path.basename(out) + '：' + e.message);
    }
  }
}

/* 汇总报告：driver 用 ok() 记录断言，footer 打印总结并决定退出码 */
export const DRIVER_FOOTER = `
const __fails = (globalThis.__t || []).filter(x => !x.ok).length;
console.log('');
console.log(__fails === 0 ? '===== 全部通过（' + (globalThis.__t || []).length + ' 项断言）=====' : '===== ' + __fails + ' 项失败 =====');
if (__fails) throw new Error(__fails + ' assertion(s) failed');
`;

export const DRIVER_HEAD = `
globalThis.__t = [];
const ok = (c, m) => { const r = { ok: !!c, msg: m }; globalThis.__t.push(r); console.log((r.ok ? 'ok   ' : 'FAIL ') + m); };
const sec = t => console.log('\\n=== ' + t + ' ===');
`;

export { ROOT };
