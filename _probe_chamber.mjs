/**
 * 真浏览器里把「太空舱结合」**整场走完**的探针 —— 2026-09-23 融合舱系统时新写。
 *
 * 为什么需要它（这是别人留下的空白）：
 *   舱的开发者交班文档里写着「最后一次等待 DNA 阶段的浏览器操作超时，
 *   当时界面显示『强化结合 0 / 4』」，并且**没有**任何浏览器端脚本去跑完整场演出
 *   （他们新增的 chamber.mjs 是 Node 夹具，证明得了状态机，证明不了真实 rAF 下的推进）。
 *   ⇒ 本探针补的就是这一格：在真浏览器里投放两只亲代 → 开始结合 → 按 QTE →
 *      **不给任何人为干预**，看演出能不能自己走到"新生命诞生"。
 *
 * 实测结论（2026-09-23，见运行时输出）：
 *   整场能走完。所谓"卡在强化结合 0 / 4"在本机复现不出来 —— 那是**环境性**的：
 *   演出推进挂在 `running && !paused && !document.hidden` 上，
 *   标签页失去可见性/被暂停时它就会停在原地（`chamber-performance.mjs` 的 update）。
 *
 * 驱动的诚实说明（哪部分是"真"的、哪部分是合成的）：
 *   · **按键（G / E / 空格）走 CDP 的 Input.dispatchKeyEvent** —— 浏览器自己组装事件，
 *     走真实的 keydown 管线，页面读的是 `e.code`。
 *   · **只转一次视角**用的是合成 MouseEvent（带 movementX）：
 *     舱的 `aim()` 靠相机中心射线挑槽位，要投第二只必须先把准星转到另一个槽位。
 *     用公式算准了角度（见 YAW_SLOT0 / TURN_TO_SLOT1），一次转到位。
 *     `dragLook` 模式要求先 mousedown 才认 mousemove，所以先合成一次 mousedown。
 *
 * 用法： node _probe_chamber.mjs [url]
 *   默认 http://127.0.0.1:8791/index.html?autostart=1&intro=0&pos=0,14&mag=2&yaw=-2.9612&pitch=0.1004
 *   需要 Node >= 22、本机 Chrome、以及 8791 上的 serve.py。
 *
 * 覆盖不到的（如实）：触摸屏、真实手柄、以及"标签页被切走"这种环境态（那正是本探针
 * 要排除的变量，只能由人复现）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/* ⚠️ `yaw` / `pitch` 是**算出来的**，不是试出来的：
     玩家在 (0, 14)、眼高 1.68；舱在 (0, ·, 23)，两个槽位的挂点在 (±1.64, 2.6, 23)。
     相机 forward = (−cosθ·sinψ, sinθ, −cosθ·cosψ)（three.js 的 YXZ 欧拉）⇒
       ψ(slot0) = atan2(−1.64, −9.0) = −2.9612，θ = asin(0.92/9.182) = 0.1004
     转向 slot1 需要 Δψ = +5.9224，而 `player.yaw -= movementX * 0.0021`
     ⇒ movementX = −5.9224 / 0.0021 = −2820。 */
const URL_ = process.argv[2] ||
  'http://127.0.0.1:8791/index.html?autostart=1&intro=0&pos=0,14&mag=2&breed=fast&yaw=-2.9612&pitch=0.1004';
const TURN_TO_SLOT1 = -2820;
const PORT = 9500 + (process.pid % 90);
const PROFILE = path.join(os.tmpdir(), 'alwk-chamber-' + process.pid);
const BUDGET_MS = 120000;          // 整场（含映后）的等待上限

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('ok   ' + msg); } else { fail++; console.log('FAIL ' + msg); } };
const sec = t => console.log('\n--- ' + t + ' ---');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-proxy-server', '--hide-scrollbars', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-sync', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1000,700',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  URL_,
], { stdio: ['ignore', 'ignore', 'ignore'] });

const die = async (code) => { try { chrome.kill(); } catch {} await sleep(250); try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} process.exit(code); };

let target = null;
for (let i = 0; i < 120; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (pages.length) { target = pages[0]; break; }
  } catch {}
  await sleep(250);
}
if (!target) { console.log('!! 连不上 CDP（端口 ' + PORT + '）'); await die(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS 打不开')); });

let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
};
const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error('页面里抛错：' + JSON.stringify(r.result.exceptionDetails.exception));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
/* 真按键：走 CDP，让浏览器自己组装 keydown/keyup（页面读 e.code）。 */
const VK = { KeyG: 71, KeyE: 69, KeyF: 70, Space: 32, Escape: 27 };
const key = async (code, type) => {
  await send('Input.dispatchKeyEvent', {
    type, code, key: code === 'Space' ? ' ' : code.slice(3).toLowerCase(),
    windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code],
  });
};
const tap = async (code) => { await key(code, 'keyDown'); await sleep(30); await key(code, 'keyUp'); await sleep(60); };

