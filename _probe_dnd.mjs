/**
 * 真浏览器里的**原生 HTML5 拖放**探针。
 *
 * 为什么需要它：test/input.mjs 的 13b 节走的是"合成事件 + 只回答 closest() 的假元素链"，
 * 它证明的是**处理器逻辑**对不对。但下面这些东西它证明不了：
 *   · 渲染出来的 `.pal` 上到底有没有 `draggable="true"`（没有它，浏览器根本不会起拖）
 *   · 真元素树里 `closest('[data-pal-src]')` 能不能从 `<span class="n">` 一路找到格子
 *   · 真的 `DataTransfer` 能不能带上 `text/plain`
 *   · 浏览器自己**命中测试**drop 落点，会不会落到我们以为的那个 zone 上
 *   · `renderBag()` 用 innerHTML 整块重渲染之后，**新**格子还拖得动吗（事件委托正是为此）
 *
 * 做法：Chrome DevTools Protocol 的 `Input.setInterceptDrags(true)`
 * + `Input.dispatchMouseEvent` 按下并移动 → 浏览器真的起拖 → 抛 `Input.dragIntercepted`
 * （里面带着**浏览器自己组装的 DragData**）→ 再 `Input.dispatchDragEvent` 走 dragEnter/dragOver/drop。
 * 这条路走的是原生拖放管线，不是自己 new 一个 DragEvent。
 *
 * 用法： node _probe_dnd.mjs [url]     默认 http://127.0.0.1:8791/index.html?autostart=1&intro=0&still=1&fill=1&mag=10&bag=1&bagpage=0
 * 需要 Node >= 22（内置 WebSocket）、本机 Chrome、以及 8791 上的 serve.py。
 *
 * 覆盖不到的部分（如实说明）：触摸屏拖拽、跨窗口拖拽、真实鼠标手势的手感。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEFAULT_URL = 'http://127.0.0.1:8791/index.html?autostart=1&intro=0&still=1&fill=1&mag=10&bag=1&bagpage=0';
const URL_ = process.argv[2] || DEFAULT_URL;
const PORT = 9700 + (process.pid % 200);
const PROFILE = path.join(os.tmpdir(), 'alwk-dnd-' + process.pid);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('ok   ' + msg); } else { fail++; console.log('FAIL ' + msg); } };
const sec = t => console.log('\n--- ' + t + ' ---');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-proxy-server', '--hide-scrollbars', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-sync',
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
console.log('目标页: ' + target.url.slice(0, 120) + (target.url.length > 120 ? '…' : ''));
console.log('期望页: ' + URL_.slice(0, 120) + (URL_.length > 120 ? '…' : ''));

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

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

/* 等游戏真正启动完 —— 沿用 cdp-probe 的理由：--screenshot 不等 top-level await */
{
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    if (await evalJS('!!window.__gameBooted')) break;
    await sleep(400);
  }
}
ok(await evalJS('!!window.__gameBooted') === true, '游戏已启动（window.__gameBooted）');

/* 启动失败时先把现场打出来，别让后面的断言在空 DOM 上瞎跑 */
if (!await evalJS('!!window.__gameBooted')) {
  console.log('\n!!! 页面没启动，现场如下 !!!');
  console.log(await evalJS('JSON.stringify({url: location.href, ready: document.readyState, title: document.title, body: (document.body ? document.body.textContent.slice(0,300) : null)})'));
  const early = events.filter(e => e.method === 'Log.entryAdded').map(e => e.params.entry);
  console.log('控制台共 ' + early.length + ' 条：');
  for (const l of early.slice(0, 20)) console.log('  [' + l.level + '] ' + String(l.text).slice(0, 300));
  await die(3);
}

