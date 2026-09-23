/**
 * 真浏览器里的 **HUD 布局探针** —— 只量矩形，不截图。
 *
 * 为什么要有它：HUD 是"摆放类"UI，它的正确性**不在代码里**，而在渲染出来的像素位置上。
 *   · CSS 写对了、DOM 搬对了，元素之间仍然可能**互相压住**（尤其弹夹和体力条对调之后，
 *     它们换到的是"另一块地方"，而其他地方还站着原来的东西）；
 *   · 窄窗口下 `min(300px, 44vw)` 这类自适应写法会让重叠**只在某个宽度区间出现**，
 *     在开发机上永远看不到；
 *   · 还有一种"看不见"的错误：元素被 `&hud=0` 漏掉（见下）。
 * 这三类都只能靠**真布局引擎**量出 getBoundingClientRect 才判得了。
 *
 * 本次针对的具体问题（2026-09-23）：
 *   `#mag`（弹夹）原来挂在 `#hud` **外面**（body 的直接子节点），而 `&hud=0` 只设
 *   `#hud{display:none}` ⇒ 此前所有"取干净画面"的截图里一直挂着一颗弹夹药丸，
 *   没人发现，因为那正是"想让 HUD 消失"的场景、而它偏偏没消失。
 *   这一轮把 `#mag` 挪进了 `#hud`（顺带把它放到原来罗盘的位置），所以这里要**验证**：
 *   带 `&hud=0` 时弹夹真的不见了。
 *   （注意：这条不能靠"看 CSS 有没有写对"来验，必须真渲染。）
 *
 * 用法： node _probe_hud.mjs [url]
 *   默认 http://127.0.0.1:8791/index.html?autostart=1&intro=0&still=1
 *   需要 Node >= 22（内置 WebSocket）、本机 Chrome、以及 8791 上的 serve.py。
 *
 * 覆盖不到的部分（如实说明）：
 *   · 只测两个视口尺寸（1000×700 与 720×560），更窄/更宽的窗口没测；
 *   · 测不出"肉眼觉得难看"—— 只测"有没有压住 / 有没有出界 / 该藏的时候藏没藏"；
 *   · 不测动画中途的状态（HUD 有 opacity/transition，这里读的是稳定后的值）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:8791/index.html?autostart=1&intro=0&still=1';
const PORT = 9900 + (process.pid % 90);
const PROFILE = path.join(os.tmpdir(), 'alwk-hud-' + process.pid);

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
async function waitBoot(matchHref) {
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    if (await evalJS('!!window.__gameBooted')) {
      if (!matchHref || await evalJS('location.href.includes(' + JSON.stringify(matchHref) + ')')) return true;
    }
    await sleep(400);
  }
  return false;
}

/* 一次性把 HUD 里所有"摆放类"元素的矩形与视口一起读回来。
   ⚠️ 用 getBoundingClientRect 而不是 offsetTop/offsetLeft：
   后者相对 offsetParent，而 #hud 是 position:fixed ⇒ 不同元素的 offsetParent 不一样，
   混着用会得出"弹夹在页面左上角"这种假结论。 */
const READ = `JSON.stringify((() => {
  const ids = ['topleft', 'mag', 'topright', 'leftcol', 'minimap', 'mapCanvas', 'bottomleft', 'stamwrap', 'bottomright', 'reticle'];
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = { vw, vh, els: {} };
  for (const id of ids) {
    const e = document.getElementById(id);
    if (!e) { out.els[id] = null; continue; }
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    /* "看得见"= 自己有尺寸、自己不是 display:none/visibility:hidden、
       且**祖先链上每一个**都没有 display:none（&hud=0 就是加在最外层 #hud 上的）。 */
    let vis = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    for (let p = e.parentElement; p && vis; p = p.parentElement) {
      const pc = getComputedStyle(p);
      if (pc.display === 'none' || pc.visibility === 'hidden') vis = false;
    }
    out.els[id] = {
      x: r.left, y: r.top, w: r.width, h: r.height,
      cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      right: r.right, bottom: r.bottom,
      vis, display: cs.display, parent: e.parentElement ? (e.parentElement.id || e.parentElement.tagName) : null,
    };
  }
  return out;
})())`;

const readLayout = async () => JSON.parse(await evalJS(READ));

const overlaps = (a, b) =>
  a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;

