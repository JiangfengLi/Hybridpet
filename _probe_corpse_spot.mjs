/**
 * 探针：给"尸体截图"算一个**可用的机位**。
 *
 * 为什么要算而不是试：第一版机位是我手写的（pos=0,26&yaw=0&watch=0,19.6,0.45），
 * 拍出来整屏是一只**活体**的粉色大屁股 —— 尸体就站在它背后，完全看不见。
 * 原因很朴素：`&slay` 把尸体放在玩家正前方 6.4 m，而**那里站着什么是随机的**。
 * 机位这种事只有两条路：要么算，要么一直瞎拍。这里算。
 *
 * 判据（全部是"如果这里站着一具尸体，它能不能被看清"）：
 *   ① 尸体点必须在场地内、且离墙有富余（太靠边会有雾/墙的影响）
 *   ② 尸体点 2.5 m 内不能有任何动物（否则尸体被穿模/完全挡住）—— 就是上一版挂掉的原因
 *   ③ 视线：从眼睛(1.68 m)到尸体点的射线上，**第一个交点必须在尸体之后**
 *      （用真 three.js 的 Raycaster 打整棵场景树，所以树、石头、营地、动物都算）
 *   ④ 相机 3 m 内不要有动物（否则画面边缘会杵着半个身子）
 *   ⑤ 尸体点离相机 >= 6.4 m（就是定死的落点距离，用来复核约定没被改过）
 *
 * 用法： E:/anaconda/python.exe 不管用，这是 .mjs：
 *        node _probe_corpse_spot.mjs
 *        node _probe_corpse_spot.mjs '?autostart=1&intro=0&still=1&hud=0&fill=1&slay=glb'
 *        node _probe_corpse_spot.mjs '<查询串>' 'pos=16,32&yaw=3.142'
 *
 * 第 2 个参数是查询串：截图脚本里每张图的参数不同（有没有 &slay=glb 会改变
 * animals 的构成 —— 宰掉一只之后场上少一只），所以复核某张图时必须用**那张图自己的**
 * 查询串，否则量的是另一个场景。
 * 第 3 个起的参数是"复核这些机位"，打印体检结论而不是重新搜索。
 */
import { runGame, DRIVER_HEAD, DRIVER_FOOTER } from './test/harness.mjs';

/* 命令行进来的查询串与待复核机位。引号由 shell 去掉，这里只做最小解析。 */
const ARGV = process.argv.slice(2);
const SEARCH = ARGV[0] && ARGV[0].startsWith('?')
  ? ARGV[0]
  : '?autostart=1&intro=0&still=1&hud=0&fill=1';
const CHECK = ARGV.filter(a => a.startsWith('pos='));
/* 拼成 driver 里可以直接吃的 JS 字面量（避免在模板字符串里手写引号） */
const CHECK_SRC = JSON.stringify(CHECK);

