/**
 * 启动参数（URL 查询串）测试。
 *
 * 为什么单独一份：integration.mjs / input.mjs 都是用 location.search = '' 跑模块，
 * 于是 `?autostart=1&…` 这条**真实入口**从来没被执行过 —— 而它正是截图脚本、
 * 内置预览面板嵌入用法的入口，走的是和正常开场完全不同的分支。
 *
 * 这个盲区已经真出过一次事故：调试块里引用了还没定义的 const（TDZ），
 * 页面直接白屏 + 只显示「脚本错误 / Cannot access 'state' before initialization」，
 * 而 integration / input 全绿。所以这里专门把每个参数都跑一遍。
 *
 * 用法： node test/boot-params.mjs
 */
import { runGame, DRIVER_HEAD, DRIVER_FOOTER } from './harness.mjs';

const SEARCH = '?autostart=1&intro=0&still=1&fly=1&alt=20&stam=40&bag=1&bagpage=1&fill=1&slay=1';

const DRIVER = `
${DRIVER_HEAD}
sec('启动参数 ' + location.search);

ok(started === true, 'autostart=1 → 直接进入世界');
ok(paused === false, 'autostart=1 → 没有被判成暂停');
ok(dragLook === true, 'autostart=1 → 用拖拽视角兜底（不去请求指针锁）');
ok(el('intro').classList.contains('hide') === true, '开场层已隐藏');
ok(el('hud').classList.contains('on') === true, 'HUD 已显示');
ok(debugStill === true, 'still=1 → 模拟冻结');

ok(player.flying === true, 'fly=1 → 处于飞行模式');
const expectY = sampleHeight(player.x, player.z) + 20;
ok(Math.abs(player.y - expectY) < 0.01,
   'alt=20 → 停在地面之上 20 m（y=' + player.y.toFixed(2) + '，期望 ' + expectY.toFixed(2) + '）');
ok(state.stamina === 40, 'stam=40 → 体力 40（实际 ' + state.stamina + '）');

ok(bag.open === true, 'bag=1 → 背包已打开');
ok(el('bag').classList.contains('on') === true, '背包面板可见');
ok(bag.page === 0, '旧 bagpage=1 参数回退到库存');
ok(el('bagPage0').classList.contains('on'), '库存是显示状态');
ok(bagPageEls.length === 1, '只有一个背包页面');

ok(mag.length === 3, 'fill=1 → 弹夹预填 3 只（实际 ' + mag.length + '）');
ok(pals.length === 2, 'fill=1 → 背包 3 只，再被 slay=1 拿走一只 ⇒ 2 只（实际 ' + pals.length + '）');
ok(mag.length + pals.length === 5, 'fill=1 → 预填的 6 只是从弹夹搬了 3 只进背包，不是吸了两次（减掉被屠宰那 1 只）');
/* 下面这几条原来是"fill=1 把图鉴预填 3 个物种 / 信号源进度填到 8 / 两个 HUD 计数同步"。
   信号源与图鉴 2026-09-23 整套删除后，&fill=1 里那三行也一并删了 ⇒ 断言方向翻过来：
   这条启动路径**不许**再把那两个字段写回来（它们是同类改动最容易漏的地方 ——
   调试用的后门往往比主逻辑晚一轮才清干净）。 */
ok(typeof speciesSeen === 'undefined', 'fill=1 不再预填图鉴（speciesSeen 已不存在）');
ok(!('scanned' in state) && !('complete' in state), 'fill=1 不再写信号源进度 / 通关标志');
/* 素材页没了 ⇒ 这条改成"撤干净了"。它同时守着启动路径不会把旧字段又写回来。 */
ok(bag.materials === undefined, 'fill=1 → 不再有 materials（矿/孢子已撤）');

/* &slay=N：新的调试参数，走真实屠宰路径（slayPal('bag', 0)），不是往 corpses 里硬塞。
   玩家此刻在 alt=20 的空中 ⇒ 尸体应该落回地面（y = sampleHeight = 0）。 */
ok(corpses.length === 1, 'slay=1 → 屠宰了 1 只（corpses ' + corpses.length + ' 具）');
ok(animals.length === 57, 'slay=1 → 世界里少了 1 只（58 → ' + animals.length + '）');
ok(corpses[0] && corpses[0].dead === true && corpses[0].g.visible === true,
   'slay=1 → 那具尸体是可见的、标着 dead');
ok(corpses[0]?.slaughterPhase === 'launch', 'slay=1 先开始投射，不会跳过动画直接生成遗体');
for (let i=0;i<100;i++) updateSlaughter(.016);
ok(corpses[0]?.boneBounds?.minY>=sampleHeight(corpses[0].x,corpses[0].z)-.03,
   'slay=1 → 骨头刚体受到地面承托，玩家在空中也不会把骨头留在空中');
ok(el('slayCount').textContent === '1', '屠宰块计数 = 1（页面 ' + el('slayCount').textContent + '）');

const p0 = el('bagPage0').innerHTML || '';
ok(p0.length > 80, '帕鲁页已渲染（' + p0.length + ' 字符）');
ok(!p0.includes('物种图鉴'), '帕鲁页不再有图鉴区块（fill 这条路也没把它写回来）');
/* 注意用 !sp.fly 而不是 sp.fly === false —— 陆生物种的 fly 字段是 undefined，不是 false */
ok(SPECIES_LIST.some(sp => !sp.fly && p0.includes(sp.name)), '帕鲁页列出了弹夹里的物种名');
ok(p0.includes('3 / ' + MAG_MAX), '帕鲁页显示弹夹 3 / ' + MAG_MAX);
ok(p0.includes('2 / ' + BAG_MAX), '帕鲁页显示背包 2 / ' + BAG_MAX);
ok(p0.includes('data-act="all"'), '帕鲁页有「全部转入背包」按钮（弹夹非空时应可点）');
ok(!/data-breed-/.test(p0), '启动参数不会恢复背包繁衍控件');
ok(chamberSystem.status().slots.length === 2, '地图舱仍有两个亲代槽');

ok(el('flytag').classList.contains('on') === false, 'flytag 要跑一帧才刷新（此刻还没跑过 loop）');

/* 背包打开 + still → 主循环跑多久都不该改动状态，也不该抛错 */
let derr = null;
const snap = { y: player.y, stam: state.stamina, n: mag.length };
try { for (let i = 0; i < 120; i++) loop(); } catch (e) { derr = e; }
ok(!derr, '跑 120 帧无异常' + (derr ? '：' + derr.message : ''));
ok(player.y === snap.y, '冻结时玩家高度不变');
ok(state.stamina === snap.stam, '冻结时体力不变');
ok(mag.length === snap.n, '冻结时弹夹不变');

loop();
ok(el('flytag').classList.contains('on') === true, '跑一帧后 HUD 飞行指示亮起');

/* 关掉背包应该能回到正常可玩状态 */
closeBag();
ok(bag.open === false, 'closeBag() 生效');
loop();
ok(player.flying === true, '关掉背包后仍在飞行模式（背包不该顺手把人拽下来）');

${DRIVER_FOOTER}
`;