function checkLayout(L, tag, base) {
  const e = L.els;
  sec(tag + '：视口 ' + L.vw + '×' + L.vh);

  for (const id of ['topleft', 'mag', 'leftcol', 'minimap', 'mapCanvas', 'bottomleft', 'stamwrap', 'bottomright']) {
    ok(e[id] && e[id].vis, '#' + id + ' 存在且可见' + (e[id] ? '（' + Math.round(e[id].w) + '×' + Math.round(e[id].h) + '，父元素 ' + e[id].parent + '）' : '（缺）'));
  }
  if (!e.mag || !e.stamwrap) { ok(false, '弹夹或体力条缺失，后面的几何断言没法做'); return; }
  if (!e.minimap || !e.mapCanvas || !e.bottomleft) { ok(false, '小地图或坐标面板缺失，后面的几何断言没法做'); return; }
  /* ⚠️ 注意这里**每一条都写了 if 守卫**（而不是 `if (e.minimap) {…}`）：
     守卫被拆掉时要红在"缺了"这条上，而不是后面抛 TypeError 把整个 driver 打断
     —— 后者会让人分不清"守卫没了"和"驱动崩了"（本项目在突变检验里踩过一次）。 */

  /* 0. ⚠️ 「窄屏收边」@media 真的生效了吗 —— 这一条是防**静默死代码**的。
     媒体查询的优先级不比基础规则高（选择器一样就按源码顺序定胜负），
     所以把 @media 写在基础规则**前面**时，它会一行都不起作用 ——
     而下面那些"不重叠"的断言**照样会绿**（因为侧面板收窄本身就够解重叠了）。
     第一版就是这么写的，全靠这条断言才发现。 */
  if (base) {
    const w = id => e[id].w, b = id => base.els[id].w;
    ok(w('mag') < b('mag') - 2, '#mag 窄屏确实收窄了（' + Math.round(b('mag')) + ' → ' + Math.round(w('mag')) + ' px ⇒ 那条 @media 生效）');
    ok(w('stamwrap') < b('stamwrap') - 2, '#stamwrap 窄屏确实收窄了（' + Math.round(b('stamwrap')) + ' → ' + Math.round(w('stamwrap')) + ' px）');
    ok(w('bottomleft') < b('bottomleft') - 2, '#bottomleft 窄屏确实收窄了（' + Math.round(b('bottomleft')) + ' → ' + Math.round(w('bottomleft')) + ' px）');
    ok(w('bottomright') < b('bottomright') - 2, '#bottomright 窄屏确实收窄了（' + Math.round(b('bottomright')) + ' → ' + Math.round(w('bottomright')) + ' px）');
    ok(w('minimap') < b('minimap') - 2, '#minimap 窄屏确实收窄了（' + Math.round(b('minimap')) + ' → ' + Math.round(w('minimap')) + ' px）');
  }

  /* 1. 弹夹：顶部中间。居中容差 2 px（translateX(-50%) 在奇偶宽度上会有 0.5 px 的取整） */
  ok(Math.abs(e.mag.cx - L.vw / 2) <= 2, '#mag 水平居中（中心 ' + e.mag.cx.toFixed(1) + ' / 视口中心 ' + (L.vw / 2) + '）');
  ok(e.mag.y >= 8 && e.mag.y <= 40, '#mag 在顶部（top=' + e.mag.y.toFixed(1) + '，期望 8~40）');

  /* 2. 体力条：底部中间 */
  ok(Math.abs(e.stamwrap.cx - L.vw / 2) <= 2, '#stamwrap 水平居中（中心 ' + e.stamwrap.cx.toFixed(1) + '）');
  ok(L.vh - e.stamwrap.bottom <= 40 && L.vh - e.stamwrap.bottom >= 8,
     '#stamwrap 贴底（离视口下沿 ' + (L.vh - e.stamwrap.bottom).toFixed(1) + ' px，期望 8~40）');

  /* 3. 上下关系：这是"两者对调"这条需求的核心可核证据 —— 顺序反了就该响 */
  ok(e.mag.bottom < e.stamwrap.y, '弹夹整体在体力条上方（弹夹底 ' + e.mag.bottom.toFixed(1) + ' < 体力条顶 ' + e.stamwrap.y.toFixed(1) + '）');

  /* 3b. 小地图（2026-09-23 新增需求）：
       · **正方形** —— 需求原文就是"正方形"；canvas 是 replaced element，
         `width:100%` 时高度会按 HTML 属性撑，少了 aspect-ratio 就变长方形；
       · 在坐标面板**上方**（需求原文"现在的方框上方"）；
       · 和坐标面板同宽左对齐（同一列，靠 flex 排的）。
       这三条都只能在真浏览器量，静态查 DOM 顺序抓不到。 */
  ok(Math.abs(e.mapCanvas.w - e.mapCanvas.h) <= 1.5,
     '#mapCanvas 是**正方形**（' + e.mapCanvas.w.toFixed(1) + '×' + e.mapCanvas.h.toFixed(1) + ' px）');
  ok(e.minimap.bottom <= e.bottomleft.y + 0.5,
     '#minimap 在 #bottomleft **上方**（小地图底 ' + e.minimap.bottom.toFixed(1) + ' ≤ 面板顶 ' + e.bottomleft.y.toFixed(1) + '）');
  ok(Math.abs(e.minimap.x - e.bottomleft.x) <= 1.5 && Math.abs(e.minimap.w - e.bottomleft.w) <= 1.5,
     '#minimap 与 #bottomleft 同宽左对齐（列宽 ' + e.minimap.w.toFixed(0) + ' / ' + e.bottomleft.w.toFixed(0) + ' px）');
  ok(e.leftcol.y <= e.minimap.y + 0.5 && e.bottomleft.bottom <= e.leftcol.bottom + 0.5,
     '两者都在 #leftcol 的纵向范围里（列容器确实包住了它们）');
  ok(e.mapCanvas.w >= 90, '小地图画布缩下来还有可用尺寸（' + e.mapCanvas.w.toFixed(0) + ' px ≥ 90）');

  /* 4. 两两不重叠。
     ⚠️ 参与比较的集合要**显式列出**，不能用"所有读到的元素"：
        #leftcol 是 #minimap / #bottomleft 的父容器，包含关系会被 overlaps() 判成重叠；
        #mapCanvas 在 #minimap 里面，同理。把容器排除掉才是"同伴之间不压住"的正确判据。
        reticle 是准星、故意在正中央，和四角的面板本来就不重叠，所以一起算。 */
  const ids = ['topleft', 'mag', 'topright', 'minimap', 'bottomleft', 'stamwrap', 'bottomright', 'reticle']
    .filter(k => e[k] && e[k].vis);
  const bad = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (overlaps(e[ids[i]], e[ids[j]])) {
      const A = e[ids[i]], B = e[ids[j]];
      const ox = Math.min(A.right, B.right) - Math.max(A.x, B.x);
      const oy = Math.min(A.bottom, B.bottom) - Math.max(A.y, B.y);
      bad.push('#' + ids[i] + ' × #' + ids[j] + ' 重叠 ' + ox.toFixed(0) + '×' + oy.toFixed(0) + ' px');
    }
  }
  ok(bad.length === 0, 'HUD 元素两两不重叠（' + (bad.join('；') || '无重叠') + '）');

  /* 5. 全部在视口内（"顶到边上被裁掉"是这类布局最常见的失败） */
  const out = [];
  for (const k of ids.concat(['leftcol', 'mapCanvas'])) {
    const E = e[k];
    if (!E) continue;
    if (E.x < -0.5 || E.y < -0.5 || E.right > L.vw + 0.5 || E.bottom > L.vh + 0.5) {
      out.push('#' + k + ' [' + E.x.toFixed(0) + ',' + E.y.toFixed(0) + ' → ' + E.right.toFixed(0) + ',' + E.bottom.toFixed(0) + ']');
    }
  }
  ok(out.length === 0, 'HUD 元素全在视口内（越界：' + (out.join('；') || '无') + '）');
}

