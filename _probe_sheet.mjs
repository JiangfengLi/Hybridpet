/**
 * 素材体检页：把一批 GLB **逐个单独渲染**，每个模型出「原样 / 推荐修法」两格对照。
 *
 * 用法: node _probe_sheet.mjs <glb目录> [输出html]
 *   例: node _probe_sheet.mjs "C:/Users/26335/AppData/Local/Temp/alwk-new" _shots/lib-sheet.html
 *
 * 为什么需要它（两条都踩过）：
 *   ① 游戏截图里素材互相遮挡、又被玩家手里的采集器挡一块 —— 光看截图**没法判断
 *      某一个素材到底有没有体现、长什么样**。单独渲染 + 固定机位 + 1 m 网格，
 *      才能把"资产本身"和"摆放"分开看。
 *   ② 更要紧的是**照游戏的光照渲染**：Tripo 新批次把所有 pbr 参数省了 ⇒ 落到 glTF
 *      默认 metallicFactor=1.0 / roughnessFactor=1.0，而游戏场景**没有环境贴图**
 *      ⇒ 金属度 1 时 diffuse=0，物体渲染成近黑的一块。这个必须用游戏的光照实测，
 *      不能靠推理 —— 有贴图的金属体不完全等于没贴图的。
 *
 * 实现要点：
 *   · **只用一个 WebGLRenderer**，逐格渲染后 drawImage 到各格 2D canvas。
 *     Chrome 只允许约 16 个活跃 WebGL 上下文，18 格各建一个会静默丢上下文。
 *   · three / GLTFLoader / BufferGeometryUtils 直接从 alien-walk-standalone.html
 *     里内联的数据块抠出来（blob 导入），保证探针用的 three 和游戏是同一份。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = process.argv[2];
const OUT = process.argv[3] || '_shots/lib-sheet.html';
if (!SRC_DIR) { console.error('用法: node _probe_sheet.mjs <glb目录> [输出html]'); process.exit(2); }

const ROOT = 'C:/Users/26335/WorkBuddy/2026-09-22-09-31-42/alien-walk';
const STANDALONE = ROOT + '/alien-walk-standalone.html';

const html = fs.readFileSync(STANDALONE, 'utf8');
const grab = id => {
  const m = html.match(new RegExp('<script id="' + id + '" type="text/plain">([\\s\\S]*?)<\\/script>'));
  if (!m) throw new Error('抠不到 ' + id);
  return m[1];
};

/* 递归收 GLB；短名去掉 Tripo 的前缀/版本后缀，标签才读得下 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.glb')) out.push(p);
  }
  return out;
}
const shortName = f => path.basename(f, '.glb')
  .replace(/^Character_/, '').replace(/^BuildingModule_\d+_/, '')
  .replace(/_(P1|V\d+(\.\d+)?)_(Default|FaceLimit\d+|HighDetail|JellyTranslucent|Base|GUIVariant)$/, '');

const files = walk(SRC_DIR).sort();
if (!files.length) { console.error('!! 目录里没有 .glb：' + SRC_DIR); process.exit(2); }
console.log(files.map(f => '  ' + shortName(f) + '  ← ' + path.relative(SRC_DIR, f).replace(/\\/g, '/')).join('\n'));

const modelsJs = '{' + files.map(f =>
  JSON.stringify(shortName(f)) + ':' + JSON.stringify(fs.readFileSync(f).toString('base64'))
).join(',') + '}';

const cells = files.map(f => {
  const n = shortName(f);
  return `<div class="row">
  <div class="cell"><div class="lab"><b>${n}</b><span class="vA">A 原样</span></div><canvas data-name="${n}" data-variant="A"></canvas></div>
  <div class="cell"><div class="lab"><b>${n}</b><span class="vC">C 只归零底面</span></div><canvas data-name="${n}" data-variant="C"></canvas></div>
  <div class="cell"><div class="lab"><b>${n}</b><span class="vB">B 再加材质修正</span></div><canvas data-name="${n}" data-variant="B"></canvas></div>
</div>`;
}).join('\n');

const blocks = ['__three_core', '__three_module', '__prop_gltf', '__prop_bgu']
  .map(id => `<script id="${id}" type="text/plain">${grab(id)}</script>`).join('\n');

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>素材体检</title>
<style>
  body{margin:0;background:#f4f7fa;font:13px/1.45 "Microsoft YaHei","Segoe UI",system-ui,sans-serif;color:#1b2733}
  h1{font-size:15px;margin:12px 16px 4px}
  .hint{margin:0 16px 10px;color:#5a6b7a;font-size:12px;line-height:1.6}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 16px 16px}
  .row{display:contents}
  .cell{background:#fff;border:1px solid #dbe3ea;border-radius:8px;overflow:hidden}
  .lab{padding:6px 9px;border-bottom:1px solid #eef2f6;display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}
  .lab b{font-size:12.5px}
  .lab span{font-size:10.5px;padding:1px 6px;border-radius:9px;white-space:nowrap}
  .vA{background:#fde8e8;color:#9b2c2c}
  .vC{background:#fdf3e0;color:#8a5a12}
  .vB{background:#e3f4e8;color:#1d6b3a}
  canvas{display:block;width:100%;aspect-ratio:1/1}
  pre{margin:0 16px 20px;padding:10px 12px;background:#fff;border:1px solid #dbe3ea;border-radius:8px;font-size:11.5px;line-height:1.5;white-space:pre-wrap;font-family:Consolas,monospace}
</style></head><body>
<h1>素材体检 —— 每格同一条相机规则（按模型自身尺寸自动取景）· 地面 1 m 网格</h1>
<p class="hint">光照与地面色<b>照搬游戏</b>（sun 2.5 #fff4e0 + hemi 1.45 + rim 0.45 + bounce 0.55，ACESFilmic，sRGB，地面 #97CDBF）。
三列是**逐个变量加**的，同一条相机规则、同一份几何 ⇒ 列与列之间可直接比：<br>
<b>A 原样</b>：材质不动、模型空间不动。　<b>C 只归零底面</b>：只把底面平移到 y=0，材质仍原样。
　<b>B 再加材质修正</b>：金属度拉高的压回 0.05、带透射的降级成普通半透明。<br>
于是 <b>A↔C 的差别只来自"贴地"，C↔B 的差别只来自"材质"</b> —— 两个变量不混在一起。跨模型比尺寸请看网格（1 格 1 m）。</p>
<div class="grid">
${cells}
</div>
<pre id="info">渲染中…</pre>
${blocks}
<script>window.__propmodels = ${modelsJs};</script>
<script type="module">
const srcOf = id => document.getElementById(id).textContent;
const info = document.getElementById('info');
const lines = [];
const step = m => { lines.push(m); info.textContent = lines.join('\\n'); };
window.__gameBooted = false;
window.__propStats = { models: 0, instances: 0, triangles: 0, failed: [], ms: 0, report: [] };

try {
  const coreUrl = URL.createObjectURL(new Blob([srcOf('__three_core')], { type: 'text/javascript' }));
  const modUrl = URL.createObjectURL(new Blob([srcOf('__three_module')
    .replace(/from\\s*["']\\.\\/three\\.core\\.min\\.js["']/g, 'from "' + coreUrl + '"')], { type: 'text/javascript' }));
  const THREE = await import(modUrl);

  const bguUrl = URL.createObjectURL(new Blob([srcOf('__prop_bgu')
    .replace(/from\\s*["']\\.\\/three\\.module\\.min\\.js["']/g, 'from "' + modUrl + '"')], { type: 'text/javascript' }));
  const gltfUrl = URL.createObjectURL(new Blob([srcOf('__prop_gltf')
    .replace(/from\\s*["']\\.\\/three\\.module\\.min\\.js["']/g, 'from "' + modUrl + '"')
    .replace(/from\\s*["']\\.\\/BufferGeometryUtils\\.js["']/g, 'from "' + bguUrl + '"')], { type: 'text/javascript' }));
  const { GLTFLoader } = await import(gltfUrl);
  step('three r' + THREE.REVISION + ' + GLTFLoader 就绪');

  const W = 360;
  /* 只用一个 WebGL 上下文：Chrome 活跃上下文有上限，18 格各建一个会被静默回收 */
  const rc = document.createElement('canvas');
  rc.width = rc.height = W;
  const r = new THREE.WebGLRenderer({ canvas: rc, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, W, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.02;

  /* 照 index.html：SUN_DIR = (0.62,0.52,0.58).normalize() */
  const SUN = new THREE.Vector3(0.62, 0.52, 0.58).normalize();
  const GROUND = 0x97cbbf;
  const EYE = new THREE.Vector3(0.75, 0.42, 1.0).normalize();

  /* 同一个 GLB 只解析一次（A/B 两格共用几何） */
  const cache = new Map();
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    const b64 = window.__propmodels[name];
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const gltf = await new GLTFLoader().parseAsync(u8.buffer, './models/');
    gltf.scene.updateWorldMatrix(true, true);
    let src = null;
    gltf.scene.traverse(o => { if (!src && o.isMesh) src = o; });
    const geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);      // 照 8c 节：node 变换烘进几何（JellyTranslucent 靠它做 1.87x/2.54x）
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mat = Array.isArray(src.material) ? src.material[0] : src.material;
    const rec = { geo, mat, tris: Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3) };
    cache.set(name, rec);
    return rec;
  }

  /* 推荐修法：只改**该改的**，并把每处改动记下来（报告里要能逐条核） */
  function fixedMaterial(mat) {
    const notes = [];
    const m = mat.clone();
    if (m.transmission > 0) {
      notes.push('transmission ' + m.transmission + '→0（省掉每帧一遍半分辨率全屏 pass）');
      m.transmission = 0;
      m.transparent = true;
      m.opacity = Math.min(m.opacity || 1, 0.72);
      notes.push('opacity→' + m.opacity.toFixed(2));
    }
    if (m.metalness >= 0.9) {
      notes.push('metalness ' + m.metalness.toFixed(2) + '→0.05（无环境贴图 ⇒ 金属度 1 时 diffuse=0）');
      m.metalness = 0.05;
      if (m.roughness >= 0.9) { notes.push('roughness ' + m.roughness.toFixed(2) + '→0.82'); m.roughness = 0.82; }
    }
    return { mat: m, notes };
  }

  const rows = [];
  const px = {};
  for (const cv of document.querySelectorAll('canvas')) {
    const name = cv.dataset.name, variant = cv.dataset.variant;
    const { geo, mat, tris } = await load(name);
    const bb = geo.boundingBox;
    const size = new THREE.Vector3(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdff0f0);
    scene.add(new THREE.HemisphereLight(0xcfeeff, 0xffd9b0, 1.45));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.5); sun.position.copy(SUN).multiplyScalar(30); scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45); rim.position.set(-0.7, 0.35, -0.65); scene.add(rim);
    const bnc = new THREE.DirectionalLight(0xffc0e0, 0.55); bnc.position.set(0.3, -0.25, 0.9); scene.add(bnc);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1.0, metalness: 0.0 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.GridHelper(12, 12, 0x6f9e93, 0x8fbdb2);
    grid.position.y = 0.004;
    scene.add(grid);

    let useMat = mat, notes = [], shift = 0;
    if (variant === 'C' || variant === 'B') {
      shift = -bb.min.y;                        // 底面归零：模型空间底面对齐地面
      if (Math.abs(shift) > 1e-6) notes.push('底面平移 +' + shift.toFixed(3) + ' m（原 minY=' + bb.min.y.toFixed(3) + '）');
      else notes.push('底面已在 y=0，无需平移');
    }
    if (variant === 'B') {
      const f = fixedMaterial(mat);
      useMat = f.mat;
      notes = notes.concat(f.notes);
      if (!f.notes.length) notes.push('材质无需修（金属度不高、无透射）');
    }
    const mesh = new THREE.Mesh(geo, useMat);
    mesh.position.y = shift;
    scene.add(mesh);

    /* 自动取景：按"摆好之后"的包围盒算，三列用同一套规则 ⇒ 列间可比 */
    const cy = (bb.min.y + bb.max.y) / 2 + shift;
    const rad = Math.max(size.x, size.y, size.z) * 0.5;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.02, 300);
    cam.position.set(0, cy, 0).addScaledVector(EYE, rad * 4.6);
    cam.lookAt(0, cy, 0);

    r.render(scene, cam);
    const ctx = cv.getContext('2d');
    cv.width = cv.height = W;
    ctx.drawImage(r.domElement, 0, 0, W, W);
    cv.style.aspectRatio = '1 / 1';

    /* 逐像素留底。**只能比 C↔B**：C 与 B 的底面平移量、相机、几何完全一样，
       差异只可能来自材质。A↔C 不行 —— 相机中心跟着 shift 走，画面本来就会变。 */
    if (variant === 'C' || variant === 'B') px[variant] = ctx.getImageData(0, 0, W, W).data;

    if (variant === 'A') {
      rows.push({ name, tris, size: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
                  minY: +bb.min.y.toFixed(3), type: mat.type,
                  metalness: mat.metalness, roughness: mat.roughness,
                  transmission: mat.transmission, transparent: !!mat.transparent,
                  opacity: mat.opacity, side: mat.side, map: !!mat.map });
    }
    if (variant === 'B' && px.C && px.B) {
      const rec = rows.find(x => x.name === name);
      if (rec) {
        let sumC = 0, sumB = 0, sumD = 0, darkC = 0, darkB = 0;
        const N = W * W;
        for (let i = 0; i < N; i++) {
          const lc = 0.2126 * px.C[i * 4] + 0.7152 * px.C[i * 4 + 1] + 0.0722 * px.C[i * 4 + 2];
          const lb = 0.2126 * px.B[i * 4] + 0.7152 * px.B[i * 4 + 1] + 0.0722 * px.B[i * 4 + 2];
          sumC += lc; sumB += lb;
          sumD += (Math.abs(px.C[i * 4] - px.B[i * 4]) + Math.abs(px.C[i * 4 + 1] - px.B[i * 4 + 1]) +
                   Math.abs(px.C[i * 4 + 2] - px.B[i * 4 + 2])) / 3;
          if (lc < 64) darkC++;
          if (lb < 64) darkB++;
        }
        rec.lumC = +(sumC / N).toFixed(1);
        rec.lumB = +(sumB / N).toFixed(1);
        rec.meanDiffCB = +(sumD / N).toFixed(1);
        rec.darkPctC = +(100 * darkC / N).toFixed(1);
        rec.darkPctB = +(100 * darkB / N).toFixed(1);
      }
    }
    step(name.padEnd(10) + ' [' + variant + ']  三角 ' + String(tris).padStart(5) +
         '  bbox ' + size.x.toFixed(3) + '×' + size.y.toFixed(3) + '×' + size.z.toFixed(3) +
         '  minY=' + bb.min.y.toFixed(3) + '  ' + useMat.type +
         '  metal=' + useMat.metalness.toFixed(2) + ' rough=' + useMat.roughness.toFixed(2) +
         '  trans=' + (useMat.transmission || 0) + '  alpha=' + (useMat.transparent ? useMat.opacity.toFixed(2) : 'OPAQUE') +
         (notes.length ? '\\n            └ ' + notes.join(' / ') : ''));
  }

  step('');
  step('---- 汇总 ----');
  step('模型数 = ' + rows.length + '，三角形合计 = ' + rows.reduce((a, x) => a + x.tris, 0));
  step('需要压金属度的 = ' + rows.filter(x => x.metalness >= 0.9).length +
       '，带透射的 = ' + rows.filter(x => x.transmission > 0).length +
       '，底面不在 y=0 的 = ' + rows.filter(x => Math.abs(x.minY) > 1e-6).length);
  step('');
  step('C↔B 逐像素比较（底面平移量/相机/几何全同 ⇒ 差异只来自材质；lum=全画面平均亮度 0~255）');
  for (const x of rows) {
    const d = x.lumB - x.lumC;
    step('  ' + x.name.padEnd(19) + ' lum C=' + String(x.lumC).padStart(6) + '  B=' + String(x.lumB).padStart(6) +
         '  Δ=' + (d > 0 ? '+' + d.toFixed(1) : d.toFixed(1)).padStart(6) +
         '  平均像素差=' + String(x.meanDiffCB).padStart(5) +
         '  暗部(<64) C=' + x.darkPctC + '%  B=' + x.darkPctB + '%');
  }
  window.__propStats.models = rows.length;
  window.__propStats.triangles = rows.reduce((a, x) => a + x.tris, 0);
  window.__propStats.report = rows;
  window.__gameBooted = true;
} catch (e) {
  const msg = (e && (e.message || e)) + '';
  step('!! 失败：' + msg);
  window.__propStats.failed.push(msg);
  window.__gameBooted = true;
}
</script>
</body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, page, 'utf8');
console.log('写出 ' + OUT + '  ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB' + '（' + files.length + ' 模型 / ' + files.length * 2 + ' 格）');