/* ----------------------------------------------------------------------------
   第二轮：&slay 的**按物种挑**写法（&slay=glb）。
   为什么单开一轮：`q.get('slay')` 只取第一个值，`?slay=1&slay=glb` 拿不到两个。
   ⚠️ 2026-09-23 起这一轮**不再覆盖**"背包里没有就从场上抓一只"那条分支，
      写清楚免得以后误以为覆盖了：
      程序化物种不上场之后，`&fill=1` 的"每物种各取一只"取到的**就是史莱姆**
      ⇒ 背包里已经有带贴图的物种了 ⇒ 挑物种时不需要去场上抓。
      那条分支改由**第三轮**（不带 fill、直接 `&slay=slime-ball`）覆盖。
   ---------------------------------------------------------------------------- */
const SEARCH2 = SEARCH.replace('slay=1', 'slay=glb');

const DRIVER2 = `
${DRIVER_HEAD}
sec('&slay=glb（按物种挑：带贴图的史莱姆）');
ok(corpses.length === 1, '宰掉了 1 只（corpses ' + corpses.length + '）');
ok(corpses[0] && !!corpses[0].species.glb === true,
   '宰的确实是**带贴图**的物种：' + (corpses[0] ? corpses[0].species.key : '(没有)') +
   '（注意 glb 是**模型名字符串**不是布尔：' +
   (corpses[0] ? JSON.stringify(corpses[0].species.glb) : '-') + '）');
ok(animals.length === 57, '世界里少了 1 只（58 → ' + animals.length + '）');
/* 守恒断言：fill 造出 弹夹 3 + 背包 3 = 6 只在手里，宰掉 1 只 ⇒ 手里还剩 5。
   **不写死 3 / 3** —— 写死会把"从哪只手里扣的"也钉进去，
   而那属于 &fill 的实现细节（本轮正因为 fill 的取法变了而失效过一次）。 */
ok(mag.length + pals.length === 5,
   '手里的只数守恒（fill 造 6 只，宰掉 1 只 ⇒ 5）：弹夹 ' + mag.length + ' / 背包 ' + pals.length);
ok(pals.length === 2, '被宰的那只是从背包里拿走的（背包 3 → ' + pals.length + '）');
{
  const mats = [];
  corpses[0].g.traverse(o => { if (o.isMesh) mats.push(o.material); });
  ok(mats.length > 0 && mats.every(m => !m.map || m.map.isCanvasTexture === true),
     '它的贴图换成了新建的 canvas 副本（灰度就是画在这上面的）');
}
${DRIVER_FOOTER}
`;