await waitBoot(null);
ok(await evalJS('!!window.__gameBooted') === true, '游戏已启动（window.__gameBooted）');

/* ---- 第一轮：默认视口（后面的窄屏轮都拿它当基线比宽度） ---- */
const BASE = await readLayout();
checkLayout(BASE, 'A. 默认窗口（1000×700 窗口 → 实际视口）');

/* ---- 第二轮：窄窗口（720×560）。min(300px,44vw) 这类写法的问题只在这个区间露头 ---- */
await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 560, deviceScaleFactor: 1, mobile: false });
await sleep(500);
checkLayout(await readLayout(), 'B. 窄窗口 720×560', BASE);

/* 再窄一点，跨过 @media (max-width:640px) 那条断点（#topright 会 display:none） */
await send('Emulation.setDeviceMetricsOverride', { width: 620, height: 520, deviceScaleFactor: 1, mobile: false });
await sleep(500);
{
  const L = await readLayout();
  sec('C. 620×520（跨过 max-width:640px 断点）');
  ok(L.els.mag && L.els.mag.vis, '#mag 仍然可见（窄屏不该把弹夹弄丢）');
  ok(L.els.stamwrap && L.els.stamwrap.vis, '#stamwrap 仍然可见');
  ok(L.els.topright ? !L.els.topright.vis : true, '#topright 在这个宽度下已隐藏（断点生效）');
  /* ⚠️ 参与比较的集合要显式列出（理由同 checkLayout 第 4 条）：
     #leftcol 是容器、#mapCanvas 在 #minimap 里面，包含关系会被判成重叠。 */
  const ids = ['topleft', 'mag', 'topright', 'minimap', 'bottomleft', 'stamwrap', 'bottomright', 'reticle']
    .filter(k => L.els[k] && L.els[k].vis);
  const bad = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (overlaps(L.els[ids[i]], L.els[ids[j]])) bad.push('#' + ids[i] + ' × #' + ids[j]);
  }
  ok(bad.length === 0, '620 宽下仍不重叠（' + (bad.join('；') || '无重叠') + '）');
  ok(L.els.minimap && L.els.minimap.vis, '#minimap 仍然可见（窄屏不该把小地图弄丢）');
  ok(Math.abs(L.els.mapCanvas.w - L.els.mapCanvas.h) <= 1.5,
     '极窄档下小地图仍是正方形（' + L.els.mapCanvas.w.toFixed(1) + '×' + L.els.mapCanvas.h.toFixed(1) + '）');
  ok(L.els.mag.right <= L.vw + 0.5 && L.els.mag.x >= -0.5, '#mag 没被挤出视口（' + L.els.mag.x.toFixed(0) + ' → ' + L.els.mag.right.toFixed(0) + '）');
  /* 极窄档的收边也要真的生效（同"静默死代码"那条理由） */
  ok(L.els.stamwrap.w < BASE.els.stamwrap.w - 2,
     '#stamwrap 在极窄档又收了一档（' + Math.round(BASE.els.stamwrap.w) + ' → ' + Math.round(L.els.stamwrap.w) + ' px）');
  ok(L.els.mag.w < BASE.els.mag.w - 2, '#mag 在极窄档又收了一档（' + Math.round(BASE.els.mag.w) + ' → ' + Math.round(L.els.mag.w) + ' px）');
  ok(L.els.stamwrap.w >= 160, '#stamwrap 收窄后仍有可用宽度（' + Math.round(L.els.stamwrap.w) + ' px ≥ 160，再窄就读不出「体力 100%」了）');
  ok(Math.abs(L.els.stamwrap.cx - L.vw / 2) <= 2, '#stamwrap 仍然居中（中心 ' + L.els.stamwrap.cx.toFixed(1) + '）');
}
await send('Emulation.clearDeviceMetricsOverride');