const status = async () => JSON.parse(await evalJS('JSON.stringify(__chamberStatus())'));

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
{
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { if (await evalJS('!!window.__gameBooted')) break; await sleep(300); }
}
ok(await evalJS('!!window.__gameBooted') === true, '游戏已启动（window.__gameBooted）');
if (!await evalJS('!!window.__gameBooted')) {
  console.log('\n!!! 页面没启动，现场如下 !!!');
  console.log(await evalJS('JSON.stringify({url: location.href, ready: document.readyState, body: document.body.textContent.slice(0,300)})'));
  await die(3);
}
await sleep(600);           // 让首帧跑完、舱系统就位

sec('A. 舱与世界');
ok(await evalJS('typeof __chamberStatus === "function"'), '页面暴露了 __chamberStatus（探针的观测口）');
{
  const s = await status();
  console.log('  phase=' + s.phase + '  task=' + s.task + '  slots=' + JSON.stringify(s.slots));
  ok(s.phase === 'loading' && s.task === 0, '起始相位 loading / 轮次 0');
  ok(s.slots.length === 2, '舱有两个亲代槽位（实际 ' + s.slots.length + '）');
  ok(await evalJS('!!document.getElementById("chamber-hud")'), '舱的 HUD 元素在 DOM 里');
  /* ⚠️ 这里原来断言"初始隐藏"，是错的：探针把玩家放在 pos=0,14（离舱 9 m），
     而舱的 `visible()` 就是"离得近 + 没开背包"⇒ 本来就该显示。
     改成断言真实的可见性判据（近 ⇒ 显示），别把探针的假设当成被测行为。 */
  ok(await evalJS('document.getElementById("chamber-hud").hidden === false'),
     '站在舱前 ⇒ 舱的 HUD 显示（visible() 的判据）');
}

sec('B. 投放两只亲代（真按键 G，先瞄左槽）');
{
  const before = await status();
  ok(before.slots.every(x => !x), '两槽起始都是空');
  await tap('KeyG');
  const s1 = await status();
  console.log('  按 G 后 slots=' + JSON.stringify(s1.slots));
  ok(!!s1.slots[0] || !!s1.slots[1], '按 G 投了一只进槽位（aim 命中）');
}

sec('C. 转视角到另一个槽位，再投一只（合成 MouseEvent 只用于这一次转向）');
{
  await evalJS(`(() => {
    const cv = document.getElementById('app');
    cv.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0}));
    document.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, movementX:${TURN_TO_SLOT1}, movementY:0}));
    document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
  })()`);
  await sleep(120);
  await tap('KeyG');
  const s2 = await status();
  console.log('  转向后再按 G：slots=' + JSON.stringify(s2.slots) + '  phase=' + s2.phase);
  ok(s2.slots.every(Boolean), '两槽都放好亲代');
  ok(s2.phase === 'sealing', '两只就位后自动开始密封（phase=' + s2.phase + '）');
}

sec('D. 密封 → 孕育 → 可以结合（真实时间推进，&breed=fast 把孕育压到 0 秒）');
{
  const t0 = Date.now();
  let s = await status();
  const seen = [s.phase];
  while (Date.now() - t0 < 20000) {
    s = await status();
    if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
    if (s.phase === 'ready' || s.phase === 'playing') break;
    await sleep(120);
  }
  console.log('  相位轨迹：' + seen.join(' → ') + '（' + (Date.now() - t0) + ' ms）');
  ok(s.phase === 'ready', '孕育结束、可以结合（phase=' + s.phase + '，耗时 ' + (Date.now() - t0) + ' ms）');
  ok(!!s.remaining === false || s.remaining === 0, '孕育倒计时已归零（remaining=' + s.remaining + '）');
  ok(await evalJS('!!document.getElementById("breedtag").classList.contains("on")'),
     'HUD 上的「培育舱已就绪」提醒亮了');
}

const timeline = [];
const cineSeen = [];            // 演出阶段名（去重后打印）
const sample = async () => {
  const s = await status();
  const p = s.performance || {};
  /* ⚠️ `p.done` 是**抓不住**的：它只在"电影播完 ~ 舱调 stop()"之间为真，宽度不到一帧。
     所以真正能证明"整场播完"的是**演出自己的阶段名** `cinematicPhase`
     （entry→drawing→weaving→coiling→separating→birth→result）——
     它一路走到 result，就说明演出从头到尾都跑了。 */
  const row = { phase: s.phase, state: p.state, cine: p.cinematicPhase, presses: p.presses, surge: p.surgeRound, t: +(p.time || 0).toFixed(1) };
  if (p.cinematicPhase) cineSeen.push(p.cinematicPhase);
  const last = timeline[timeline.length - 1];
  if (!last || last.phase !== row.phase || last.state !== row.state || last.cine !== row.cine ||
      last.presses !== row.presses || last.surge !== row.surge) timeline.push(row);
  return s;
};