/* ----------------------------------------------------------------------------
   第三轮：**不带 fill**，直接按物种宰一只 —— 专门覆盖
   "背包里没有就从场上抓一只放进背包再宰"那段（&slay=<key> 的兜底分支）。
   为什么必须单独一轮：`&slay` 只取第一个值，没法在同一轮里既测数字写法又测这条兜底；
   而且这条兜底曾经**静默失效**过（装配时序：史莱姆还没建好就开始挑），
   是本项目"看着像逻辑错、其实是时序错"的典型案例，值得一直盯着。
   ---------------------------------------------------------------------------- */
const SEARCH3 = '?autostart=1&intro=0&still=1&slay=slime-ball';

const DRIVER3 = `
${DRIVER_HEAD}
sec('&slay=<key> 的兜底：场上抓一只再宰（不带 fill）');
ok(mag.length === 0 && pals.length === 0, '起点确实是空的（弹夹 ' + mag.length + ' / 背包 ' + pals.length + '）');
ok(corpses.length === 1, '还是宰掉了 1 只（corpses ' + corpses.length + '）');
ok(corpses[0] && corpses[0].species.key === 'slime-ball',
   '宰的是指定物种：' + (corpses[0] ? corpses[0].species.key : '(没有)'));
ok(animals.length === 57, '世界里少了 1 只（58 → ' + animals.length + '）');
/* 抓来的那只当场就被宰了 ⇒ 手里应该回到空。这三条一起说明
   "抓 → 搬进背包 → 宰"整条路真的走完了，而不是"直接往 corpses 里塞了一具"。 */
ok(mag.length === 0 && pals.length === 0,
   '抓来的那只被宰掉后手里回到空（弹夹 ' + mag.length + ' / 背包 ' + pals.length + '）');
${DRIVER_FOOTER}
`;

/* ----------------------------------------------------------------------------
   第四轮：&breed=fast —— 从**真实的启动参数入口**把整条繁衍走完。
   为什么单开一轮：integration 的 12d 是**直接调** startMate / takeBaby，
   证明得了状态机，证明不了"页面上那个按钮真的接到了它"。
   这里用合成 click（target 只要回答 closest()）+ 真实委托，把接线也一起测了。
   ⚠️ 这一轮**不带 &still=1**：截图冻结也冻结繁衍倒计时（见主循环的理由），
      带着 still 的话倒计时永远不会走。
   ⚠️ 也**不带 bag=1**：要用 closeBag/openBag 之外的真实路径就不需要它，
      而且开着面板时 `bag.open` 会挡住一部分状态判断。这里靠 setBagPage 切页。
   ---------------------------------------------------------------------------- */
