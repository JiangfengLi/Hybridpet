/**
 * 打包成单文件版： alien-walk-standalone.html
 *
 * 为什么需要：正常版要用 http:// 起服务器（file:// 下浏览器拒绝加载 ES module）。
 * 这里把 three.js 的两个文件直接内联进 HTML，再用 **blob URL** 导入，
 * 于是双击打开就能跑，不依赖任何服务器、也不依赖网络。
 *
 * 用法： node build-standalone.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'index.html');
const OUT = path.join(HERE, 'alien-walk-standalone.html');

/* ---------- 1. 读源文件 ---------- */
const html = fs.readFileSync(SRC, 'utf8');
const coreSrc = fs.readFileSync(path.join(HERE, 'vendor', 'three.core.min.js'), 'utf8');
const modSrc = fs.readFileSync(path.join(HERE, 'vendor', 'three.module.min.js'), 'utf8');
const gltfSrc = fs.readFileSync(path.join(HERE, 'vendor', 'GLTFLoader.js'), 'utf8');
const bguSrc = fs.readFileSync(path.join(HERE, 'vendor', 'BufferGeometryUtils.js'), 'utf8');
const chamberCss = fs.readFileSync(path.join(HERE, 'chamber.css'), 'utf8');
const audioB64 = fs.readFileSync(path.join(HERE, 'assets', 'combine-audio.mp4')).toString('base64');
const backgroundB64 = fs.readFileSync(path.join(HERE, 'assets', 'Audio_BackGround.mp3')).toString('base64');
const laserB64 = fs.readFileSync(path.join(HERE, 'assets', 'Audio_Laser.wav')).toString('base64');
const birthB64 = fs.readFileSync(path.join(HERE, 'assets', 'birth-mama.wav')).toString('base64');
const grassB64 = fs.readFileSync(path.join(HERE, 'assets', 'grasswalk.mp3')).toString('base64');
const flightB64 = fs.readFileSync(path.join(HERE, 'assets', 'jetpack-flight.wav')).toString('base64');
// Dependency order is checked below, including the shared Three.js module.
const chamberFiles = [
  'vendor/cannon-es.mjs', 'bone-physics.mjs',
  'vendor/meshopt_decoder.module.js', 'tripo-runtime.mjs',
  'chamber-water.mjs', 'water-gun.mjs', 'mutation-rate.mjs',
  'fusion-v1/wave-motion.mjs', 'fusion-v1/recombination-motion.mjs',
  'fusion-v1/combine-session.mjs', 'fusion-v1/jelly-deform.mjs',
  'fusion-v1/game-actor.mjs', 'fusion-v1/surface-contact.js',
  'fusion-v1/splash-motion.mjs', 'fusion-v1/slime-splash.js',
  'fusion-v1/combine-audio.js', 'chamber-stage.mjs',
  'fusion-v1/recombination-film.js', 'chamber-performance.mjs',
  'chamber-view.mjs', 'chamber-system.mjs',
];
const available = new Set(['vendor/three.module.min.js']);
const chamberModules = chamberFiles.map(name => {
  const source = fs.readFileSync(path.join(HERE, name), 'utf8');
  const dependencies = {};
  for (const match of source.matchAll(/\bfrom\s*(['"])(\.[^'"]+)\1/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[2]));
    if (!available.has(target)) throw new Error('Missing or unordered dependency: ' + name + ' -> ' + target);
    dependencies[match[2]] = target;
  }
  if (/\bimport\s*\(/.test(source)) throw new Error('Dynamic module requires explicit bundling: ' + name);
  available.add(name);
  return {name, source, dependencies};
});
const chamberJson = JSON.stringify(chamberModules).replace(/</g, '\\u003c');

/* 9 个 GLB：单文件版不能 fetch('./models/x.glb')（file:// 下必然失败），
   所以改成内联 base64。propBytes() 里那条"内联"分支就是给它用的。 */
const modelDir = path.join(HERE, 'models');
const modelFiles = fs.readdirSync(modelDir).filter(n => n.endsWith('.glb')).sort();
const modelB64 = {};
for (const f of modelFiles) modelB64[f.replace(/\.glb$/, '')] = fs.readFileSync(path.join(modelDir, f)).toString('base64');
const modelsJson = JSON.stringify(modelB64);
console.log('内联模型：' + modelFiles.length + ' 个 GLB → base64 ' +
            (modelsJson.length / 1024).toFixed(0) + ' KB（原始 ' +
            (modelFiles.reduce((a, f) => a + fs.statSync(path.join(modelDir, f)).size, 0) / 1024).toFixed(0) + ' KB）');

/* 依赖闭包自检：min 构建会 import 兄弟文件，漏了就白屏 */
const siblings = [...modSrc.matchAll(/from\s*["'](\.[^"']*)["']/g)].map(m => m[1]);
if (siblings.length === 0) {
  console.warn('警告：three.module.min.js 没有相对依赖 —— 可能本来就是自包含的，' +
               '打包脚本的 import 重写部分可以省掉。');
}
console.log('three.module.min.js 的相对依赖：' + (siblings.join(', ') || '（无）'));

/* ---------- 2. 替换游戏里的 three.js 引导段 ---------- */
const BOOT = `let THREE;
try {
  THREE = await import('./vendor/three.module.min.js');
} catch (errLocal) {
  console.warn('[alien-walk] 本地 three.js 加载失败，尝试 CDN：', errLocal);
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js');
  } catch (errCdn) {
    window.__showFatal('<b>three.js 加载失败</b><br>本地副本与 CDN 均不可用。' +
      '<br><small>' + String((errCdn && errCdn.message) || errCdn) + '</small>');
    throw errCdn;
  }
}`;

const BOOT_STANDALONE = `/* 单文件版：three.js 已内联在下面的 <script id="__three_*"> 里，
   通过 blob URL 导入 —— 于是 file:// 双击打开也能跑，不依赖服务器。 */
const __srcOf = id => document.getElementById(id).textContent;
/* __threeUrl 必须留在外层：下面 GLTFLoader 的 blob 文本要把 from './three.module.min.js'
   改写成这个 URL，才能保证 GLTFLoader 拿到的 THREE 与游戏手里的是**同一个模块实例**
   （否则 instanceof / 共享设置会静默失效）。 */
let __threeUrl = '';
let THREE;
try {
  const coreUrl = URL.createObjectURL(new Blob([__srcOf('__three_core')], { type: 'text/javascript' }));
  const modText = __srcOf('__three_module')
    .replace(/from\\s*["']\\.\\/three\\.core\\.min\\.js["']/g, 'from "' + coreUrl + '"');
  const modUrl = URL.createObjectURL(new Blob([modText], { type: 'text/javascript' }));
  THREE = await import(modUrl);
  __threeUrl = modUrl;                 /* 别 revoke：下面 GLTFLoader 还要 import 它 */
  URL.revokeObjectURL(coreUrl);
} catch (errBlob) {
  window.__showFatal('<b>three.js 内联导入失败</b><br>这个浏览器可能禁止从 blob: 导入模块。' +
    '<br>请改用正常版：双击 <code>start.bat</code>，或 ' +
    '<code>python serve.py</code> 后访问 <code>http://127.0.0.1:8766/</code>' +
    '<br><small>' + String((errBlob && errBlob.message) || errBlob) + '</small>');
  throw errBlob;
}`;

/* GLTFLoader 的引导段：同样改成 blob 导入。
   两处 import 都要改写 —— 它自己引 three（要指到 __threeUrl）
   与 BufferGeometryUtils（它也是一份 blob）。BufferGeometryUtils 又引 three，
   所以那一份也要先改写、先生成 blob URL。 */
const BOOT_GLTF = `let GLTFLoader = null;
try {
  ({ GLTFLoader } = await import('./vendor/GLTFLoader.js'));
} catch (errGltf) {
  console.warn('[alien-walk] GLTFLoader 不可用，植被与岩石将不会生成：', errGltf);
  globalThis.__gltfBootError = String((errGltf && errGltf.message) || errGltf);
}`;

const BOOT_GLTF_STANDALONE = `let GLTFLoader = null;
try {
  const __bguUrl = URL.createObjectURL(new Blob([
    __srcOf('__prop_bgu').replace(/from\\s*["']\\.\\/three\\.module\\.min\\.js["']/g, 'from "' + __threeUrl + '"')
  ], { type: 'text/javascript' }));
  const __gltfUrl = URL.createObjectURL(new Blob([
    __srcOf('__prop_gltf')
      .replace(/from\\s*["']\\.\\/three\\.module\\.min\\.js["']/g, 'from "' + __threeUrl + '"')
      .replace(/from\\s*["']\\.\\/BufferGeometryUtils\\.js["']/g, 'from "' + __bguUrl + '"')
  ], { type: 'text/javascript' }));
  ({ GLTFLoader } = await import(__gltfUrl));
} catch (errGltf) {
  console.warn('[alien-walk] GLTFLoader 不可用，植被与岩石将不会生成：', errGltf);
  globalThis.__gltfBootError = String((errGltf && errGltf.message) || errGltf);
}`;

const BOOT_CHAMBER = "const {createChamberSystem, CHAMBER_POSITIONS} = await import('./chamber-system.mjs');";
const BOOT_CHAMBER_STANDALONE = `const __chamberUrls = new Map([['vendor/three.module.min.js', __threeUrl]]);
for (const entry of JSON.parse(__srcOf('__chamber_modules'))) {
  const source = entry.source.replace(/\\bfrom\\s*(['"])(\\.[^'"]+)\\1/g, (_, quote, specifier) => {
    const dependency = __chamberUrls.get(entry.dependencies[specifier]);
    if (!dependency) throw new Error('Missing capsule dependency: ' + specifier);
    return 'from ' + JSON.stringify(dependency);
  });
  __chamberUrls.set(entry.name, URL.createObjectURL(new Blob([source], {type:'text/javascript'})));
}
const {createChamberSystem, CHAMBER_POSITIONS} = await import(__chamberUrls.get('chamber-system.mjs'));`;

/* 断言改写真的发生了 —— 只把这三种"裸相对路径 import"当作改写目标。
   （GLTFLoader.js 的 JSDoc 里也有 from '...' 的示例文本，所以用带 ./ 的精确模式，不要放宽。） */
for (const [src, name] of [[gltfSrc, 'GLTFLoader.js'], [bguSrc, 'BufferGeometryUtils.js']]) {
  const n = (src.match(/from\s*["']\.\/[^"']*["']/g) || []).length;
  const want = name === 'GLTFLoader.js' ? 2 : 1;
  if (n !== want) {
    console.error('失败：' + name + ' 里 from "./..." 出现 ' + n + ' 次（期望 ' + want +
                  '）—— 依赖结构变了，请更新 build-standalone.mjs 的改写规则。');
    process.exit(1);
  }
}

let out = html;
let hit = 0;
const SWAPS = [[BOOT, BOOT_STANDALONE], [BOOT_GLTF, BOOT_GLTF_STANDALONE], [BOOT_CHAMBER, BOOT_CHAMBER_STANDALONE],
  ["const {createWaterGun} = await import('./water-gun.mjs');",
   "const {createWaterGun} = await import(__chamberUrls.get('water-gun.mjs'));"],
  ["const {BASE_MUTATION_RATE,normalizedRadiation,createInheritancePlan,resolveInheritancePlan} = await import('./mutation-rate.mjs');",
   "const {BASE_MUTATION_RATE,normalizedRadiation,createInheritancePlan,resolveInheritancePlan} = await import(__chamberUrls.get('mutation-rate.mjs'));"],
  ["const {createBonePhysics} = await import('./bone-physics.mjs');",
   "const {createBonePhysics} = await import(__chamberUrls.get('bone-physics.mjs'));"],
  ["const {createTripoClient, cloneOffspring, disposeModel} = await import('./tripo-runtime.mjs');",
   "const {createTripoClient, cloneOffspring, disposeModel} = await import(__chamberUrls.get('tripo-runtime.mjs'));"]];
for (const [a, b] of SWAPS) {
  let done = false;
  for (const [aa, bb] of [[a, b], [a.replace(/\n/g, '\r\n'), b.replace(/\n/g, '\r\n')]]) {
    if (out.includes(aa)) { out = out.replace(aa, bb); done = true; break; }
  }
  if (done) hit++;
}
if (hit !== SWAPS.length) {
  console.error('失败：在 index.html 里只匹配到 ' + hit + ' / ' + SWAPS.length +
                ' 个引导段 —— 源码变了，请更新本脚本的 BOOT / BOOT_GLTF 常量。');
  process.exit(1);
}
const cssLink = '<link rel="stylesheet" href="./chamber.css" />';
if (!out.includes(cssLink) || /<\/style/i.test(chamberCss)) throw new Error('Capsule stylesheet cannot be inlined');
out = out.replace(cssLink, '<style id="__chamber_css">' + chamberCss + '</style>');
console.log('已替换 Three.js / GLTFLoader / 太空舱引导及样式');

/* ---------- 3. 把源码原样内联 ----------
   坑：一开始我按 JSON 习惯把 "</" 转义成 "<\/" 再塞进 <script type="text/plain">。
   但 text/plain 块里没有转义规则，读出来时反斜杠**不会消失** →
   源码被改成 "<\/" → 模块抛 "Invalid or unexpected token" → 白屏。
   事实核查：three.js 两个 min 文件里 "</" 出现 **0 次**，根本不需要转义。
   唯一必须避免的是 "</script"，因为 HTML 解析器会在那里截断脚本元素。
   所以：断言不存在 "</script"，然后**原样**内联。 */
function inline(id, src) {
  if (/<\/script/i.test(src)) {
    console.error('失败：' + id + ' 的源码里含 "</script"，会截断 HTML 脚本元素。'
      + '需要改成 base64 或按需转义，请更新构建脚本。');
    process.exit(1);
  }
  return '<script id="' + id + '" type="text/plain">' + src + '</script>\n';
}

const dataBlock = inline('__three_core', coreSrc) + inline('__three_module', modSrc)
                + inline('__prop_gltf', gltfSrc) + inline('__prop_bgu', bguSrc)
                + inline('__propmodels', modelsJson)
                + inline('__chamber_modules', chamberJson) + inline('__combine_audio', audioB64)
                + inline('__background_audio', backgroundB64) + inline('__laser_audio', laserB64)
                + inline('__birth_audio', birthB64) + inline('__grass_audio', grassB64)
                + inline('__flight_audio', flightB64);
console.log('已内联 three.core / three.module / GLTFLoader / BufferGeometryUtils / 模型表（原样，未做转义）');

/* 放在第一个 <script> 之前，保证引导段运行时元素已存在 */
const firstScript = out.indexOf('<script');
if (firstScript < 0) { console.error('失败：找不到 <script> 标签'); process.exit(1); }
out = out.slice(0, firstScript) + dataBlock + out.slice(firstScript);

/* ---------- 4. 标题里注明这是单文件版 ---------- */
out = out.replace('<title>', '<title>[单文件版] ');

/* ---------- 5. 自检 ---------- */
const bytes = Buffer.byteLength(out);
const rawClose = (out.match(/<\/script>/gi) || []).length;
/* Vendor, models, capsule modules, and the six audio assets. */
const INLINE_BLOCKS = 12;
const expectClose = (html.match(/<\/script>/gi) || []).length + INLINE_BLOCKS;
console.log('');
console.log('输出：' + path.relative(HERE, OUT) + '  ' + (bytes / 1024).toFixed(0) + ' KB');
console.log('  </script> 出现次数 = ' + rawClose + '（期望 ' + expectClose + '）' +
            (rawClose === expectClose ? ' ✓ 数据块未被提前截断' : ' ✗ 有内容泄漏到标签外'));

/* 内联源码必须与磁盘上的字节完全一致 —— 上一次就是这里出的问题 */
const grab = id => {
  const m = out.match(new RegExp('<script id="' + id + '" type="text\\/plain">([\\s\\S]*?)<\\/script>'));
  return m ? m[1] : null;
};
const same = (a, b) => a !== null && a === b;

const checks = [
  ['core', grab('__three_core'), coreSrc],
  ['module', grab('__three_module'), modSrc],
  ['GLTFLoader', grab('__prop_gltf'), gltfSrc],
  ['BufferGeometryUtils', grab('__prop_bgu'), bguSrc],
  ['capsule modules', grab('__chamber_modules'), chamberJson],
  ['capsule audio', grab('__combine_audio'), audioB64],
  ['background audio', grab('__background_audio'), backgroundB64],
  ['laser audio', grab('__laser_audio'), laserB64],
  ['birth audio', grab('__birth_audio'), birthB64],
  ['grass audio', grab('__grass_audio'), grassB64],
  ['flight audio', grab('__flight_audio'), flightB64],
];
let bad = rawClose === expectClose ? 0 : 1;
for (const [name, got, want] of checks) {
  const okSame = same(got, want);
  if (!okSame) bad++;
  console.log('  内联 ' + name + ' 与磁盘一致: ' + (okSame ? '✓' : '✗'));
}

/* 模型表：不只是"存在"，而是**逐个 base64 解码后与磁盘字节逐字节比对**。
   单文件版读的就是这份 base64（propBytes 的内联分支），
   差一个字节就是 GLTFLoader 里一个静默的解析失败 —— 而失败被 try 吞掉后
   只会表现为"植被少了一种"，肉眼很难发现。 */
const rawModels = grab('__propmodels');
let modelsOk = rawModels !== null;
if (rawModels === null) {
  console.log('  内联模型表: ✗ 找不到 __propmodels 数据块');
} else {
  let parsed = null;
  try { parsed = JSON.parse(rawModels); } catch (e) { modelsOk = false; }
  if (!parsed) {
    console.log('  内联模型表: ✗ 不是合法 JSON');
  } else {
    console.log('  内联模型表 ' + modelFiles.length + ' 个 GLB，逐个解码比对：');
    for (const f of modelFiles) {
      const key = f.replace(/\.glb$/, '');
      const disk = fs.readFileSync(path.join(modelDir, f));
      const back = parsed[key] ? Buffer.from(parsed[key], 'base64') : null;
      const okSame = back !== null && back.length === disk.length && back.equals(disk);
      if (!okSame) { modelsOk = false; }
      console.log('    ' + (okSame ? '✓' : '✗') + ' ' + key.padEnd(9) +
                  (back ? back.length + ' B' : '（缺）') + ' / ' + disk.length + ' B');
    }
  }
}
if (!modelsOk) bad++;

if (bad > 0) {
  console.error('失败：' + bad + ' 项内联内容与源文件不一致，file:// 下会加载失败或静默少内容。');
  process.exit(1);
}
console.log('  全部内联内容与磁盘字节一致 ✓');
if (out.includes(BOOT_CHAMBER) || out.includes(cssLink)) throw new Error('Unbundled capsule entry remains');
fs.writeFileSync(OUT, out, 'utf8');