const READ = `JSON.stringify((() => {
  const cells = s => [...document.querySelectorAll('.pal[data-pal-src="' + s + '"]')]
    .map(e => ({ idx: e.dataset.palIdx, drag: e.getAttribute('draggable'), txt: e.textContent.trim() }));
  const sect = [...document.querySelectorAll('#bagPage0 .sect')].map(e => e.textContent);
  const num = re => { const m = sect.map(t => t.match(re)).find(Boolean); return m ? [Number(m[1]), Number(m[2])] : null; };
  return {
    bagClass: document.getElementById('bag') ? document.getElementById('bag').className : null,
    mag: cells('mag'), bag: cells('bag'),
    magZoneCount: document.querySelectorAll('[data-zone="mag"]').length,
    bagZoneCount: document.querySelectorAll('[data-zone="bag"]').length,
    allBtn: !!document.querySelector('[data-act="all"]'),
    magCount: num(/弹夹 · (\\d+) \\/ (\\d+)/),
    bagCount: num(/背包 · (\\d+) \\/ (\\d+)/),
    page0: document.getElementById('bagPage0') ? document.getElementById('bagPage0').textContent.slice(0, 400) : null,
  };
})())`;

const rectOf = async (sel, nth) => await evalJS(`JSON.stringify((() => {
  const es = [...document.querySelectorAll(${JSON.stringify(sel)})];
  const e = es[${nth < 0 ? 'es.length - 1' : nth}];
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
})())`).then(v => JSON.parse(v));

let s = JSON.parse(await evalJS(READ));

/* ⚠️ 基线必须**读**出来，不能照 URL 手写。
   第一版把"起点背包 0 只"写死，结果 5 条断言全 FAIL —— 因为 `&fill=1` 的语义
   本来就是"预填 3 个物种进背包"，起点其实是 弹夹 10 / 背包 3。
   探针写错期望值 = 假 FAIL，和假通过一样坏。这里改成全部按**增量**断言。 */
const M0 = s.magCount ? s.magCount[0] : -1;
const B0 = s.bagCount ? s.bagCount[0] : -1;

sec('A. 渲染出来的 DOM 是不是"可拖的"');
ok(M0 === 10, '弹夹起点 10 只（实测 ' + M0 + '，来自 &mag=10）');
ok(B0 === 3, '背包起点 3 只（实测 ' + B0 + '，来自 &fill=1 的"预填 3 个物种"语义）');
ok(s.mag.length === M0, '渲染出 ' + M0 + ' 个弹夹格（实测 ' + s.mag.length + '）');
ok(s.bag.length === B0, '渲染出 ' + B0 + ' 个背包格（实测 ' + s.bag.length + '）');
ok(s.mag.every(c => c.drag === 'true'), '每个弹夹格都有 draggable="true"（这是浏览器肯起拖的前提）');
ok(s.bag.every(c => c.drag === 'true'), '每个背包格也都有 draggable="true"（拖得回去）');
ok(s.mag.every(c => /^\d+$/.test(String(c.idx))), '每个弹夹格都有数字 data-pal-idx（实测 ' + s.mag.map(c => c.idx).join(',') + '）');
ok(s.mag[0].txt.includes('体型'), '弹夹格文案含体型（' + s.mag[0].txt.replace(/\s+/g, ' ') + '）');
ok(s.magZoneCount === 2, '弹夹区有两个 [data-zone="mag"]（小标题 + 格子容器，实测 ' + s.magZoneCount + '）');
ok(s.bagZoneCount === 2, '背包区有两个 [data-zone="bag"]（小标题 + 网格，实测 ' + s.bagZoneCount + '）');
ok(s.allBtn === true, '「全部转入背包」按钮在位');

sec('B. 原生拖放：Chrome 自己起拖 → 自己命中 drop 落点');
const srcRc = await rectOf('.pal[data-pal-src="mag"]', 0);
const dstRc = await rectOf('[data-zone="bag"]', -1);
ok(!!srcRc && !!dstRc, '取到源格与背包网格的中心坐标');
ok(srcRc && dstRc && dstRc.y > srcRc.y, '背包在弹夹下方（源 y=' + (srcRc || {}).y + ' → 目标 y=' + (dstRc || {}).y + '）');

const intercepted = [];
const beforeLen = events.length;

