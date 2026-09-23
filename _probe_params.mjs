/**
 * 打印当前场上生物的**实际参数表**（外观 + 运动 + 碰撞）。
 *
 * 为什么要有它：这些数字散在四五处（SPECIES_LIST / loadModel / normalizeModelMaterial /
 * HOP_TRACK / updateAnimals），而注释里写的和运行时的**未必一致**
 * （比如"金并缩放 1.872"是烘进几何之前的原始值）。做外观或基因设计前，
 * 要的是"现在真正跑的是什么"，不是"注释里写着什么"。
 *
 * 用法： node _probe_params.mjs
 * 只读，不改任何生产代码；不需要浏览器。
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';

const DRIVER = `
${DRIVER_HEAD}
loop();

const fmt = (v, n) => Number(v).toFixed(n === undefined ? 3 : n);

/* ---------- 派生常量（从生产代码里直接读出来的函数算） ---------- */
console.log('=== 弹跳派生量 ===');
console.log('HOP_PERIOD(基准) = ' + HOP_PERIOD + ' s   HOP_LIFT_RATIO = ' + HOP_LIFT_RATIO);
console.log('HOP_MOVE_MEAN    = ' + fmt(HOP_MOVE_MEAN, 4) + '   （位移倍率的周期均值，用来归一化）');
{
  let lo = Infinity, hi = -Infinity, loS = Infinity, hiS = -Infinity;
  for (let i = 0; i <= 400; i++) {
    const q = sampleHop(i / 400);
    lo = Math.min(lo, q.sy); hi = Math.max(hi, q.sy);
    loS = Math.min(loS, q.sxz); hiS = Math.max(hiS, q.sxz);
  }
  console.log('形变范围 sy = [' + fmt(lo, 2) + ', ' + fmt(hi, 2) + ']   sxz = [' + fmt(loS, 2) + ', ' + fmt(hiS, 2) + ']');
}

