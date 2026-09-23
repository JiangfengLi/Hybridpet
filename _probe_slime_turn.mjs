/**
 * 探针：集成测试 9d 节那条 `turned === slimes.length` 到底为什么会偶发 FAIL。
 *
 * 背景：9d 里推进 240 帧，然后断言"每只史莱姆都转了向"。上一轮它报过 7/8。
 * 那是**真的没转**，还是断言的观察窗口太短 / 判据太敏感？
 * 这条断言属于"观察涌现行为"，最容易变成偶发红 —— 所以要么找出机制，
 * 要么把判据换成真正想守的那条契约（朝向**响应**转向输入），不能含糊。
 *
 * 这个探针做两件事：
 *   ① 在同一个进程里连开 20 个 240 帧的窗口（每个窗口都是一次独立抽样），
 *      统计"没转向"的出现率 —— 一次运行就能看出是 1/40 还是 1/4。
 *   ② 把没转向的那只当场摊开：离玩家多远、是否在 flee（逃跑时朝向是
 *      一个**固定目标**，会收敛后不再变化）、e.turning 的取样值、
 *      以及 240 帧里朝向实际变了多少弧度。
 *
 * 用法： node _probe_slime_turn.mjs
 */
import { runGame, DRIVER_HEAD, DRIVER_FOOTER } from './test/harness.mjs';

const DRIVER = `
${DRIVER_HEAD}

/* 复刻 9d 节之前的状态：玩家站在某个配重点位上、跑 30 帧。
   （9 节末尾就是这么把玩家放过去的 —— 玩家位置会决定史莱姆是否进入 flee） */
{
  const it = pickableItems[pickableItems.length >> 1];
  player.x = it.x; player.z = it.z;
  player.y = 0; player.vx = player.vz = player.vy = 0;
  for (let i = 0; i < 30; i++) loop(0.016);
}
console.log('玩家 = (' + player.x.toFixed(1) + ', ' + player.z.toFixed(1) + ')');

const slimes = animals.filter(a => a.species.glb);

/* 先量一下"每 240 帧朝向到底能变多少" —— 这是判据 1e-4 有没有意义的前提。
   顺带记下 approachAngle 的实际速率：dt*1.2 = 0.0192，每帧只走 1.92% 的差距，
   所以**朝向变化 = turning * dt * 0.0192**，比 turning 本身小两个数量级。 */
console.log('\\n--- 单只史莱姆的转向速率标定（30 帧）---');
{
  const a = slimes[0];
  const h0 = a.heading, t0 = a.turning;
  for (let i = 0; i < 30; i++) loop(0.016);
  console.log('  turning 取样 = ' + t0.toFixed(5) +
              ' → 30 帧朝向变化 = ' + (a.heading - h0).toExponential(2) + ' rad' +
              '（若 turning 恰好在 0 附近，这就是 0）');
}

console.log('\\n--- 20 个 240 帧窗口：净位移 vs 累计行程 ---');
let notTurned = 0, windows = 0, worst = [];
const tvAll = [], netAll = [];
for (let w = 0; w < 20; w++) {
  const before = slimes.map(a => ({
    heading: a.heading, turning: a.turning, timer: a.timer,
    pd: Math.hypot(player.x - a.x, player.z - a.z),
  }));
  const travel = new Array(slimes.length).fill(0);
  const prev = slimes.map(a => a.heading);
  for (let i = 0; i < 240; i++) {
    loop(0.016);
    slimes.forEach((a, k) => {
      const d = Math.abs(a.heading - prev[k]);
      travel[k] += d;
      prev[k] = a.heading;
    });
  }
  windows++;
  const bad = [];
  slimes.forEach((a, i) => {
    const net = Math.abs(a.heading - before[i].heading);
    const tv = travel[i];
    netAll.push(net); tvAll.push(tv);
    if (net > 1e-4) return;
    notTurned++;
    const pdEnd = Math.hypot(player.x - a.x, player.z - a.z);
    bad.push({
      i, key: a.species.key,
      dHeading: net, travel: tv, turning: before[i].turning, timer: before[i].timer,
      pdStart: before[i].pd, pdEnd,
      fleeStart: before[i].pd < 9.5, fleeEnd: pdEnd < 9.5,
    });
  });
  if (bad.length) {
    worst.push({ w, bad });
    for (const b of bad) {
      console.log('  窗口 ' + w + ' 净位移过小：' + b.key + '#' + b.i +
        '｜Δ净 ' + b.dHeading.toExponential(2) +
        '｜累计行程 ' + b.travel.toExponential(2) +
        '｜turning ' + b.turning.toFixed(5) +
        '｜timer ' + b.timer.toFixed(2) +
        '｜离玩家 ' + b.pdStart.toFixed(1) + ' → ' + b.pdEnd.toFixed(1) +
        '（flee ' + b.fleeStart + ' → ' + b.fleeEnd + '）');
    }
  }
}
const stats = arr => {
  const s = arr.slice().sort((a, b) => a - b);
  return { min: s[0], p05: s[Math.floor(s.length * 0.05)], med: s[s.length >> 1], max: s[s.length - 1] };
};
const stN = stats(netAll), stT = stats(tvAll);
const e = x => x.toExponential(2);
console.log('  净位移   ：min ' + e(stN.min) + '｜p05 ' + e(stN.p05) + '｜中位 ' + e(stN.med) + '｜max ' + e(stN.max));
console.log('  累计行程 ：min ' + e(stT.min) + '｜p05 ' + e(stT.p05) + '｜中位 ' + e(stT.med) + '｜max ' + e(stT.max));
console.log('\\n结论数据：' + windows + ' 窗口 × ' + slimes.length + ' 只 = ' +
            (windows * slimes.length) + ' 次抽样，「净位移 < 1e-4」' + notTurned + ' 次（' +
            (100 * notTurned / (windows * slimes.length)).toFixed(2) + '%）');

/* 再标定一次「朝向会响应输入」这条**真契约**：给一只史莱姆一个明确的转向量，
   看 240 帧后它是否跟着走。这条不依赖随机取样，永远应当为真。 */
{
  const a = slimes[0];
  const h0 = a.heading;
  a.turning = 0.45;                    // 固定的转向输入（正的最大值）
  a.timer = 1e9;                       // 别让 timer 到点后重新随机掉
  const pd = Math.hypot(player.x - a.x, player.z - a.z);
  let d = 0;
  for (let i = 0; i < 240; i++) { loop(0.016); }
  d = Math.abs(a.heading - h0);
  console.log('\\n--- 固定转向输入 turning=0.45、timer 冻住、离玩家 ' + pd.toFixed(1) + ' m ---');
  console.log('  240 帧朝向变化 = ' + d.toExponential(3) + ' rad');
}
${DRIVER_FOOTER}
`;

await runGame(DRIVER);