/* ---- 第三轮：&hud=0 必须真的把弹夹藏起来 ----
   这一条正是本次修掉的那个 bug：`#mag` 原来在 `#hud` 外面 ⇒ `&hud=0` 藏不住它。 */
sec('D. &hud=0 的可见性归属（本次修掉的 bug）');
{
  const url2 = URL_ + (URL_.includes('?') ? '&' : '?') + 'hud=0';
  await send('Page.navigate', { url: url2 });
  const booted = await waitBoot('hud=0');
  ok(booted, '带 &hud=0 的页面已启动');
  const L = await readLayout();
  ok(L.els.mag && !L.els.mag.vis,
     '#mag 跟着 #hud 一起隐藏了（父元素 ' + (L.els.mag ? L.els.mag.parent : '?') + '，' +
     (L.els.mag ? ('display=' + L.els.mag.display + '，祖先链上有 display:none') : '缺') + '）');
  for (const id of ['topleft', 'stamwrap', 'leftcol', 'minimap', 'mapCanvas', 'bottomleft', 'bottomright']) {
    ok(L.els[id] && !L.els[id].vis, '#' + id + ' 也被藏住了');
  }
}

/* ---- 第五轮：**培育舱 HUD** 的摆放（2026-09-23 融合后换的对象）
   ------------------------------------------------------------
   原来这一轮量的是背包里的「繁衍页」（6 槽 3 对）。融合后**繁衍页整套删掉了**，
   改由地图上的太空舱承担（用户选的范围："全盘采用单舱"）⇒ 这一轮跟着换对象，
   护栏不变：舱 HUD 是一块 `position:fixed` 的右侧面板，四个控件里三个可点，
   典型会在**窄/矮窗口**下「压住别的 HUD」或「按钮被挤出视口」——
   那正是无头测试读 innerHTML 永远发现不了的那一类。 */
