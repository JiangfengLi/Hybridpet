/**
 * 「某只生物卡住不动」的定点排查探针。
 *
 * 由来（2026-09-23）：史莱姆从 8 只补到 40 只之后，集成测试报
 *   FAIL 每只史莱姆都在移动（没动的 slime-ball#28）
 * 而从头跑 240 帧时 40 只**全都**在动（见 _probe_animal_spacing.mjs）——
 * 说明问题只在"集成测试那套时序下"才出现：先跑 900+1800 帧，
 * 再把玩家挪到"离原点最近的配重点位"。
 * 本探针就是**复现那套时序**，然后把位移最小的几只连位置 / 半径 / 离墙裕度一起打出来。
 *
 * 它当时给出的答案（现在也留着当回归工具）：
 *   那只停在 **(92.84, 92.84)** —— 场地**角落**，离墙裕度 0.00，
 *   单帧位移恒为 0、朝向 240 帧只变 0.0004 rad/帧。
 *   根因不是随机流、不是速度，而是"逐轴钳制"在角落同时削掉两个分量 ⇒
 *   它得拐 45° 以上才出得来，而撞墙反应当时被"每帧被削 ⇒ 每帧重抽"给废掉了。
 *   详见 index.html 空气墙那段的长注释。
 *
 * 用法： node _probe_animal_stuck.mjs
 * 约 5 秒；不需要浏览器（走 test/harness.mjs 的 Node 夹具）。
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';
const DRIVER = `
${DRIVER_HEAD}
/* 复现集成测试走到 9d 时的状态：先跑 900 + 1800 帧，并把玩家挪到"离原点最近的配重点位" */
started = true;
player.x = 0; player.z = 0;
for (let i = 0; i < 900; i++) loop();
player.x = 0; player.z = 0;
for (let i = 0; i < 1800; i++) loop();
{
  const near = pickableItems.reduce((a,b) => Math.hypot(b.x,b.z) <= Math.hypot(a.x,a.z) ? b : a);
  player.x = near.x; player.z = near.z; player.y = sampleHeight(near.x, near.z);
  player.vx = player.vz = 0;
  for (let i = 0; i < 30; i++) loop();
  console.log('玩家停在 (' + player.x.toFixed(1) + ', ' + player.z.toFixed(1) + ')');
}
const slimes = animals.filter(a => a.species.glb);
const before = slimes.map(a => ({ x: a.x, z: a.z, key: a.species.key }));
let travel = 0; const prevH = slimes.map(a => a.heading);
for (let i = 0; i < 240; i++) { loop(0.016); slimes.forEach((a,k) => { travel += Math.abs(a.heading - prevH[k]); prevH[k] = a.heading; }); }
const disp = slimes.map((a,i) => ({ i, key: a.species.key, d: Math.hypot(a.x - before[i].x, a.z - before[i].z),
  r: a.cyl.r, x: a.x, z: a.z }));
disp.sort((a,b) => a.d - b.d);
console.log('全群朝向累计行程 ' + travel.toExponential(2));
disp.slice(0, 6).forEach(o => console.log('  ' + o.key + '#' + o.i + ' 位移 ' + o.d.toFixed(5) +
  '  at (' + o.x.toFixed(2) + ', ' + o.z.toFixed(2) + ')  r=' + o.r.toFixed(2) +
  '  |x|,|z| max=' + Math.max(Math.abs(o.x), Math.abs(o.z)).toFixed(2) + ' 裕度=' + (94 - o.r - Math.max(Math.abs(o.x), Math.abs(o.z))).toFixed(2)));
/* 它身边有几只 */
const w = slimes[disp[0].i];
const near = slimes.filter(a => a !== w).map(a => ({k:a.species.key, d: Math.hypot(a.x-w.x,a.z-w.z), sum:a.cyl.r+w.cyl.r})).filter(o => o.d < o.sum + 0.1);
console.log('最近的 stuck 那只旁边（含 0.1 m 余量）有 ' + near.length + ' 只：' + JSON.stringify(near.slice(0,5)));
/* 它的朝向与位置在这一帧前后的变化 */
const p1 = {x:w.x, z:w.z, h:w.heading, ph:w.phase};
loop(0.016);
console.log('单帧位移 ' + Math.hypot(w.x-p1.x, w.z-p1.z).toExponential(2) + '  朝向 Δ ' + (w.heading-p1.h).toExponential(2) + '  phase Δ ' + (w.phase-p1.ph).toFixed(4));
`;
await runGame(DRIVER);