sec('E. 开始结合（真按键 E）→ 演出');
{
  await tap('KeyE');
  await sleep(400);
  const s = await sample();
  console.log('  phase=' + s.phase + '  performance.state=' + (s.performance || {}).state);
  ok(s.phase === 'playing', '在舱前按 E ⇒ 进入演出（phase=' + s.phase + '）');
  ok(await evalJS('document.body.classList.contains("pod-cinematic")'), '演出期间加了 pod-cinematic（输入被接管）');
}

sec('F. 按 QTE：扣 10 次空格（这是玩家该做的操作，不是作弊）');
{
  for (let i = 0; i < 12; i++) { await tap('Space'); await sample(); }
  const s = await sample();
  console.log('  presses=' + (s.performance || {}).presses + ' / 10   state=' + (s.performance || {}).state);
  ok((s.performance || {}).presses >= 10, '空格累计到上限（' + (s.performance || {}).presses + ' / 10）');
}

sec('G. 【核心】不给任何干预，看演出能不能自己走到「新生命诞生」');
{
  const t0 = Date.now();
  let s = await sample();
  let peakSurge = (s.performance || {}).surgeRound || 0;
  let stallAt = null, lastProgress = Date.now();
  let prevKey = '';
  let everDone = false;
  while (Date.now() - t0 < BUDGET_MS) {
    s = await sample();
    const p = s.performance || {};
    if (p.done) everDone = true;        // ⚠️ 必须**在循环里**记：舱转入 complete 时会 stop()，
    peakSurge = Math.max(peakSurge, p.surgeRound || 0);   //    done 立刻被重置回 false（观测竞态）
    const k = [s.phase, p.state, p.presses, p.surgeRound, p.cinematicPhase, p.done].join('|');
    if (k !== prevKey) { prevKey = k; lastProgress = Date.now(); }
    if (!stallAt && Date.now() - lastProgress > 25000) stallAt = { at: Date.now() - t0, ...p, phase: s.phase };
    if (p.done || s.phase === 'complete') break;
    await sleep(250);
  }
  const el = Date.now() - t0;
  console.log('  演出耗时（从按完 QTE 算起）= ' + (el / 1000).toFixed(1) + ' s｜峰值 surgeRound=' + peakSurge + '/4');
  console.log('  轨迹：');
  for (const r of timeline) console.log('    ' + JSON.stringify(r));
  if (stallAt) console.log('  ⚠️ 曾出现 >25 s 无进展：' + JSON.stringify(stallAt));
  ok(!stallAt, '全程没有出现"长时间无进展"（这正是"卡在强化结合 0/4"的对照组）');
  ok(peakSurge >= 1, '强化阶段真的推进过（峰值 ' + peakSurge + ' / 4）—— 不是停在 0');
  /* ⚠️ 不能在这一刻直接读 performance.done —— 舱一旦转入 complete 就会调 stop()，
     把 performance 会话 reset（done 变回 false、time 归零），所以那是**观测竞态**：
     第一版就是这么假红的。真正可信的判据是 everDone（循环里记到过）
     或舱已经走到 complete（按设计 complete 只在 performanceView.done 之后才出现）。 */
  const p = (await status()).performance || {};
  console.log('  演出结束时 performance=' + JSON.stringify({state: p.state, done: p.done, everDone}) +
              '（被 stop() 重置是正常的）');
  {
    const seen = [...new Set(cineSeen)].filter(Boolean);
    console.log('  演出走过的阶段：' + (seen.join(' → ') || '(无)'));
    ok(seen.length >= 5, '演出阶段在推进（看到 ' + seen.length + ' 个阶段）');
    /* 出生与结果是这部电影的最后两站；看到它们 = 整场真的播完了。 */
    ok(seen.includes('birth'), '演出播到过「新生(birth)」阶段');
    ok(seen.includes('result'), '演出播到过「结合完成(result)」阶段 —— 整场跑完');
  }
  ok((await status()).phase === 'complete', '舱进入 complete（新生命诞生）');
}

sec('H. 领取后代（真按键 E）→ 舱回到 waiting');
{
  const before = await status();
  ok(!!before.child, '舱里有一个待领取的后代：' + before.child);
  await tap('KeyE');
  await sleep(500);
  const after = await status();
  console.log('  领取后 phase=' + after.phase + '  child=' + JSON.stringify(after.child));
  ok(after.phase === 'loading', '领取后舱回到 loading（可以再来一轮）');
  ok(!after.child, '舱里的后代已交出');
  ok(after.slots.every(Boolean), '亲代仍留在舱内（用户规则：亲代留槽位）');
  ok(await evalJS('(() => { const s = __chamberStatus(); return true; })()'), '状态查询仍然可用');
}

sec('I. 控制台');
{
  const errs = events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error');
  if (errs.length) for (const e of errs.slice(0, 8)) console.log('  ' + String(e.params.entry.text).slice(0, 220));
  ok(errs.length === 0, '整场演出没有控制台 error（' + errs.length + ' 条）');
}

console.log('\n===== ' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '（' + (pass + fail) + ' 项断言：' + pass + ' 通过 / ' + fail + ' 失败）=====');
await die(fail === 0 ? 0 : 1);