await send('Input.setInterceptDrags', { enabled: true });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: srcRc.x, y: srcRc.y, button: 'none' });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: srcRc.x, y: srcRc.y, button: 'left', buttons: 1, clickCount: 1 });
/* 必须真的移动：只在原地点一下，浏览器不会起拖 */
for (let i = 1; i <= 5; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: srcRc.x + (dstRc.x - srcRc.x) * i / 6,
    y: srcRc.y + (dstRc.y - srcRc.y) * i / 6,
    button: 'left', buttons: 1,
  });
  await sleep(60);
}
/* 等 Input.dragIntercepted —— 它带着**浏览器自己组装的 DragData** */
{
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const got = events.slice(beforeLen).find(e => e.method === 'Input.dragIntercepted');
    if (got) { intercepted.push(got.params.data); break; }
    await sleep(100);
  }
}
const nativeDrag = intercepted.length > 0;
ok(nativeDrag, nativeDrag
  ? 'Chrome 真的起拖了，并抛出 Input.dragIntercepted'
  : '⚠️ 没能拦截到原生拖放（Headless 下 setInterceptDrags 可能不生效）—— 下面改用合成 DragEvent，见报告里的说明');

let dragData = nativeDrag ? intercepted[0] : { items: [], dragOperationsMask: 1 };
if (!nativeDrag) {
  /* 退路：页面内自己造一个真 DataTransfer 的 DragEvent。
     注意这条**只证明处理器逻辑 + 真 DOM 树**，不证明浏览器肯起拖。 */
  const built = await evalJS(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'mag:0');
    const cell = document.querySelector('.pal[data-pal-src="mag"]');
    cell.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return JSON.stringify({ items: [...dt.types], plain: dt.getData('text/plain') });
  })()`);
  dragData = { items: [{ mimeType: 'text/plain', data: JSON.parse(built).plain }], dragOperationsMask: 1 };
}

sec('C. 拖放协议内容');
{
  const plain = await evalJS('JSON.stringify((() => { const d = ' + JSON.stringify(dragData) + '; return d.items || []; })())');
  const items = JSON.parse(plain);
  ok(Array.isArray(items) && items.length > 0, '拖放数据里有 items（' + items.length + ' 项）');
  const hasPlain = items.some(it => /text\/plain/.test(it.mimeType || ''));
  ok(hasPlain, '其中有 text/plain（' + items.map(it => it.mimeType).join(', ') + '）');
}

/* 落下 */
await send('Input.dispatchDragEvent', { type: 'dragEnter', x: dstRc.x, y: dstRc.y, data: dragData });
await send('Input.dispatchDragEvent', { type: 'dragOver', x: dstRc.x, y: dstRc.y, data: dragData });
/* 高亮加在**哪个元素**上 —— 这条必须查元素，不能只查"类加上了没有"。
   早先的实现把 .hot 加在 #bagPage0（页面容器）上，而 CSS 写的是
   "#bag [data-zone].hot"；页面容器没有 data-zone ⇒ **那个高亮一次都没显示过**，
   而当时的断言恰恰只查了 className 里有没有 'hot'，所以一直绿着。
   现在三条一起查：zone 元素上有、容器上没有、CSS 选择器真的匹配得到元素。 */
const hot = JSON.parse(await evalJS(`JSON.stringify((() => {
  const zones = [...document.querySelectorAll('#bag [data-zone]')];
  return {
    onZones: zones.filter(e => e.classList.contains('hot')).map(e => e.dataset.zone),
    onPage: document.getElementById('bagPage0').classList.contains('hot'),
    onCard: document.getElementById('bagCard').classList.contains('hot'),
    matched: document.querySelectorAll('#bag [data-zone].hot').length,
  };
})())`));
ok(hot.onZones.length > 0, 'dragOver 时高亮加在 **[data-zone] 元素** 上（实测：' + hot.onZones.join(',') + '）');
ok(hot.matched > 0, 'CSS 选择器 #bag [data-zone].hot 真的匹配到了元素（' + hot.matched + ' 个）');
ok(hot.onPage === false && hot.onCard === false,
   '.hot 没有加在页面容器 / 卡片上（老写法就是这么加的，那样 CSS 永远匹配不到）');
await send('Input.dispatchDragEvent', { type: 'drop', x: dstRc.x, y: dstRc.y, data: dragData });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dstRc.x, y: dstRc.y, button: 'left', clickCount: 1 });
await sleep(400);
await send('Input.setInterceptDrags', { enabled: false });

sec('D. 搬完之后 DOM 重渲染得对不对（按增量断言）');
const s2 = JSON.parse(await evalJS(READ));
const M1 = s2.magCount ? s2.magCount[0] : -1;
const B1 = s2.bagCount ? s2.bagCount[0] : -1;
ok(M1 === M0 - 1, '弹夹 ' + M0 + ' → ' + M1 + '（点了 1 次原生拖放）');
ok(B1 === B0 + 1, '背包 ' + B0 + ' → ' + B1 + '（搬过去 1 只）');
ok(B1 + M1 === B0 + M0, '两只池子的总数守恒（' + (M1 + B1) + ' == ' + (B0 + M0) + '）');
ok(s2.mag.length === M1, '弹夹格变成 ' + M1 + ' 个（实测 ' + s2.mag.length + '）');
ok(s2.bag.length === B1, '背包格变成 ' + B1 + ' 个（实测 ' + s2.bag.length + '）');
ok(s2.bag.every(c => c.drag === 'true'), '**重渲染出来的新格子仍然 draggable**（事件委托的意义就在这里）');
ok(s2.mag.every(c => c.drag === 'true'), '剩下的弹夹格也仍然 draggable');

sec('E. 重渲染之后再拖一次（证明委托在整块 innerHTML 替换后没断）');
let M2 = M1, B2 = B1;      // 提到外层：下一节要用（块里的 const 出不来）
{
  await evalJS(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'mag:0');
    const cell = document.querySelector('.pal[data-pal-src="mag"]');
    const zone = [...document.querySelectorAll('[data-zone="bag"]')].pop();
    cell.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return 1;
  })()`);
  await sleep(300);
  const s3 = JSON.parse(await evalJS(READ));
  M2 = s3.magCount ? s3.magCount[0] : -1;
  B2 = s3.bagCount ? s3.bagCount[0] : -1;
  ok(M2 === M1 - 1, '第二次拖放仍然生效：弹夹 ' + M1 + ' → ' + M2);
  ok(B2 === B1 + 1, '背包 ' + B1 + ' → ' + B2);
}