sec('E. 培育舱 HUD 的真布局');
{
  const url2 = URL_ + (URL_.includes('?') ? '&' : '?') + 'pos=0,14&mag=2&breed=fast';
  await send('Page.navigate', { url: url2 });
  const booted = await waitBoot('pos=0,14');
  ok(booted, '舱前的页面已就绪（?pos=0,14 ⇒ 舱 HUD 应当可见）');

  for (const [tag, w, h] of [['默认视口', 0, 0], ['窄视口', 720, 560]]) {
    if (w) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(400); }
    const R = JSON.parse(await evalJS(`JSON.stringify((() => {
      const rect = e => { if (!e) return null; const r = e.getBoundingClientRect();
        return { x:r.left, y:r.top, w:r.width, h:r.height, right:r.right, bottom:r.bottom }; };
      const id = s => document.getElementById(s);
      return {
        vw: innerWidth, vh: innerHeight,
        hud: rect(id('chamber-hud')),
        hudHidden: id('chamber-hud').hidden,
        fire: rect(id('chamber-fire')), suck: rect(id('chamber-suck')), interact: rect(id('chamber-interact')),
        left: rect(id('chamber-left')), right: rect(id('chamber-right')), cd: rect(id('chamber-countdown')),
        others: ['topleft','mag','topright','stamwrap','bottomleft','bottomright','breedtag']
          .map(k => [k, id(k)]).filter(([, e]) => e && !e.hidden && e.offsetParent !== null)
          .map(([k, e]) => [k, rect(e), getComputedStyle(e).display]),
      };
    })())`));
    console.log('  [' + tag + '] 视口 ' + R.vw + '×' + R.vh +
                '  舱 HUD ' + (R.hud ? Math.round(R.hud.w) + '×' + Math.round(R.hud.h) : '(缺)') +
                '  按钮 ' + [R.fire, R.suck, R.interact].map(b => b ? Math.round(b.w) + '×' + Math.round(b.h) : '缺').join(' / '));

    ok(R.hud && !R.hudHidden, tag + '：舱 HUD 可见（在舱前）');
    ok(R.fire && R.suck && R.interact, tag + '：三个控件都在（投放 / 吸回 / 开始结合）');
    /* 可点尺寸：0 尺寸的元素点不到，而且在真浏览器里看不出异常。 */
    ok([R.fire, R.suck, R.interact].every(b => b && b.w >= 30 && b.h >= 28),
       tag + '：三个控件都有可点尺寸（最小 ' +
       Math.round(Math.min(...[R.fire, R.suck, R.interact].map(b => b.w))) + ' px 宽）');
    /* 承接原来的护栏：**不许压住别的 HUD** —— 而且要用"可见 + 真有尺寸"筛一遍，
       否则 display:none 的 #topright（窄屏会藏）会被当成 0×0 的元素混进来。 */
    {
      const ov = (a, b) => a && b && b[2] !== 'none' && b[1] && b[1].w > 0 && b[1].h > 0 &&
        a.x < b[1].right - 0.5 && b[1].x < a.right - 0.5 && a.y < b[1].bottom - 0.5 && b[1].y < a.bottom - 0.5;
      const hit = R.others.filter(([, , ,], idx) => ov(R.hud, R.others[idx])).map(([k]) => '#' + k);
      ok(hit.length === 0, tag + '：舱 HUD 没有压住别的 HUD 面板（' + (hit.join('；') || '无重叠') + '）');
    }
    ok(R.hud.x >= -0.5 && R.hud.y >= -0.5 && R.hud.right <= R.vw + 0.5 && R.hud.bottom <= R.vh + 0.5,
       tag + '：舱 HUD 完整落在视口内（' + Math.round(R.hud.x) + ',' + Math.round(R.hud.y) +
       ' → ' + Math.round(R.hud.right) + ',' + Math.round(R.hud.bottom) + '）');
    ok(R.left && R.right && R.left.right <= R.right.x + 0.5, tag + '：两个亲代槽位左右并排、不重叠');
    ok(R.cd && R.cd.h >= 16, tag + '：倒计时那一行有高度（' + Math.round(R.cd.h) + ' px）');
    ok(R.fire.right <= R.hud.right + 0.5 && R.fire.x >= R.hud.x - 0.5, tag + '：控件没有横向溢出舱 HUD 面板');
  }
  await send('Emulation.clearDeviceMetricsOverride');
}

/* 控制台 error 汇总 */
const errs = events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error');
if (errs.length) { console.log('\n控制台 error：'); for (const e of errs.slice(0, 10)) console.log('  ' + String(e.params.entry.text).slice(0, 200)); }
ok(errs.length === 0, '页面控制台无 error（' + errs.length + ' 条）');

console.log('\n===== ' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '（' + (pass + fail) + ' 项断言：' + pass + ' 通过 / ' + fail + ' 失败）=====');
await die(fail === 0 ? 0 : 1);
