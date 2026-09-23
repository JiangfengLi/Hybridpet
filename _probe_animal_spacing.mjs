/**
 * 生物间距与"卡住"排查探针。
 *
 * 由来：史莱姆从 8 只补到 40 只之后，出现一条 `FAIL 每只史莱姆都在移动（没动的 slime-ball#28）`。
 * 两种可能：(a) 生成时就互相重叠（40 个点随机撒、只避开出生点和边界）；
 *          (b) 被挤在墙/其他生物之间，每帧被推回原处 —— 净位移为 0。
 * 这条探针把两件事都摊开量：**生成瞬间的最近邻间距**、**跑 N 帧后的位移分布**。
 *
 * 用法： node _probe_animal_spacing.mjs [帧数]
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';

const FRAMES = Number(process.argv[2] || 240);

const DRIVER = `
${DRIVER_HEAD}
loop();                                   // 跑一帧让装配后的状态定型

const land = animals.filter(a => !a.captured && a.g.userData.kind === 'land');

/* ---------- ① 生成瞬间的"侵入量"：sum(r) − d，>0 就是互相插进去了 ---------- */
function intrusions(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = Math.hypot(list[j].x - list[i].x, list[j].z - list[i].z);
      const pen = (list[i].cyl.r + list[j].cyl.r) - d;
      if (pen > 0) out.push({ a: i, b: j, d, pen, ka: list[i].species.key, kb: list[j].species.key });
    }
  }
  return out;
}
const before = land.map(a => ({ x: a.x, z: a.z, key: a.species.key }));
const intr = intrusions(land);
console.log('陆生生物 = ' + land.length + ' 只');
console.log('半径范围 = ' + Math.min.apply(null, land.map(a => a.cyl.r)).toFixed(3) + ' ~ ' +
            Math.max.apply(null, land.map(a => a.cyl.r)).toFixed(3) + ' m');
console.log('体高范围 = ' + Math.min.apply(null, land.map(a => a.cyl.h)).toFixed(3) + ' ~ ' +
            Math.max.apply(null, land.map(a => a.cyl.h)).toFixed(3) + ' m');
console.log('生成瞬间"互相插进去"的配对 = ' + intr.length + ' 对');
intr.sort((a, b) => b.pen - a.pen).slice(0, 8).forEach(o =>
  console.log('   ' + o.ka + '#' + o.a + ' × ' + o.kb + '#' + o.b +
              '  d=' + o.d.toFixed(3) + '  侵入=' + o.pen.toFixed(3) + ' m'));

/* ---------- ② 跑 N 帧后看位移分布 ---------- */
for (let i = 0; i < ${FRAMES}; i++) loop(0.016);
const disp = land.map((a, i) => ({ i, key: a.species.key, d: Math.hypot(a.x - before[i].x, a.z - before[i].z) }));
disp.sort((a, b) => a.d - b.d);
console.log('');
console.log('跑 ${FRAMES} 帧后位移：最小 ' + disp[0].d.toFixed(4) + ' m（' + disp[0].key + '#' + disp[0].i + '）' +
            '｜中位 ' + disp[Math.floor(disp.length / 2)].d.toFixed(2) +
            '｜最大 ' + disp[disp.length - 1].d.toFixed(2) + ' m');
console.log('位移最小的 6 个：');
disp.slice(0, 6).forEach(o => console.log('   ' + o.key + '#' + o.i + '  ' + o.d.toFixed(4) + ' m'));

/* ---------- ③ 还插着吗（解算收敛了没有） ---------- */
const after = land.map(a => ({ x: a.x, z: a.z, cyl: a.cyl, species: a.species }));
const intr2 = intrusions(after);
console.log('');
console.log('跑完之后仍互相插进去的配对 = ' + intr2.length + ' 对');
intr2.sort((a, b) => b.pen - a.pen).slice(0, 5).forEach(o =>
  console.log('   ' + o.ka + '#' + o.a + ' × ' + o.kb + '#' + o.b + '  侵入=' + o.pen.toFixed(4) + ' m'));

/* ---------- ④ 几何一致性：包围盒 vs 碰撞体 ---------- */
{
  const bad = [];
  for (const a of land) {
    if (!a.cyl || !Number.isFinite(a.cyl.r) || !Number.isFinite(a.cyl.h)) { bad.push(a.species.key + ' cyl 非法'); continue; }
    if (a.cyl.r <= 0 || a.cyl.h <= 0) bad.push(a.species.key + ' cyl 非正');
    if (Math.abs(a.cyl.y0) > 0.02) bad.push(a.species.key + ' y0=' + a.cyl.y0.toFixed(3) + '（底面应≈0）');
  }
  ok(bad.length === 0, '碰撞体数值合法（' + (bad.join('; ') || '无问题') + '）');
}
ok(land.every(a => a.cyl.r > 0.2 && a.cyl.r < 3), '半径都是"生物尺度"（0.2~3 m）');
ok(land.every(a => a.cyl.h > 0.5 && a.cyl.h < 4), '高度都是"生物尺度"（0.5~4 m）');
`;

await runGame(DRIVER);