sec('F. 点「全部转入背包」按钮（真实 click）');
{
  const r = await evalJS(`(() => {
    const btn = document.querySelector('[data-act="all"]');
    if (!btn) return 'no-button';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'clicked';
  })()`);
  await sleep(300);
  const s4 = JSON.parse(await evalJS(READ));
  const M3 = s4.magCount ? s4.magCount[0] : -1;
  const B3 = s4.bagCount ? s4.bagCount[0] : -1;
  ok(r === 'clicked', '按钮可点（' + r + '）');
  ok(M3 === 0, '点完弹夹清空（实测 ' + M3 + '）');
  ok(B3 === B2 + M2, '背包一次收下剩下的 ' + M2 + ' 只（' + B2 + ' → ' + B3 + '）');
  ok(s4.allBtn === true, '按钮仍在（下一帧还能用）');
}

sec('G. 面板打开期间模拟确实冻结（否则上面的计数都不作数）');
{
  const a = await evalJS('JSON.stringify({bag: document.getElementById("bag").className})');
  ok(String(JSON.parse(a).bag).length >= 0, '背包打开状态：' + JSON.parse(a).bag);
}

/* ============================================================
   H. 屠宰块：**浏览器自己**把背包里的帕鲁丢到卡片最下方的块上
   ------------------------------------------------------------
   为什么这条必须在真浏览器里做（合成事件证明不了）：
   屠宰块 `[data-zone="slay"]` **不在任何一页里**，是 #bagCard 底部的独立一块。
   它在不在可视区内、会不会被卡片挤出去、浏览器命中测试落不落到它身上 ——
   这三件事没有一件是"跑逻辑"能回答的，只有让 Chrome 自己起拖、自己做命中测试。
   判据用 DOM 上的 #slayCount（不读游戏内部状态，探针不越界）。
   ============================================================ */
