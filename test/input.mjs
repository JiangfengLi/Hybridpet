/**
 * 输入与 UI 接线测试。
 *
 * 为什么单独一份：integration.mjs 是**直接改 keys 对象**来驱动机器人的，
 * 所以 keydown/keyup 监听器、指针锁失败降级、拖拽视角、ESC 暂停、resize/visibility
 * 这些"用户真正碰到的代码"从来没被执行过。这里专门测接线本身。
 *
 * 用法： node test/input.mjs
 */
import { runGame, DRIVER_HEAD, DRIVER_FOOTER } from './harness.mjs';

const DRIVER = `
${DRIVER_HEAD}

/* ============================================================
   1. 开场按钮 → 进入世界
   ============================================================ */
sec('1. 点「开始探索」');
ok(el('intro').classList.contains('hide') === false, '初始：开场层可见');
ok(el('hud').classList.contains('on') === false, '初始：HUD 隐藏');
const nBtn = fire('startBtn', 'click');
ok(nBtn === 1, '开始按钮挂了 1 个 click 监听器（实际 ' + nBtn + '）');
ok(el('intro').classList.contains('hide') === true, '开场层已隐藏');
ok(el('hud').classList.contains('on') === true, 'HUD 已显示');
ok(started === true, 'started = true');
ok(paused === false, 'paused = false');
ok(globalThis.__lockCalls >= 1, '已请求指针锁（调用 ' + globalThis.__lockCalls + ' 次）');

/* ============================================================
   2. 指针锁被拒 → 自动降级为拖拽视角（不许卡死）
   注意：失败是 Promise 拒绝，是异步的，必须等一轮宏任务
   ============================================================ */
sec('2. 指针锁被拒时的降级');
const seenHint = { warns: 0 };
const origWarn = console.warn;
await tick();
ok(dragLook === true, '已切换为拖拽兜底模式（dragLook=' + dragLook + '）');
ok(el('hint').classList.contains('on') === true, '显示了提示条');
ok(paused === false, '仍然可以行动（没有卡在暂停态）');
ok((el('hint').textContent || '').includes('拖动'), '提示文案提到了拖动：' + JSON.stringify(el('hint').textContent));
ok(globalThis.__lockCalls >= 2, '失败后重试过一次（共请求 ' + globalThis.__lockCalls + ' 次）');

/* ============================================================
   3. 键盘：W 前进 / 松手停下
   ============================================================ */
sec('3. 键盘移动（走真实 keydown 监听器）');
const x0 = player.x, z0 = player.z;
const nKey = fireKey('keydown', 'KeyW');
ok(nKey >= 1, 'keydown 挂了监听器（' + nKey + '）');
ok(keys['KeyW'] === true, 'keydown 把 keys.KeyW 置为 true');
for (let i = 0; i < 120; i++) loop();
const dW = Math.hypot(player.x - x0, player.z - z0);
console.log('  前进 2 秒位移 = ' + dW.toFixed(2) + ' m');
ok(dW > 5, '确实前进了（' + dW.toFixed(2) + ' m）');
releaseKey('KeyW');
ok(keys['KeyW'] === false, 'keyup 清掉 keys.KeyW');
const x1 = player.x, z1 = player.z;
for (let i = 0; i < 90; i++) loop();
const dStop = Math.hypot(player.x - x1, player.z - z1);
ok(dStop < 1.2, '松手后停下（惯性滑行 ' + dStop.toFixed(2) + ' m）');
ok(Math.abs(player.y - sampleHeight(player.x, player.z)) < 0.05, '全程贴地');

/* ============================================================
   4. 键盘：Shift 冲刺 / Space 跳跃
   ============================================================ */
sec('4. 冲刺与跳跃');
// Keep the speed comparison away from the capsule obstacle at (0, 23).
player.x = -30; player.z = 0;
player.vx = player.vz = 0;
const sx0 = player.x, sz0 = player.z;
holdFrames('KeyW', 60);
const dWalk = Math.hypot(player.x - sx0, player.z - sz0);
player.vx = player.vz = 0;
const sx1 = player.x, sz1 = player.z;
pressKey('ShiftLeft'); holdFrames('KeyW', 60); releaseKey('ShiftLeft');
const dRun = Math.hypot(player.x - sx1, player.z - sz1);
console.log('  1 秒 走=' + dWalk.toFixed(2) + ' m  跑=' + dRun.toFixed(2) + ' m');
ok(dRun > dWalk * 1.25, 'Shift 确实加速（' + (dRun / dWalk).toFixed(2) + '×）');

pressKey('Space');
const airborne = [];
for (let i = 0; i < 40; i++) { loop(); airborne.push(player.y - sampleHeight(player.x, player.z)); }
releaseKey('Space');
const peak = Math.max(...airborne);
console.log('  跳跃峰值离地 = ' + peak.toFixed(2) + ' m');
ok(peak > 0.6, 'Space 能跳起来（峰值 ' + peak.toFixed(2) + ' m）');
for (let i = 0; i < 200; i++) loop();
ok(Math.abs(player.y - sampleHeight(player.x, player.z)) < 0.05, '最终落回地面');

/* ============================================================
   5. 键盘：E 已解绑 / M 静音
   ------------------------------------------------------------
   原来这一节测的是"按 E 观测物种 → 进图鉴"。
   信号源 + 物种图鉴 2026-09-23 整套删除后，E 变成一个**无绑定**键
   ⇒ 这一节的方向翻过来：**按 E 必须什么都不发生**。
   守着它是有意义的：将来若给 E 配上新用途，这里会立刻红，提醒同时更新
   开场简报的按键表与 HUD 右下角的按键提示（那两处最容易漏）。
   ============================================================ */
sec('5. E 已解绑 / M 静音');
ok(typeof tryScan === 'undefined', 'tryScan() 已删（E 原来的处理器）');
{
  /* 挑一只随便的陆生动物站到它旁边，按住 E 半秒 —— 它不该被记进任何账。 */
  const tgt = animals.find(a => a.species.key === 'grazer') || animals[0];
  player.x = tgt.x + 1.5; player.z = tgt.z + 1.5;
  const before = { kids: scene.children.length, mag: mag.length, corpses: corpses.length };
  holdFrames('KeyE', 30);
  ok(scene.children.length === before.kids && mag.length === before.mag && corpses.length === before.corpses,
     '站在动物旁边按住 E 半秒，场景 / 弹夹 / 尸体数都没有变化');
}
let mErr = null;
try { pressKey('KeyM'); } catch (e) { mErr = e; }
ok(!mErr, 'AudioContext 不可用时按 M 不报错' + (mErr ? '：' + mErr.message : ''));

/* ============================================================
   6. 拖拽视角（兜底模式下唯一能转镜头的方式）
   ============================================================ */
sec('6. 拖拽视角');
const yaw0 = player.yaw;
fire('app', 'mousedown');
const nMm = fireDoc('mousemove', { movementX: 100, movementY: 0 });
ok(nMm >= 1, 'document 挂了 mousemove 监听器（' + nMm + '）');
ok(Math.abs(player.yaw - yaw0) > 0.1, '按住左键拖动会转视角（Δyaw=' + (player.yaw - yaw0).toFixed(3) + '）');
fire('window', 'mouseup');
const yaw1 = player.yaw;
fireDoc('mousemove', { movementX: 100, movementY: 0 });
ok(Math.abs(player.yaw - yaw1) < 1e-9, '松开后鼠标移动不再转视角');
const pitchBefore = player.pitch;
fireDoc('mousemove', { movementX: 0, movementY: -10000 });
ok(player.pitch <= 1.4501, '俯仰被夹住（不会翻过头）：' + player.pitch.toFixed(3));
player.pitch = pitchBefore;

/* ============================================================
   7. Escape / visibilitychange / resize
   ============================================================ */
sec('7. 暂停与窗口事件');
pressKey('Escape');
ok(paused === true, '拖拽模式 Escape 暂停');
const nVis = fireDoc('visibilitychange', {});
document.hidden = true;
fireDoc('visibilitychange', {});
ok(paused === true, '切到后台自动暂停');
ok(el('dim').classList.contains('on') === true, '显示「已暂停」遮罩');
document.hidden = false;
pressKey('Escape');
ok(paused === false, '回来后可以恢复');

const asp0 = camera.aspect;
globalThis.innerWidth = 800; globalThis.innerHeight = 1000;
fire('window', 'resize');
ok(Math.abs(camera.aspect - 0.8) < 0.001, 'resize 后相机宽高比更新（' + camera.aspect.toFixed(2) + '）');
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
fire('window', 'resize');
ok(Math.abs(camera.aspect - asp0) < 0.001, '恢复窗口后宽高比还原');

/* ============================================================
   8. 指针锁成功时的行为
   ============================================================ */
sec('8. 指针锁成功路径');
globalThis.__lockMode = 'ok';
document.pointerLockElement = el('app');       // 模拟浏览器真的把锁给了 canvas
fireDoc('pointerlockchange', {});
ok(locked === true, 'locked = true');
ok(paused === false, '拿到锁后处于可行动状态');
document.pointerLockElement = null;
fireDoc('pointerlockchange', {});
ok(locked === false && paused === true, '按 Esc 退出指针锁 → 暂停');

/* ============================================================
   9. 边界：正方形空气墙
   ============================================================ */
sec('9. 世界边界（正方形空气墙）');
paused = false;                                 // 上一节结束时是暂停态，先恢复（暂停时不推进是正确的）
/* 判据从"离原点半径"改成"max(|x|,|z|)" —— 场地是正方形，不是圆盘。
   注意 sqrt2 那个坑：方形角上的点离原点 141 m，用半径判据会误判成越界。 */
const outAt = (v) => Math.max(Math.abs(v.x), Math.abs(v.z));
player.x = ARENA * 3; player.z = ARENA * 3; player.vx = 0; player.vz = 0;
loop();
const rNow = outAt(player);
console.log('  从 (' + (ARENA * 3) + ', ' + (ARENA * 3) + ') 放置，一帧后被夹到 (' +
            player.x.toFixed(1) + ', ' + player.z.toFixed(1) + ')（半边长 ' + ARENA + '）');
ok(rNow <= ARENA + 0.5, '越界会被夹回方形场地内');
ok(Number.isFinite(player.x) && Number.isFinite(player.y) && Number.isFinite(player.z), '坐标仍然有限');

/* 贴北墙猛冲：应该停住，而且不能穿过。
   朝向对照（见主循环 tx/tz 公式）：yaw = 0 时前方向是 -z，yaw = π 时是 +z。 */
player.x = 0; player.z = 0; player.y = sampleHeight(0, 0); player.yaw = 0;   // 朝 -z
pressKey('KeyW'); pressKey('ShiftLeft');
for (let i = 0; i < 3000; i++) loop();
releaseKey('KeyW'); releaseKey('ShiftLeft');
const rCharge = outAt(player);
console.log('  朝北墙冲刺 50 秒后到达 (x ' + player.x.toFixed(1) + ', z ' + player.z.toFixed(1) + ')');
ok(rCharge <= ARENA + 0.5, '持续冲刺也冲不出空气墙（' + rCharge.toFixed(1) + ' m）');
ok(Math.abs(player.z + ARENA) < 0.6, '恰好停在墙上而不是被弹回（z = ' + player.z.toFixed(2) + '）');

/* 沿墙滑行：贴墙时按 W（顶墙）+ D（沿墙），应该能沿墙走，而不是被整体刹住 */
player.x = 0; player.z = -ARENA; player.vx = 0; player.vz = 0; player.yaw = 0;
pressKey('KeyW'); pressKey('KeyD');
for (let i = 0; i < 120; i++) loop();
releaseKey('KeyW'); releaseKey('KeyD');
console.log('  贴墙滑行 2 秒后 x 位移 ' + player.x.toFixed(1) + ' m');
ok(Math.abs(player.x) > 5, '贴墙时仍能沿墙滑行（x 位移 ' + player.x.toFixed(1) + ' m）');
ok(Math.abs(player.y - sampleHeight(player.x, player.z)) < 0.05, '贴地状态没被边界逻辑破坏');


sec('10. 采集器：吸 / 吐（致敬参考图的吸尘器）');
const landAll = animals.filter(a => a.g.userData.kind === 'land');
const vacT = landAll.find(a => !a.captured && !a.launch);
ok(!!vacT, '有可吸的陆生动物');
const base0 = vacT.baseScale;
player.x = vacT.x + 2.5; player.z = vacT.z + 2.5;
player.yaw = Math.atan2(-(vacT.x - player.x), -(vacT.z - player.z));
const mag0 = mag.length;
pressKey('KeyF');
let ve = null;
try { for (let i = 0; i < 150; i++) loop(); } catch (e) { ve = e; }
releaseKey('KeyF');
ok(!ve, '吸尘过程无异常' + (ve ? '：' + ve.message : ''));
/* 只能断言"至少 +1"：吸引是 9 m 半径的锥形判定，按住 F 期间范围内**别的**动物
   也会被顺带吸进来，而动物游走用的是 Math.random（非种子化）—— 断言恰好 +1 会间歇性失败。 */
console.log('  按住 F 2.5 秒后弹夹 ' + mag0 + ' → ' + mag.length);
ok(mag.length > mag0, '按住 F 能吸进弹夹（' + mag0 + ' → ' + mag.length + '）');
ok(vacT.captured === true, '目标标记为 captured');
ok(vacT.g.visible === false, '目标从世界隐藏');
ok(vacT.g.scale.x < base0 * 1.01, '缩放已复位（' + vacT.g.scale.x.toFixed(2) + '）');

/* 先把顺手吸进来的其它动物放掉，后面的断言只关心我们指定的这一只 */
while (mag.length > mag0 + 1) { pressKey('KeyG'); for (let i = 0; i < 10; i++) loop(); }
releaseKey('KeyG');
ok(mag.length === mag0 + 1, '清掉顺带吸入的其它动物后，槽里只剩目标（' + mag.length + '）');

const mag1 = mag.length;
pressKey('KeyG');
ok(mag.length === mag1 - 1, '按 G 吐出（' + mag1 + ' → ' + mag.length + '）');
ok(vacT.captured === false, '目标已放回世界');
ok(vacT.g.visible === true, '目标重新可见');
for (let i = 0; i < 150; i++) loop();
ok(vacT.g.visible === true, '吐出后仍在世界里');
ok(Number.isFinite(vacT.x) && Number.isFinite(vacT.y), '放回后坐标有限');

/* 塞满弹夹 */
let guard = 0;
while (mag.length < MAG_MAX && guard++ < 40) {
  const a = landAll.find(x => !x.captured && !x.launch && x.suckT === undefined || x.suckT === 0);
  if (!a) break;
  a.x = player.x + 2; a.z = player.z + 2;
  player.yaw = Math.atan2(-(a.x - player.x), -(a.z - player.z));
  a.suckT = 0.001;
  for (let i = 0; i < 80; i++) loop();
}
console.log('  弹夹 = ' + mag.length + ' / ' + MAG_MAX);
ok(mag.length === MAG_MAX, '弹夹能装满 ' + MAG_MAX + ' 只（实际 ' + mag.length + '）');
const before = mag.length;
pressKey('KeyF');
for (let i = 0; i < 120; i++) loop();
releaseKey('KeyF');
ok(mag.length === before, '装满后不再吸入（' + before + '）');
let spitErr = null;
try { while (mag.length) { pressKey('KeyG'); for (let i = 0; i < 10; i++) loop(); } } catch (e) { spitErr = e; }
ok(!spitErr, '连续吐出无异常' + (spitErr ? '：' + spitErr.message : ''));
ok(mag.length === 0, '全部吐出后弹夹清空');
ok(animals.every(a => a.g.visible === true), '所有动物都回到了世界里');

/* ============================================================
   11. 双击空格：飞行模式开关
   —— 上一节到这里可能只隔了几毫秒，必须先把这个 300ms 判定窗口耗掉，
      否则本节的第一次空格会被当成「双击的第二下」，测出来的东西全是假的。
   ============================================================ */
const gap = ms => new Promise(r => setTimeout(r, ms || 500));
sec('11. 双击空格的飞行开关');
await gap(500);
resume();                       // 第 8 节留下的暂停遮罩要清掉，否则后面查 dim 全是假的
player.flying = false;
state.stamina = 100;
player.vx = player.vz = player.vy = 0;
player.y = sampleHeight(player.x, player.z);
player.onGround = true;

pressKey('Space'); releaseKey('Space');
ok(player.flying === false, '单击空格只跳、不切飞行模式');
for (let i = 0; i < 150; i++) loop();
await gap(500);

pressKey('Space'); releaseKey('Space');
pressKey('Space'); releaseKey('Space');
ok(player.flying === true, '快速连按两次空格 → 进入飞行模式');
loop();                                    // flytag 是在 updateHUD 里刷的，得先跑一帧
ok(el('flytag').classList.contains('on') === true, 'HUD 出现「飞行模式」指示');

const flyY0 = player.y;
pressKey('Space');
for (let i = 0; i < 60; i++) loop();
releaseKey('Space');
console.log('  飞行中按住空格 1 秒上升 ' + (player.y - flyY0).toFixed(1) + ' m');
ok(player.y - flyY0 > 3, '按住空格会上升（' + (player.y - flyY0).toFixed(1) + ' m）');

/* 关键回归：长按会持续产生 repeat 的 keydown，必须判成"同一次按住"而不是双击
   （少了这个判定，飞行时按空格上升 30ms 后就会被自己判成双击而掉下来） */
fireKey('keydown', 'Space', { repeat: true });
fireKey('keydown', 'Space', { repeat: true });
fireKey('keydown', 'Space', { repeat: true });
ok(player.flying === true, 'repeat 的 keydown 不会被误判成双击');
releaseKey('Space');           // 浏览器松手时会补一个 keyup，测试里也要补上

/* 飞行时 Shift 是下降，不该算冲刺 */
const shiftY0 = player.y;
pressKey('ShiftLeft');
for (let i = 0; i < 40; i++) loop();
releaseKey('ShiftLeft');
ok(player.y < shiftY0 - 1, '按住 Shift 下降（' + shiftY0.toFixed(1) + ' → ' + player.y.toFixed(1) + ' m）');

await gap(500);
pressKey('Space'); releaseKey('Space');
pressKey('Space'); releaseKey('Space');
ok(player.flying === false, '再次快速连按两次空格 → 取消飞行');
loop();                                    // 同样要跑一帧才会刷新 flytag
ok(el('flytag').classList.contains('on') === false, 'HUD 飞行指示已熄灭');
for (let i = 0; i < 300; i++) loop();
ok(Math.abs(player.y - sampleHeight(player.x, player.z)) < 0.05, '取消飞行后落回地面');

/* ============================================================
   12. 体力：消耗 / 回气（走 < 站定）/ 20% 启动门槛 / 见底强制降落
   ============================================================ */
sec('12. 体力');
const resetPose = () => {
  player.x = 0; player.z = 0; player.y = sampleHeight(0, 0);
  player.vx = player.vz = player.vy = 0;
  player.onGround = true; player.flying = false; state.sprinting = false;
};

/* --- 冲刺消耗 --- */
resetPose();
state.stamina = 100;
pressKey('ShiftLeft'); pressKey('KeyW');
for (let i = 0; i < 60; i++) loop();
releaseKey('ShiftLeft'); releaseKey('KeyW');
const afterSprint = state.stamina;
console.log('  冲刺 1 秒后体力 = ' + afterSprint.toFixed(1));
ok(afterSprint < 95, '冲刺消耗体力（100 → ' + afterSprint.toFixed(1) + '）');

/* --- 回气：站定 vs 走路 --- */
resetPose();
state.stamina = 40;
for (let i = 0; i < 60; i++) loop();            // 站定 1 秒
const idleGain = state.stamina - 40;

resetPose();
state.stamina = 40;
pressKey('KeyW');
for (let i = 0; i < 60; i++) loop();            // 走 1 秒（注意不能按 Shift，那是冲刺会倒扣）
releaseKey('KeyW');
const walkGain = state.stamina - 40;

console.log('  1 秒回气：站定 +' + idleGain.toFixed(1) + ' / 走路 +' + walkGain.toFixed(1));
ok(idleGain > 0, '站定会回气（+' + idleGain.toFixed(1) + '）');
ok(walkGain > 0, '走路也会回气（+' + walkGain.toFixed(1) + '）');
ok(idleGain > walkGain + 1, '站定回得比走路快（' + idleGain.toFixed(1) + ' > ' + walkGain.toFixed(1) + '）');

/* --- 20% 门槛：不能「起头」，但可以「继续」--- */
resetPose();
state.stamina = STAM_GATE - 5;                  // 15%
pressKey('KeyW'); pressKey('ShiftLeft');
for (let i = 0; i < 30; i++) loop();
const lowSpeed = Math.hypot(player.vx, player.vz);
ok(state.sprinting === false, '体力 ' + (STAM_GATE - 5) + '% 时按住 Shift 也起不了头（sprinting 仍为 false）');
ok(Math.abs(lowSpeed - WALK_V) < 0.8, '此时速度是走速而非冲刺速度（' + lowSpeed.toFixed(1) + ' vs WALK_V ' + WALK_V + '）');

/* 同一组按键继续按着：先把体力"人为"降到 15%，已经在冲的应该继续冲 */
state.stamina = 100;
state.sprinting = false;
for (let i = 0; i < 30; i++) loop();            // 充满状态下起头
const sprintArmed = state.sprinting;
state.stamina = 15;                             // 手动压低，模拟"冲过头了"
for (let i = 0; i < 10; i++) loop();
const contSpeed = Math.hypot(player.vx, player.vz);
ok(sprintArmed === true, '体力充沛时可以起头冲刺');
ok(state.sprinting === true, '已经在冲刺 → 体力掉到 15% 仍可继续（不是硬砍）');
ok(Math.abs(contSpeed - RUN_V) < 0.8, '继续时仍是冲刺速度（' + contSpeed.toFixed(1) + ' vs RUN_V ' + RUN_V + '）');

/* 见底必须停 —— 否则 0 体力能无限冲刺 */
state.stamina = 0.3;
for (let i = 0; i < 12; i++) loop();
ok(state.sprinting === false, '体力见底后冲刺自动断掉（sprinting = false）');
releaseKey('ShiftLeft'); releaseKey('KeyW');

/* --- 见底不再减速：走速应与充沛时一致（旧的 0.55× 惩罚已撤） --- */
const walkOneSec = () => {
  resetPose();
  const x0 = player.x, z0 = player.z;
  pressKey('KeyW');
  for (let i = 0; i < 60; i++) loop();
  releaseKey('KeyW');
  return Math.hypot(player.x - x0, player.z - z0);
};
state.stamina = 0;    const dEmpty = walkOneSec();
state.stamina = 100;  const dFull  = walkOneSec();
console.log('  1 秒走位：见底 ' + dEmpty.toFixed(1) + ' m / 充沛 ' + dFull.toFixed(1) + ' m');
ok(Math.abs(dFull - dEmpty) < 0.5, '见底不再被减速（旧版的 0.55× 力竭惩罚已撤）');

/* --- 飞行门槛 --- */
await gap(500);
resetPose();
state.stamina = STAM_GATE - 1;                  // 19%
pressKey('Space'); releaseKey('Space');
pressKey('Space'); releaseKey('Space');
ok(player.flying === false, '体力 ' + (STAM_GATE - 1) + '% 时双击空格起飞不了');

await gap(500);
state.stamina = 100;
pressKey('Space'); releaseKey('Space');
pressKey('Space'); releaseKey('Space');
ok(player.flying === true, '体力 ' + STAM_GATE + '% 以上可以起飞');

/* 已在飞行的可以继续：把体力压到 15% 也不该掉下来 */
state.stamina = 15;
player.y = sampleHeight(player.x, player.z) + 20; player.vy = 0;
for (let i = 0; i < 30; i++) loop();
ok(player.flying === true, '已在飞行中 → 体力 15% 仍可继续飞');

/* --- 见底 → 强制降落 --- */
state.stamina = 0.4;
let drainErr = null, drainFrames = 0;
/* 关键：循环到"飞行刚被取消"就停 —— 不能固定跑 60 帧再来断言体力。
   落回地面后是站定态，会按 STAM_REGEN_IDLE 回气，多跑一秒就回上来 8 点，
   那样这条断言测的就变成"回气速度"而不是"是否被压到 0"了。 */
try { while (player.flying && drainFrames++ < 60) loop(); } catch (e) { drainErr = e; }
ok(!drainErr, '飞行中体力见底无异常' + (drainErr ? '：' + drainErr.message : ''));
console.log('  强制降落瞬间体力 = ' + state.stamina.toFixed(2) + '（' + drainFrames + ' 帧）');
ok(state.stamina < 1, '体力确实被压到 0 附近（' + state.stamina.toFixed(2) + '）');
ok(player.flying === false, '体力见底 → 强制取消飞行模式');
for (let i = 0; i < 300; i++) loop();
ok(Math.abs(player.y - sampleHeight(player.x, player.z)) < 0.05, '强制降落后落回地面');

/* --- 全场暂停：时钟与动物一起停 ---
   动物要**全场合计**着量，不能只挑一只当探针：
   前面几节吸走过几只（captured 的在 updateAnimals 里被 continue 掉），
   随机挑到的那只很可能整段时间一动不动，断言就会假失败。 */
await gap(500);
resetPose();
paused = false; state.stamina = 50;
const snapAnimals = () => animals.map(a => ({ x: a.x, z: a.z }));
const sumMoved = (prev) => animals.reduce((s, a, i) =>
  s + Math.hypot(a.x - prev[i].x, a.z - prev[i].z), 0);

const snap0 = snapAnimals();
const tAccBefore = tAcc;
for (let i = 0; i < 120; i++) loop();
const movedRunning = sumMoved(snap0);
const tAccRan = tAcc - tAccBefore;

paused = true;
const snap1 = snapAnimals();
const tAccPaused = tAcc;
const stamPaused = state.stamina;
for (let i = 0; i < 120; i++) loop();
const movedPaused = sumMoved(snap1);
console.log('  运行 2 秒：33 只动物总位移 ' + movedRunning.toFixed(1) + ' m，世界时钟 +' + tAccRan.toFixed(2) + ' s');
console.log('  暂停 2 秒：33 只动物总位移 ' + movedPaused.toFixed(3) + ' m，世界时钟 +' + (tAcc - tAccPaused).toFixed(3) + ' s');
ok(movedRunning > 1, '运行时动物确实在动（总位移 ' + movedRunning.toFixed(1) + ' m）');
ok(movedPaused === 0, '暂停时动物一步都不动（' + movedPaused.toFixed(3) + ' m）');
ok(tAcc === tAccPaused, '暂停时世界时钟冻结（+' + (tAcc - tAccPaused).toFixed(3) + ' s）');
ok(state.stamina === stamPaused, '暂停时体力也冻住');

paused = false;

/* ============================================================
   13. 背包：B 开关、分页、与暂停/指针锁互不打架
   ============================================================ */
sec('13. 背包');
state.stamina = 100;
ok(bag.open === false, '初始背包是关的');
const nB = fireKey('keydown', 'KeyB');
ok(nB >= 1, 'B 键挂了监听器（' + nB + '）');
releaseKey('KeyB');
ok(bag.open === true, '按 B 打开背包');
ok(el('bag').classList.contains('on') === true, '背包面板已显示');
ok(el('bagPage0').classList.contains('on') === true, '默认停在帕鲁页');
ok(paused === false, '打开背包不该顺带把游戏判成暂停（否则会盖上「已暂停」遮罩）');
ok(el('dim').classList.contains('on') === false, '没有出现暂停遮罩');

/* 打开期间模拟必须冻结 */
player.vx = player.vz = 0;
const bx = player.x, bz = player.z;
pressKey('KeyW');
for (let i = 0; i < 60; i++) loop();
releaseKey('KeyW');
console.log('  背包打开时按 W 1 秒位移 = ' + Math.hypot(player.x - bx, player.z - bz).toFixed(3) + ' m');
ok(Math.hypot(player.x - bx, player.z - bz) < 0.01, '背包打开时模拟被冻结');

/* Removed page shortcuts must not reopen the old breeding UI. */
pressKey('Digit2'); releaseKey('Digit2');
ok(bag.page === 0, '按 2 仍停在库存');
ok(el('bagPage0').classList.contains('on'), '库存持续显示');
pressKey('ArrowLeft'); releaseKey('ArrowLeft');
ok(bag.page === 0, '方向键不切换背包页');
pressKey('Digit1'); releaseKey('Digit1');
ok(bag.page === 0, '按 1 也停在帕鲁页');

/* No listeners remain on the removed tab. */
const nClick = fire('bagTab1', 'click');
ok(nClick === 0 && bag.page === 0, '旧繁衍页签没有事件入口');

/* Esc closes the bag and opens the common pause/audio menu. */
pressKey('Escape'); releaseKey('Escape');
ok(bag.open === false, 'Esc 关闭背包');
ok(el('bag').classList.contains('on') === false, '面板已隐藏');
ok(paused === true&&!el('dim').hidden, 'Esc 从背包进入音量暂停菜单');
ok(el('dim').classList.contains('on') === true, '暂停菜单已显示');
fire('pause-resume','click');
ok(paused===false&&el('dim').hidden, '继续游戏关闭暂停菜单');

/* 弹夹装满 10 只时的显示 + 弹夹⇄背包的拖放接线 */
sec('13b. 弹夹⇄背包的拖放接线（从 #bagCard 上的委托监听器走）');
const landPick = animals.filter(a => a.g.userData.kind === 'land' && !a.captured);
let guard2 = 0;
while (mag.length < MAG_MAX && guard2++ < 60) {
  const a = landPick.find(x => !x.captured && !x.launch && (x.suckT === undefined || x.suckT === 0));
  if (!a) break;
  a.x = player.x + 2; a.z = player.z + 2;
  player.yaw = Math.atan2(-(a.x - player.x), -(a.z - player.z));
  a.suckT = 0.001;
  for (let i = 0; i < 80; i++) loop();
}
pressKey('KeyB'); releaseKey('KeyB');
ok(bag.open === true, '再次按 B 打开背包');
ok(el('bagPage0').innerHTML.includes(MAG_MAX + ' / ' + MAG_MAX),
   '帕鲁页显示弹夹 ' + mag.length + ' / ' + MAG_MAX);
ok(el('bagPage0').innerHTML.includes('0 / ' + BAG_MAX), '帕鲁页显示背包 0 / ' + BAG_MAX);
ok(el('bagPage0').innerHTML.includes('data-pal-src="mag"'), '弹夹格子带可拖属性 data-pal-src="mag"');
ok(el('bagPage0').innerHTML.includes('data-zone="bag"'), '背包区带投放标记 data-zone="bag"');
ok(el('bagPage0').innerHTML.includes('data-act="all"'), '有「全部转入背包」按钮');
/* ⚠️ draggable="true" 是**浏览器肯起拖的前提** —— 少了它，上面那串合成事件照样全绿，
   但真浏览器里根本拖不动。这条断言是 2026-09-22 用真浏览器探针（_probe_dnd.mjs）
   交叉检查时发现"从来没人断言过"才补上的。 */
ok(el('bagPage0').innerHTML.includes('draggable="true"'), '格子带 draggable="true"（真浏览器肯起拖的前提）');
ok((el('bagPage0').innerHTML.match(/draggable="true"/g) || []).length === MAG_MAX,
   '每个弹夹格都有 draggable="true"（实测 ' +
   ((el('bagPage0').innerHTML.match(/draggable="true"/g) || []).length) + ' 个 / 空背包时共 ' + MAG_MAX + ' 格）');

/* ---------- 合成拖放事件 ----------
   格子都在 innerHTML 字符串里，无头环境没有真实 DOM 树，所以这里造一个
   **只回答 closest() 的假元素链**。这正是处理器被写成"只依赖 e.target.closest"
   的原因 —— 否则这段接线在无头环境里根本无法从真实入口触发。
   fakePal(src, idx, zone)：拖的格子 / 它落在哪个区。

   ⚠️ 委托监听器挂在**整张卡片** #bagCard 上（不是某一页）—— 因为屠宰块在
   卡片最下方、不在任何一页里，挂到页上的话它永远收不到 drop。
   所以下面 fire 的第一个参数是 'bagCard'。

   假元素的两处细节是硬要求：
     · zone 元素必须带 classList —— dragover 会把 .hot 加到它身上；
     · 格子元素和 zone 元素必须是**两个不同对象**，否则分不出"落在哪"。 */
const fakeZone = zone => ({
  dataset: { zone },
  classList: {
    _s: new Set(),
    add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, has(c) { return this._s.has(c); },
  },
});
const fakePal = (src, idx, zone) => {
  const z = (zone && zone.dataset) ? zone : fakeZone(zone);
  const n = {
    dataset: { palSrc: src, palIdx: String(idx) },
    classList: { add() {}, remove() {} },
    closest: sel => (sel === '[data-pal-src]' ? n : (sel === '[data-zone]' ? z : null)),
  };
  return n;
};
const nMag = mag.length, nBag = pals.length;
fire('bagCard', 'dragstart', { target: fakePal('mag', 0, 'mag') });
fire('bagCard', 'dragover', { target: fakePal('mag', 0, 'bag') });
fire('bagCard', 'drop', { target: fakePal('mag', 0, 'bag') });
ok(mag.length === nMag - 1 && pals.length === nBag + 1,
   '拖一格进背包区：弹夹 ' + nMag + '→' + mag.length + '，背包 ' + nBag + '→' + pals.length + '');
ok(el('bagPage0').innerHTML.includes('体型'), '重渲染后背包格里出现了帕鲁信息');

/* 拖拽高亮：**加在解析出来的那个 zone 元素上**。
   这条是回归哨兵 —— 早先 .hot 被加在 #bagPage0（页面容器）上，而 CSS 写的是
   "#bag [data-zone].hot"，页面容器没有 data-zone ⇒ **那个高亮其实一次都没显示过**，
   而当时的断言只查"类加上了没有"，所以一直绿着。这里改成查"加在了谁身上"。 */
{
  const zBag = fakeZone('bag'), zSlay = fakeZone('slay');
  fire('bagCard', 'dragover', { target: fakePal('mag', 0, zBag) });
  ok(zBag.classList.has('hot') === true, 'dragover 时高亮加在**区元素**上（不是页面容器）');
  fire('bagCard', 'dragover', { target: fakePal('bag', 0, zSlay) });
  ok(zSlay.classList.has('hot') === true && zBag.classList.has('hot') === false,
     '换到另一个区时高亮跟着搬（旧的那个已摘掉）');
  fire('bagCard', 'dragend', { target: fakePal('bag', 0, zSlay) });
  ok(zSlay.classList.has('hot') === false, 'dragend 后高亮清掉');
}

/* 丢回原区 = 什么都不做（这条最容易写反：不加判断会自己搬自己） */
{
  const m0 = mag.length, b0 = pals.length;
  fire('bagCard', 'dragstart', { target: fakePal('bag', 0, 'bag') });
  fire('bagCard', 'drop', { target: fakePal('bag', 0, 'bag') });
  ok(mag.length === m0 && pals.length === b0,
     '拖回自己那一区不发生搬运（弹夹 ' + m0 + ' / 背包 ' + b0 + '）');
}

/* 背包 → 弹夹：这次**只用 dataTransfer**（另一条协议路径，不带 dragPal） */
{
  const m0 = mag.length, b0 = pals.length;
  fire('bagCard', 'drop', {
    target: fakePal('mag', 0, 'mag'),
    dataTransfer: { getData: () => 'bag:0', setData() {}, effectAllowed: '' },
  });
  ok(mag.length === m0 + 1 && pals.length === b0 - 1,
     '只靠 dataTransfer 也能搬（弹夹 ' + m0 + '→' + mag.length + '，背包 ' + b0 + '→' + pals.length + '）');
}

/* 「全部转入背包」按钮 */
{
  const m0 = mag.length, b0 = pals.length;
  fire('bagPage0', 'click', { target: { closest: () => ({ dataset: { act: 'all' } }) } });
  ok(mag.length === 0 && pals.length === b0 + m0,
     '点「全部转入背包」：弹夹 ' + m0 + '→0，背包 ' + b0 + '→' + pals.length);
  ok(el('bagPage0').innerHTML.includes('0 / ' + MAG_MAX), '重渲染后弹夹显示 0 / ' + MAG_MAX);
}

/* 越界 / 空池：不能抛错 */
let dropErr = null;
try {
  fire('bagCard', 'drop', { target: fakePal('bag', 999, 'mag') });          // 索引越界
  fire('bagCard', 'drop', { target: fakePal('mag', 0, 'mag') });            // 弹夹已空
  fire('bagCard', 'drop', { target: { closest: () => null } });             // 没有 zone
  fire('bagCard', 'drop', { target: null });                               // 连 target 都没有
  fire('bagCard', 'click', { target: { closest: () => null } });            // 点空白处
} catch (e) { dropErr = e; }
ok(!dropErr, '拖放的边界情况都不抛错' + (dropErr ? '：' + dropErr.message : ''));

let rErr = null;
try { setBagPage(1); setBagPage(0); } catch (e) { rErr = e; }
ok(!rErr, '来回切页不报错' + (rErr ? '：' + rErr.message : ''));
pressKey('KeyB'); releaseKey('KeyB');
ok(bag.open === false, '再按 B 关闭');
/* 把这一节造出来的帕鲁放回世界，别污染后面的小节 */
while (pals.length) { const a = pals.shift(); a.captured = false; a.g.visible = true; a.g.scale.setScalar(a.baseScale); }
while (mag.length) { const a = mag.shift(); a.captured = false; a.g.visible = true; a.g.scale.setScalar(a.baseScale); }
ok(mag.length === 0 && pals.length === 0, '收尾：弹夹与背包都清空');

/* ============================================================
   14. 屠宰块：把**背包里**的帕鲁拖进去 → 地面出现尸体
   ------------------------------------------------------------
   这一节原来是"素材拾取"（矿/孢子/星岩已整个撤掉，见 index.html 8b 节）。
   换成的这节走的是**完整拖放链路**：合成 dragstart → dragover → drop，
   落在 data-zone="slay" 上 ⇒ 由 #bagCard 上的委托处理器认落点 ⇒ transferPal(dst='slay')。
   和集成测试 12c 的分工：12c 直接调 transferPal 验投射、爆炸和骨头遗体，
   这里只验"UI 到动作"的接线 —— 真按钮、真区、真事件名。
   ============================================================ */
sec('14. 屠宰块：从背包拖进去 → 尸体落地');

openBag();
setBagPage(0);

/* 先往背包里放两只：走真实入口（吸进弹夹 → 拖进背包），不手工塞数组 */
{
  let guard = 0;
  while (pals.length < 2 && guard++ < 40) {
    const a = animals.find(x => !x.captured && !x.launch && x.g.userData.kind === 'land');
    if (!a) break;
    if (captureAnimal(a) !== true) break;
    magToBag(0);
  }
}
ok(pals.length === 2, '背包里备好了 2 只（实际 ' + pals.length + '）');
renderBag();     // 上面是直接操作数据，页面要重渲染一次才反映出来（真实路径由拖放自己触发）

/* 卡片上的屠宰块：静态 HTML 里就带着 data-zone，而且**不在任何一页里** */
ok(el('bagPage0').innerHTML.includes('data-pal-src="bag"'), '背包格子带 data-pal-src="bag"（这是"拖谁"）');
ok(el('slayCount').textContent === '0', '页面上的屠宰计数起始为 0');

/* --- 弹夹里的拖去屠宰：必须被拒（需求原文是"从背包拖拽"） --- */
{
  const a0 = animals.length, c0 = corpses.length, n0 = pals.length;
  fire('bagCard', 'dragstart', { target: fakePal('mag', 0, 'mag') });
  fire('bagCard', 'drop', { target: fakePal('mag', 0, 'slay') });
  ok(corpses.length === c0 && animals.length === a0 && pals.length === n0,
     '落在屠宰块上的若是弹夹来的：一刀都不动（背包 ' + n0 + ' / 尸体 ' + c0 + '）');
}

/* --- 背包 → 屠宰块：真事件链 --- */
const victim = pals[0];
{
  const n0 = pals.length, a0 = animals.length, c0 = corpses.length;
  fire('bagCard', 'dragstart', { target: fakePal('bag', 0, 'bag') });
  fire('bagCard', 'dragover', { target: fakePal('bag', 0, 'slay') });
  fire('bagCard', 'drop', { target: fakePal('bag', 0, 'slay') });
  ok(pals.length === n0 - 1, '背包里少了一只（' + n0 + ' → ' + pals.length + '）');
  ok(animals.length === a0 - 1, '世界里的动物也少了一只（' + a0 + ' → ' + animals.length + '）');
  ok(corpses.length === c0 + 1 && corpses[corpses.length - 1] === victim,
     '尸体进的是 corpses，而且就是拖的那一只');
  ok(el('slayCount').textContent === '1',
     '屠宰块的计数跟着涨到 1（页面上 ' + el('slayCount').textContent + '）');
  ok(bag.open === false && !bagEl.classList.contains('on'), '屠宰成功立即关闭背包 UI');
  ok(victim.g.visible === true && victim.launch?.t === 0, '选中的生物沿现有投射轨迹发射');
  ok(victim.slaughterPhase === 'launch' && !isSolid(victim), '投射阶段不参与碰撞');
  for (let i=0;i<100;i++) updateSlaughter(.016);
  ok(Math.abs(Math.hypot(victim.x - player.x, victim.z - player.z) - CORPSE_DIST) < .2,
     '尸体落在玩家正前方 ' + CORPSE_DIST + ' m（实测 ' +
     Math.hypot(victim.x - player.x, victim.z - player.z).toFixed(2) + '）');
  ok(victim.g.name === 'cartoon-bone-remains' && victim.slaughterPhase === 'bones',
     '爆炸后留下 Q 版骨头遗体');
  ok(isSolid(victim)&&bonePhysics.status(victim)?.mass>0, '遗体具有动态碰撞体');
}

/* --- 空背包上落 drop：不抛错、不产生尸体 --- */
{
  openBag();
  magToBag(0);                                   // 把最后一只也搬进背包
  while (pals.length) {                          // 从背包里拿出来放回世界（不屠宰）
    const a = pals.pop();
    a.captured = false; a.g.visible = true; a.g.scale.setScalar(a.baseScale);
  }
  const c0 = corpses.length;
  let e2 = null;
  try {
    fire('bagCard', 'dragstart', { target: fakePal('bag', 0, 'bag') });
    fire('bagCard', 'drop', { target: fakePal('bag', 0, 'slay') });   // 越界索引 → 只该提示
  } catch (e) { e2 = e; }
  ok(!e2, '背包空时拖到屠宰块不抛错' + (e2 ? '：' + e2.message : ''));
  ok(corpses.length === c0, '也没有凭空多出尸体（' + corpses.length + ' 具）');

  let e3 = null;
  try {
    fire('bagCard', 'dragover', { target: null });                    // 没有目标元素
    fire('bagCard', 'dragleave', { relatedTarget: null });            // 没有 relatedTarget
    fire('bagCard', 'dragend', { target: null });
  } catch (e) { e3 = e; }
  ok(!e3, '高亮的边界情况（无 target / 无 relatedTarget）都不抛错' + (e3 ? '：' + e3.message : ''));
}

/* Inventory stays single-page; world capsule wiring is covered separately. */
setBagPage(1);
ok(bag.page === 0 && bagPageEls.length === 1, '兼容入口不能恢复旧繁衍页');
ok(!/data-breed-/.test(el('bagPage0').innerHTML), '背包没有交配和接生控件');
ok((globalThis.__L['chamber-fire']?.click || []).length === 1, '地图投放按钮仅绑定一次');

closeBag();
ok(bag.open === false, '屠宰检查后背包已关闭');
console.log('  收尾：尸体 ' + corpses.length + ' 具｜动物 ' + animals.length + ' 只');

${DRIVER_FOOTER}
`;

let failed = false;
try {
  await runGame(DRIVER);
} catch (err) {
  console.log('\n运行失败：' + (err && err.message));
  failed = true;
}
console.log(failed ? '\n>>> 输入/UI 接线测试有失败 <<<' : '\n>>> 输入/UI 接线测试全部通过 <<<');
process.exit(failed ? 1 : 0);