/* ---------- 逐物种参数 ---------- */
for (const sp of SPECIES_LIST) {
  const mine = animals.filter(a => a.species === sp);
  if (!mine.length) continue;
  console.log('');
  console.log('=== ' + sp.key + '（' + sp.name + '）  场上 ' + mine.length + ' 只  模型 ' + sp.glb + ' ===');
  /* ⚠️ 2026-09-23 起体型是**制式化**的：每物种一个目标包围盒（BODY_BOX[sp.body]），
     装载时逐轴缩放烘进几何，baseScale 恒为 1。所以这里打的是**档位 + 目标盒 + 实测盒**，
     不再是"随机缩放的区间"。 */
  const rr = mine.map(a => a.cyl.r), hh = mine.map(a => a.cyl.h);
  const box = BODY_BOX[sp.body] || BODY_BOX.A;
  console.log('体型档位  ' + (sp.body || '?') + '   目标盒 ' + fmt(box.x, 3) + ' × ' + fmt(box.y, 3) +
              ' × ' + fmt(box.z, 3) + ' m（宽×高×深）   baseScale 恒为 ' + mine[0].baseScale);
  console.log('碰撞圆柱  r ∈ [' + fmt(Math.min(...rr), 2) + ', ' + fmt(Math.max(...rr), 2) + ']'
              + ' m   h ∈ [' + fmt(Math.min(...hh), 2) + ', ' + fmt(Math.max(...hh), 2) + '] m');
  console.log('跳跃周期  ' + fmt(1 / hopRate(sp.speed)) + ' s（' + fmt(hopRate(sp.speed), 2) + ' 跳/秒）'
              + '   逃跑时 ' + fmt(1 / hopRate(sp.speed * 2.6)) + ' s（' + fmt(hopRate(sp.speed * 2.6), 2) + ' 跳/秒）');
  console.log('跳跃高度  ' + fmt(box.y * HOP_LIFT_RATIO, 2) + ' m（= 体高 × ' + HOP_LIFT_RATIO + '）');

  const body = mine[0].g.userData.body;
  const m = body.material;
  const img = m.map && m.map.image ? m.map.image : null;
  console.log('--- 运行时材质（真正在用的那个）---');
  console.log('类型      : ' + m.type + (body.isMesh ? '' : '  ⚠ body 不是 Mesh'));
  console.log('color     : #' + m.color.getHexString() + '   （基色乘子）');
  console.log('roughness : ' + m.roughness + '   metalness : ' + m.metalness);
  console.log('transparent=' + m.transparent + '  opacity=' + m.opacity + '  side=' + m.side
              + '  depthWrite=' + m.depthWrite);
  /* ⚠️ 这里的贴图尺寸**不可信**：Node 夹具把 createImageBitmap 换成了 1×1 的假位图
     （见 test/harness.mjs 里那三处 GLTFLoader 桩），所以 map.image 永远是 1×1。
     真实尺寸要从 GLB 里读（python _probe_glb.py models）——
     两个史莱姆的基色贴图都是 2048×2048 JPEG。
     这一条特意写在输出里，免得下一个人看到 "map=1x1" 以为贴图丢了。 */
  const stub = img && img.width === 1 && img.height === 1;
  console.log('贴图      : map=' + (img ? (img.width + 'x' + img.height + (stub ? ' ← 夹具桩，真实尺寸见 GLB（2048²）' : '')) : '无')
              + '  normalMap=' + (m.normalMap ? '有' : '无')
              + '  roughnessMap=' + (m.roughnessMap ? '有' : '无')
              + '  metalnessMap=' + (m.metalnessMap ? '有' : '无')
              + '  emissiveMap=' + (m.emissiveMap ? '有' : '无'));
  console.log('           side=2 → THREE.DoubleSide（0=Front 1=Back 2=Double）');
  if ('transmission' in m) console.log('transmission = ' + m.transmission + '（0 = 已降级，不走全屏 pass）');
  console.log('几何      : 三角形 ' + Math.round((body.geometry.index ? body.geometry.index.count
              : body.geometry.attributes.position.count) / 3)
              + '  顶点 ' + body.geometry.attributes.position.count);
  const bb = body.geometry.boundingBox;
  console.log('几何包围盒(已烘节点缩放+底面归零): x ' + fmt(bb.max.x - bb.min.x, 3)
              + '  y ' + fmt(bb.max.y - bb.min.y, 3) + '  z ' + fmt(bb.max.z - bb.min.z, 3)
              + '   minY=' + fmt(bb.min.y, 4));
  console.log('**场上实际尺寸**（= 几何盒，已含制式化缩放）:')
  console.log('   宽 ' + fmt(bb.max.x - bb.min.x, 2) + ' m   高 ' + fmt(bb.max.y - bb.min.y, 2) +
              ' m   深 ' + fmt(bb.max.z - bb.min.z, 2) + ' m');
  console.log('几何/材质是否全物种共用: geo=' + (mine.every(a => a.g.userData.body.geometry === body.geometry))
              + '  mat=' + (mine.every(a => a.g.userData.body.material === m)) + '  （共用的意义见注释）');
}

/* ---------- 全物种共用的行为常量 ---------- */
console.log('');
console.log('=== 行为常量（两种史莱姆完全一样 —— 没有任何按物种分支）===');
console.log('逃跑半径 9.5 m｜逃跑速度 ×2.6｜闲逛 turning ±0.45 rad/s（每 2~7 s 重抽）');
console.log('撞墙：钳到 ARENA*0.94 − cyl.r；反应期 1.2~2.7 s 内朝场地中心拐（rate dt*3.0）');
console.log('碰撞：两两法向推开、质量 1:1；尸体是静态障碍；场地 = ±' + ARENA + ' m');
console.log('无重力（y 恒 = sampleHeight = 0，跳跃靠 lift 抬升，不是真物理）');

/* ---------- 现在场上的实际分布 ---------- */
console.log('');
console.log('=== 场上分布 ===');
{
  const byKey = {};
  for (const a of animals) (byKey[a.species.key] = byKey[a.species.key] || []).push(a);
  for (const k of Object.keys(byKey)) {
    const arr = byKey[k];
    const tot = arr.reduce((s, a) => s + Math.round((a.g.userData.body.geometry.index
      ? a.g.userData.body.geometry.index.count : a.g.userData.body.geometry.attributes.position.count) / 3), 0);
    console.log(k.padEnd(12) + arr.length + ' 只   三角合计 ' + tot.toLocaleString('en-US'));
  }
  console.log('合计 ' + animals.length + ' 只');
}
`;

await runGame(DRIVER);