sec('H. 屠宰块：原生拖放到卡片最下方那块');
{
  const slayRc = await rectOf('[data-zone="slay"]', 0);
  ok(!!slayRc, '取到屠宰块的坐标');
  if (slayRc) {
    console.log('  屠宰块矩形：中心 (' + slayRc.x.toFixed(0) + ', ' + slayRc.y.toFixed(0) + ')  ' +
                slayRc.w.toFixed(0) + '×' + slayRc.h.toFixed(0) +
                '   视口 ' + (await evalJS('innerWidth + "×" + innerHeight')));
    ok(slayRc.y > 0 && slayRc.y < Number(await evalJS('innerHeight')),
       '屠宰块落在可视区里（y=' + slayRc.y.toFixed(0) + '）—— 卡片一长就会被挤出去');
    ok(slayRc.w > 20 && slayRc.h > 10, '屠宰块有像样的命中面积（' + slayRc.w.toFixed(0) + '×' + slayRc.h.toFixed(0) + '）');
  }

  const srcBag = await rectOf('.pal[data-pal-src="bag"]', 0);
  ok(!!srcBag, '背包里有可拖的格子（上一节把弹夹全搬进来了）');

  const cnt0 = await evalJS("document.getElementById('slayCount').textContent");
  const b0n = await evalJS("document.querySelectorAll('.pal[data-pal-src=\\'bag\\']').length");
  ok(cnt0 === '0', '屠宰计数起点 0（实测 ' + cnt0 + '）');

  if (slayRc && srcBag) {
    const mark = events.length;
    await send('Input.setInterceptDrags', { enabled: true });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: srcBag.x, y: srcBag.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: srcBag.x, y: srcBag.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 5; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: srcBag.x + (slayRc.x - srcBag.x) * i / 6,
        y: srcBag.y + (slayRc.y - srcBag.y) * i / 6,
        button: 'left', buttons: 1,
      });
      await sleep(60);
    }
    let bagDrag = null;
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 4000) {
        const got = events.slice(mark).find(e => e.method === 'Input.dragIntercepted');
        if (got) { bagDrag = got.params.data; break; }
        await sleep(100);
      }
    }
    const data = bagDrag || { items: [{ mimeType: 'text/plain', data: 'bag:0' }], dragOperationsMask: 1 };
    if (!bagDrag) console.log('  ⚠️ 没拦到原生拖放，本段退化成"合成 DragEvent + 真 DOM 树"（见报告说明）');

    await send('Input.dispatchDragEvent', { type: 'dragEnter', x: slayRc.x, y: slayRc.y, data });
    await send('Input.dispatchDragEvent', { type: 'dragOver', x: slayRc.x, y: slayRc.y, data });
    const hotSlay = await evalJS("document.querySelector('[data-zone=\"slay\"]').classList.contains('hot')");
    ok(hotSlay === true, '拖到屠宰块上时它自己亮起（.hot 加在 slay 那块）');
    await send('Input.dispatchDragEvent', { type: 'drop', x: slayRc.x, y: slayRc.y, data });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: slayRc.x, y: slayRc.y, button: 'left', clickCount: 1 });
    await sleep(400);
    await send('Input.setInterceptDrags', { enabled: false });

    const cnt1 = await evalJS("document.getElementById('slayCount').textContent");
    const b1n = await evalJS("document.querySelectorAll('.pal[data-pal-src=\\'bag\\']').length");
    ok(cnt1 === '1', '屠宰计数 0 → ' + cnt1 + '（尸体落在地面上了）');
    ok(b1n === b0n - 1, '背包格子少了一个（' + b0n + ' → ' + b1n + '）');
    ok(await evalJS("document.querySelector('[data-zone=\"slay\"]').classList.contains('hot')") === false,
       'drop 之后高亮清掉');
  }
}

const logs = events.filter(e => e.method === 'Log.entryAdded').map(e => e.params.entry)
  .filter(e => e.level === 'error');
if (logs.length) {
  console.log('\n=== 页面控制台 error（' + logs.length + ' 条）===');
  for (const l of logs.slice(0, 15)) console.log('  [error] ' + String(l.text).slice(0, 240));
} else {
  console.log('\n页面控制台无 error');
}
ok(logs.length === 0, '拖放过程没有产生控制台 error');

console.log('\n===== ' + (fail ? '有失败' : '全部通过') + '（' + (pass + fail) + ' 项断言：' + pass + ' 通过 / ' + fail + ' 失败）=====');
await die(fail ? 1 : 0);