const SEARCH4 = '?autostart=1&intro=0&pos=0,14&mag=2&breed=fast';

const DRIVER4 = `
${DRIVER_HEAD}
sec('&breed=fast + 地图舱真实输入接线');
ok(BREED_MS === 0, '&breed=fast 把倒计时压成 0 秒（实际 ' + BREED_MS + ' 毫秒）');
ok(mag.length === 2 && pals.length === 0, 'mag=2 从世界捕获两只到弹夹');
camera.position.set(player.x, EYE, player.z);
for (const x of [1.64, -1.64]) {
  camera.lookAt(x, 2.6, 23); camera.updateMatrixWorld(true);
  pressKey('KeyG'); releaseKey('KeyG');
}
ok(mag.length === 0 && breeding.slots.slice(0,2).every(Boolean), 'G 将弹夹首项分别投入第一座舱的两槽');
ok(chamberSystem.status().phase === 'sealing', '第二只投入后自动密封');
ok(!!breeding.pairs[0].genome, '开始时准备本轮基因候选');
const planned = breeding.pairs[0].genome.slice();
for (let i = 0; i < 30; i++) chamberSystem.tick(.05);
ok(chamberSystem.status().phase==='irradiating','密封后进入辐射阶段');
fire('chamber-interact','click');
breedAdvance(1);
chamberSystem.tick(.05);
ok(chamberSystem.status().phase === 'ready' && chamberSystem.status().view.closed
  && chamberSystem.status().view.observationWindow, 'ready 时观察窗舱门仍保持关闭');
ok(el('chamber-interact').disabled === false, 'HUD 开始按钮可用');
pressKey('KeyE'); releaseKey('KeyE');
ok(chamberSystem.cinematic, 'E 开始完整结合演出');
pressKey('KeyB'); releaseKey('KeyB');
ok(!bag.open, '演出期间不能打开背包');
fireKey('keydown', 'Space', {repeat:true});
ok(chamberSystem.status().performance.presses === 0, '键盘长按不计数');
for (let i = 0; i < 10; i++) { pressKey('Space'); releaseKey('Space'); }
ok(chamberSystem.status().performance.state === 'surge', '十次空格后进入强化');
for (let i = 0; i < 1600 && chamberSystem.cinematic; i++) chamberSystem.tick(1/60);
ok(chamberSystem.status().phase === 'complete', '完整影片后才结束');
const baby = chamberSystem.child;
ok(!!baby && JSON.stringify(baby.genome) === JSON.stringify(planned), '后代基因与本轮预定一致');
ok(!!baby?.cyl && baby.cyl.r > 0, '真实后代有圆柱碰撞体');
ok(mag.length === 0 && pals.length === 0, '出生后等待玩家领取');
for (let i = 0; i < 60; i++) chamberSystem.tick(1/60);
camera.lookAt(0, 2.2, 21.4); camera.updateMatrixWorld(true);
pressKey('KeyF'); releaseKey('KeyF');
ok(mag.includes(baby) && !chamberSystem.child, 'F 将后代收进弹夹');
ok(breeding.slots.slice(0,2).every(Boolean), '两亲代仍留在第一座舱内');
ok(chamberSystem.status().phase === 'loading', '领取后可以再次孕育');
${DRIVER_FOOTER}
`;

const SEARCH5 = '?autostart=1&intro=0&breed=2';
const DRIVER5 = `${DRIVER_HEAD}
ok(BREED_MS === 2000, '数值 breed=2 精确转为2000毫秒');
${DRIVER_FOOTER}`;

let failed = false;
for (const [src, search] of [[DRIVER, SEARCH], [DRIVER2, SEARCH2], [DRIVER3, SEARCH3], [DRIVER4, SEARCH4], [DRIVER5, SEARCH5]]) {
  console.log('\n########## ' + search + ' ##########');
  try {
    await runGame(src, { search });
  } catch (err) {
    console.log('\n运行失败：' + (err && err.message));
    failed = true;
  }
}
console.log(failed ? '\n>>> 启动参数测试有失败 <<<' : '\n>>> 启动参数测试全部通过 <<<');
process.exit(failed ? 1 : 0);