const DRIVER = `
${DRIVER_HEAD}
/* 用**和截图脚本完全一样**的启动条件：模拟冻结（still=1）+ fill=1 预填。
   一旦截图脚本的参数变了，这里算出来的东西也会跟着变 —— 这是故意的。 */
console.log('location.search = ' + location.search);
console.log('玩家 = (' + player.x.toFixed(1) + ', ' + player.z.toFixed(1) + ')｜动物 ' +
            animals.length + ' 只｜尸体 ' + corpses.length + ' 具' +
            (corpses.length ? '（' + corpses.map(c => c.species.key).join(', ') + ' 于 ' +
              corpses.map(c => '(' + c.x.toFixed(1) + ',' + c.z.toFixed(1) + ')').join(' ') + '）' : ''));

const ray = new THREE.Raycaster();
/* ⚠️ 必须给 raycaster 一个 camera：场景里有 Sprite（信号源的光点就是），
   而 three 对 Sprite 做射线检测时**会读 raycaster.camera**，不给就抛
   "Raycaster.camera needs to be set in order to raycast against sprites"，
   而且异常信息里会把整份 three.js 源码打出来 —— 我这一轮就被这坨 370 KB 的输出淹了一次。 */
ray.camera = camera;
const eye = new THREE.Vector3();
const dir = new THREE.Vector3();
const tgt = new THREE.Vector3();

/* 把"看得见吗"写成一个函数，这样以后换判据只改这一处 */
function lookAt(x, z, yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const cx = x + fx * 6.4, cz = z + fz * 6.4;          // 尸体落点 = slayPal 的约定
  const out = { x, z, yaw, cx, cz, reason: null, los: 0, nearAnimal: 0, camAnimal: 0 };

  if (Math.max(Math.abs(cx), Math.abs(cz)) > 88) { out.reason = '尸体太靠墙'; return out; }

  let nearAnimal = 1e9, camAnimal = 1e9;
  for (const a of animals) {
    if (a.captured || a.dead) continue;
    nearAnimal = Math.min(nearAnimal, Math.hypot(a.x - cx, a.z - cz));
    camAnimal = Math.min(camAnimal, Math.hypot(a.x - x, a.z - z));
  }
  out.nearAnimal = nearAnimal; out.camAnimal = camAnimal;
  if (nearAnimal < 2.5) { out.reason = '尸体点上站着动物（' + nearAnimal.toFixed(1) + ' m）'; return out; }
  if (camAnimal < 3.0) { out.reason = '相机旁边杵着动物（' + camAnimal.toFixed(1) + ' m）'; return out; }

  eye.set(x, sampleHeight(x, z) + EYE, z);
  tgt.set(cx, sampleHeight(cx, cz) + 0.45, cz);        // watch 的 y 也是 0.45
  dir.copy(tgt).sub(eye).normalize();
  ray.set(eye, dir);
  const hits = ray.intersectObjects(scene.children, true);
  out.los = hits.length ? hits[0].distance : Infinity;
  /* 第一交点必须落在尸体点之后（留 0.4 m 余量给尸体自己的体积） */
  if (out.los < 6.0) { out.reason = '视线被挡（首个交点 ' + out.los.toFixed(2) + ' m）'; return out; }
  return out;
}

const cands = [];
for (let gx = -80; gx <= 80; gx += 8) {
  for (let gz = -80; gz <= 80; gz += 8) {
    for (let k = 0; k < 4; k++) {
      const yaw = k * Math.PI / 2;
      const r = lookAt(gx, gz, yaw);
      if (!r.reason) cands.push(r);
    }
  }
}
console.log('\\n候选机位 ' + cands.length + ' 个（8 m 网格 × 4 个朝向，全部通过 4 条判据）');

/* 排序偏好：前两项是"别被挡住、别太挤"；第三项把机位从墙角拉回来 ——
   纯按"离动物最远"排会全部落到场地边缘（那儿本来就没动物），
   拍出来背景空荡荡、还贴着看不见的空气墙。这里偏好尸体点离原点 30~55 m 的位置，
   那圈里植被/岩石最密，背景读得出来是"这片草地上的东西"。 */
const score = c => Math.min(c.nearAnimal, 14) + Math.min(c.camAnimal, 10)
  - 0.35 * Math.abs(Math.hypot(c.cx, c.cz) - 42);
cands.sort((a, b) => score(b) - score(a));
const top = cands.slice(0, 8);
console.log('\\n推荐机位（前 6）：');
for (const c of top) {
  console.log('  pos=' + c.x + ',' + c.z + '&yaw=' + c.yaw.toFixed(3) +
    '&watch=' + c.cx.toFixed(2) + ',' + c.cz.toFixed(2) + ',0.45' +
    '   尸体离最近动物 ' + c.nearAnimal.toFixed(1) + ' m｜相机离最近动物 ' + c.camAnimal.toFixed(1) +
    ' m｜首个交点 ' + (Number.isFinite(c.los) ? c.los.toFixed(1) : '无(打到天)') + ' m');
}
ok(cands.length > 0, '存在至少一个"尸体不会被挡住"的机位（找到 ' + cands.length + ' 个）');

/* ── 复核指定机位 ───────────────────────────────────────────────
   给的是截图脚本里真正会写进去的那一段（pos=…&yaw=…），量的是
   "如果尸体按约定落在正前方 6.4 m，它此刻会不会被挡住"。
   ⚠️ 必须用**这张图自己的**查询串跑：&slay=glb 会先抓一只史莱姆再宰，
      场上动物构成因此不同（41 → 40），量的距离也就不同。 */
const CHECK = ${CHECK_SRC};
if (CHECK.length) {
  console.log('\\n复核机位（查询串 ' + location.search + '）：');
  const bads = [];
  for (const spec of CHECK) {
    const body = spec.replace(/^pos=/, '');
    const parts = body.split('&');
    const c0 = parts[0].split(',');
    let x = Number(c0[0]), z = Number(c0[1]), yaw = 0;
    for (const kv of parts.slice(1)) {
      const eq = kv.indexOf('=');
      if (kv.slice(0, eq) === 'yaw') yaw = Number(kv.slice(eq + 1));
    }
    const r = lookAt(x, z, yaw);
    console.log('  ' + spec + '  ⇒  尸体 (' + r.cx.toFixed(2) + ', ' + r.cz.toFixed(2) + ')｜' +
      (r.reason ? '不合格 —— ' + r.reason : '合格') +
      '｜尸体点最近动物 ' + r.nearAnimal.toFixed(1) + ' m｜相机最近动物 ' + r.camAnimal.toFixed(1) +
      ' m｜首个交点 ' + (Number.isFinite(r.los) ? r.los.toFixed(1) : '无(打到天)') + ' m');
    if (r.reason) bads.push(spec + '：' + r.reason);
  }
  ok(bads.length === 0, '复核的 ' + CHECK.length + ' 个机位全部合格' +
    (bads.length ? '（不合格 ' + bads.length + ' 个：' + bads.join('；') + '）' : ''));
}

/* ── 对照机位：活体与尸体同框 ────────────────────────────────────────
   为什么值得单独搜一遍："同模型但变灰"这件事，**唯一**能让人眼确认的证据是
   "同一物种、差不多姿态，一个有色一个没色"。只拍尸体的话，看图的人只能相信
   我"它本来是粉的"这句转述 —— 那正是最不该让人信的地方。

   判据①~④之上再加两条：
     ⑤ 那只**活体**与尸体落点的夹角 < 28°（即两者在画面里挨在一起，而不是对角相望）
     ⑥ 活体离尸体落点 3.5~9 m。上界的理由：太远就看不出"同一个模型"；
        下界的理由除了穿模，还有一条几何上的：相机到尸体只有 6.4 m，
        若活体落在相机与尸体之间的那段线上且距相机 < 3.4 m，它离尸体就 < 3.5 m
        ⇒ 被 ⑥ 的下界自动排除，不会出现"活体把尸体挡了个正着"。 */
function pairFor(c) {
  if (c.reason) return null;
  const vx = c.cx - c.x, vz = c.cz - c.z;
  const vl = Math.hypot(vx, vz) || 1e-9;
  const COS28 = Math.cos(28 * Math.PI / 180);
  let best = null;
  for (const a of animals) {
    if (a.captured || a.dead) continue;
    const d = Math.hypot(a.x - c.cx, a.z - c.cz);
    if (d < 3.5 || d > 9) continue;
    const ax = a.x - c.x, az = a.z - c.z;
    const al = Math.hypot(ax, az);
    if (al < 3) continue;
    if ((vx * ax + vz * az) / (vl * al) < COS28) continue;
    if (!best || d < best.d) best = { d, key: a.species.key, glb: !!a.species.glb };
  }
  return best;
}

const pairs = [];
for (let gx = -76; gx <= 76; gx += 4) {
  for (let gz = -76; gz <= 76; gz += 4) {
    for (let k = 0; k < 4; k++) {
      const c = lookAt(gx, gz, k * Math.PI / 2);
      if (c.reason) continue;
      const p = pairFor(c);
      if (p) pairs.push({ c, p });
    }
  }
}
/* 分两组分别给榜：带贴图的（&slay=glb 要的同框对象）与程序化的。
   为什么必须分组 —— 活体是史莱姆、尸体是程序化物种的话，这组对照不但白拍，
   还会让人以为"变色了"。同框的两者必须是**同一个物种**。
   ⚠️ 2026-09-23 起第二组**恒为空**：程序化物种全部 spawn: false、场上不生成，
   animals 里一个都没有 ⇒ pairs 里自然全是带贴图的史莱姆。
   留着这个分组是因为"把某个物种放回场上"只需要删一行 spawn:false，
   到时候这里不用改。看到"候选 0 个"时不必怀疑探针坏了。 */
for (const [title, filt] of [
  ['带贴图的物种（配 &slay=glb）', p => p.p.glb],
  ['程序化物种（配 &slay=1 或 &slay=<key>）—— 当前恒为空，见上', p => !p.p.glb],
]) {
  const g = pairs.filter(filt).sort((a, b) => a.p.d - b.p.d);
  console.log('\\n对照机位 · ' + title + '：候选 ' + g.length + ' 个，前 4：');
  for (const { c, p } of g.slice(0, 4)) {
    console.log('  pos=' + c.x + ',' + c.z + '&yaw=' + c.yaw.toFixed(3) +
      '&watch=' + c.cx.toFixed(2) + ',' + c.cz.toFixed(2) + ',0.45' +
      '   同框活体 ' + p.key + ' 离尸体 ' + p.d.toFixed(2) + ' m' +
      '｜尸体点最近动物 ' + c.nearAnimal.toFixed(1) + ' m｜首个交点 ' +
      (Number.isFinite(c.los) ? c.los.toFixed(1) : '无') + ' m');
  }
}
ok(pairs.length > 0, '存在"活体与尸体同框"的机位（找到 ' + pairs.length + ' 个 —— 0 个说明判据 ⑤⑥ 太紧，得放宽）');
ok(pairs.some(p => p.p.glb) && pairs.some(p => !p.p.glb),
  '两组（带贴图 / 程序化）都有候选（' + pairs.filter(p => p.p.glb).length + ' / ' +
  pairs.filter(p => !p.p.glb).length + ' 个）');

/* 顺手把第一版那个失败的机位量一下，把"为什么会拍到大屁股"留成可核证据 */
{
  const bad = lookAt(0, 26, 0);
  console.log('\\n第一版机位 (0,26) yaw=0 的体检：' +
    (bad.reason ? '不合格 —— ' + bad.reason : '合格（那这次是偶发，得换判据）') +
    '｜尸体点上最近动物 ' + bad.nearAnimal.toFixed(2) + ' m');
  ok(!!bad.reason, '第一版机位确实不合格（这就是那张图拍到大屁股的原因）');
}
${DRIVER_FOOTER}
`;

await runGame(DRIVER, { search: SEARCH });
