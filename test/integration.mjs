/**
 * 集成测试（无需浏览器）：用真实 three.js 跑完整游戏模块。
 * 覆盖：vendor 依赖闭包、场景构建、userData 完整性、主循环长时间稳定性、
 * 玩家移动/跳跃、观测与采集、完成条件。
 *
 * 输入与 UI 接线（keydown 监听器、指针锁降级、拖拽视角）见 test/input.mjs。
 * 用法： node test/integration.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { runGame, DRIVER_HEAD, DRIVER_FOOTER, ROOT } from './harness.mjs';

/* ============================================================
   0. vendor 依赖闭包（静态检查，在 Node 里做，不属于游戏模块）
   只下载主文件会漏掉拆包出来的兄弟文件 → 本地静默加载失败、回退 CDN
   ============================================================ */
let outerFails = 0;
const print = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) outerFails++; };
console.log('\n=== 0. vendor 依赖闭包 ===');

function vendorClosure(entry) {
  const seen = new Set(), missing = [];
  (function walk(f) {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\s*["'](\.[^"']*)["']/g)) {
      const t = path.resolve(path.dirname(f), m[1]);
      if (!fs.existsSync(t)) missing.push(path.relative(ROOT, t));
      else walk(t);
    }
  })(entry);
  return { files: [...seen], missing };
}

const entryFile = path.join(ROOT, 'vendor', 'three.module.min.js');
print(fs.existsSync(entryFile), 'vendor/three.module.min.js 存在');
if (fs.existsSync(entryFile)) {
  const { files, missing } = vendorClosure(entryFile);
  console.log('  依赖文件: ' + files.map(f => path.relative(ROOT, f)).join(', '));
  console.log('  合计: ' + (files.reduce((a, f) => a + fs.statSync(f).size, 0) / 1024).toFixed(0) + ' KB');
  print(missing.length === 0, '本地依赖闭包完整（缺失: ' + (missing.join(', ') || '无') + '）');
}
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of htmlSrc.matchAll(/import\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
  print(fs.existsSync(path.resolve(ROOT, m[1])), '网页引用的本地资源存在: ' + m[1]);
}

/* ============================================================
   0b. HUD 静态结构 vs 源码常量（跨文件一致性，纯静态检查）
   ------------------------------------------------------------
   弹夹**格数**写在 HTML 里、**容量**写在 JS 里，两边必须一致。
   这是一处典型的"改了一边忘了另一边"的坑，而且几乎不可能靠肉眼发现：
   HUD 少画一格不会报错，只会在装满时少亮一个点。
   ============================================================ */
console.log('\n=== 0b. HUD 静态结构 ===');
{
  const magMax = Number((htmlSrc.match(/const MAG_MAX\s*=\s*(\d+)/) || [])[1]);
  const pips = (htmlSrc.match(/<div class="pips" id="magPips">([\s\S]*?)<\/div>/) || ['', ''])[1];
  const n = (pips.match(/<i><\/i>/g) || []).length;
  print(Number.isFinite(magMax) && magMax > 0, '从 index.html 读到 MAG_MAX = ' + magMax);
  print(n === magMax, 'HUD 弹夹格数 = MAG_MAX（HTML 里 ' + n + ' 格 / JS 里 ' + magMax + '）');

  /* 页签改名与屠宰块都是**静态 HTML**里的东西，运行时那句 renderBag() 看不到它们，
     所以只能在这里读源码文本。顺带把"旧名不许残留"也钉住 —— 改名的需求最容易
     只改一半（比如只改了 renderBag 里的标题，页签还写着「素材」）。 */
  print(!/id="(?:bagTab0|bagTab1|bagPage1|palMenu)"/.test(htmlSrc), '背包繁衍页签和右键入口已删除');
  print(htmlSrc.includes("await import('./chamber-system.mjs')"), '源码加载地图太空舱');
  print(/<div class="slab"[^>]*data-zone="slay"/.test(htmlSrc), '屠宰块带着 data-zone="slay"（拖放委托靠它认落点）');
  print(/id="slayCount"/.test(htmlSrc), '屠宰块里有计数位 id="slayCount"');
  print(!/id="pick"/.test(htmlSrc), '旧的拾取提示 HUD（id="pick"）已删除');

  /* ---- HUD 重排（2026-09-23）：弹夹 ↔ 体力条对调、罗盘/两个读数删掉 ----
     为什么这些要放在**静态检查**里：它们全都是"HTML 里有/没有"的事实，
     运行时的 driver 看不到（元素被删掉后 el() 只会返回 null，不报错）。
     而"删一半"是这类改动的典型事故：CSS 删了、DOM 还在，肉眼与断言都看不出来。 */
  print(/id="stamwrap"/.test(htmlSrc), '底部体力条 id="stamwrap" 存在');
  print(!/id="compass"/.test(htmlSrc), '罗盘 id="compass" 已删除');
  print(!/id="prompt"/.test(htmlSrc), '交互气泡 id="prompt" 已删除（它只服务按 E 的两个系统）');
  print(!/id="done"/.test(htmlSrc), '通关横幅 id="done" 已删除');
  print(!/id="scanCount"|id="specCount"|id="scanTotal"|id="specTotal"/.test(htmlSrc),
        '信号源 / 图鉴的 HUD 计数元素已全部删除');
  print(!/id="wind"|id="sunAlt"/.test(htmlSrc), '地表风速 / 恒星高度两个读数已删除');
  /* ⚠️ 这一条是**顺手修掉的旧 bug 的守卫**：
     弹夹原来挂在 #hud **外面**（body 的直接子节点），而 &hud=0 只是把 #hud 设成
     display:none ⇒ 此前所有"取干净画面"的截图里一直挂着一颗弹夹药丸。
     搬进 #hud 之后它才真的跟着 HUD 一起显隐；哪天有人把它挪出去，这条会响。 */
  {
    const hud = htmlSrc.slice(htmlSrc.indexOf('<div id="hud">'), htmlSrc.indexOf('<div id="vignette">'));
    const magAt = hud.indexOf('<div id="mag"'), stamAt = hud.indexOf('<div id="stamwrap"'), toastAt = hud.indexOf('<div id="toast"');
    print(magAt > 0 && stamAt > magAt && toastAt > stamAt,
          '#hud 内的顺序是 …#mag…→…#stamwrap…→…#toast…（弹夹搬进 HUD 了，不再挂在外面）');
    print((htmlSrc.match(/id="mag"/g) || []).length === 1, '全场只有一个 #mag（没有搬一半留一半）');
    print(/<div id="mag"><em>/.test(hud) && !/class="panel"[^>]*id="mag"/.test(hud), '#mag 是裸元素、不带 panel 底框');
  }

  /* ---- 2026-09-23 新增：小地图在 #hud 内、且在左下角面板**上方** ----
     小地图是"放在现在的方框上方"（用户原话）。这里只能查**文档顺序 + 同一个列容器**，
     真实的上下位置要靠 _probe_hud.mjs 量矩形 —— 静态检查抓不到 CSS 摆位。
     为什么要查"在 #hud 内"：不在的话 `&hud=0` 藏不住它（弹夹刚踩过这个坑）。 */
  print(/<div id="minimap"><canvas id="mapCanvas"/.test(htmlSrc), '小地图元素 #minimap + #mapCanvas 存在');
  {
    const hud = htmlSrc.slice(htmlSrc.indexOf('<div id="hud">'), htmlSrc.indexOf('<div id="vignette">'));
    const mapAt = hud.indexOf('id="minimap"'), blAt = hud.indexOf('id="bottomleft"');
    print(mapAt > 0 && blAt > mapAt, '#minimap 在文档里排在 #bottomleft **之前**（同一列里因此在上方）');
    print(/<div id="leftcol">/.test(hud), '两者包在同一个列容器 #leftcol 里（靠 flex 排版，不写死偏移）');
    print(/id="mapCanvas"[^>]*width="220"[^>]*height="220"/.test(hud), '小地图画布是 220×220 的正方形绘制坐标系');
  }
  print(/aspect-ratio:1\/1/.test(htmlSrc), 'canvas 有显式 aspect-ratio:1/1（否则会按 HTML 属性撑成长方形）');

  /* ---- 「所有生物共用一条弹跳路」的结构守卫 ----
     用户要求"无论什么外形的生物移动都用史莱姆的拉伸弹跳"。
     场上只有一种外形，**没法用两个形状做对照实验**，所以只能守结构：
     帧循环里不许出现"按步态/物种分支"的代码 —— 存在分支就等于"有些外形走别的路"。
     这条是静态文本检查（driver 那个作用域里没有 htmlSrc，所以必须放在这里）。 */
  print(!/ud\.gait\s*===/.test(htmlSrc), 'updateAnimals 里没有按步态分支（全部陆生生物共用同一条弹跳路）');
  print(/function applyBodyScale\(ud,\s*sy,\s*sxz\)/.test(htmlSrc), '形变只经由 applyBodyScale(ud, sy, sxz) —— 参数里没有任何形状信息');
  /* ⚠️ 这里**故意不**断言 "hopT 字段已经没了"：
     第一版写成 print(!/ud\.hopT\s*=/.test(htmlSrc), ...)，结果那个正则命中了
     **注释里**引用的那句原代码（"它原来是 ud.hopT = rndAnimal() * 2.6;"）——
     断言在检查自己的注释，是个假 FAIL。要判"字段确实没了"得先剥注释，不值得。
     真正要守的是"**那一次随机数抽取还在**"，那件事由第 1 节的世界布局哨兵兜底：
     抽少了，程序化物种一放回场上落点就会整体前移一位。 */
}

/* ============================================================
   1+. 驱动游戏模块
   ============================================================ */
const DRIVER = `
${DRIVER_HEAD}

sec('1. 场景构建');
let buildErr = null;
const meshCount = (() => { let n = 0; try { scene.traverse(o => { if (o.isMesh || o.isPoints || o.isSprite) n++; }); } catch (e) { buildErr = e; } return n; })();
ok(!buildErr, '场景可遍历' + (buildErr ? '：' + buildErr.message : ''));
console.log('  场景直属子节点 = ' + scene.children.length + ' | 可渲染对象 = ' + meshCount);
ok(meshCount > 60, '可渲染对象 >60（实际 ' + meshCount + '）');
/* ⚠️ 这个阈值从 150 降到 60 是**必然的**，不是放松要求：
   原来 150+ 是因为场上有 33 只程序化动物、每只由好几个基础体拼成；
   现在只生成导入的两种史莱姆（40 只，每只 1 个 Mesh）⇒ 剩下的就是
   地形 + 9 种植被/岩石 + 7 件营地 + 天空 + 浮尘。
   要守的那件事（"场景里确实有东西"）由下面几条具体的账目断言承担。 */
/* 33 只程序化 + 8 只史莱姆（原来）。2026-09-23 起：程序化物种保留代码但**不上场**，
   场上只有导入的两种史莱姆，每种 20 只。分开写清构成，别只留一个 40。 */
{
  const slimeN = animals.filter(a => a.species.glb).length;
  const procN = animals.length - slimeN;
  console.log('  动物构成 = 程序化 ' + procN + ' 只 + 史莱姆 ' + slimeN + ' 只');
  ok(procN === 0 && slimeN === 58, '动物 58 只，全部是导入的（程序化 ' + procN + ' + GLB ' + slimeN + '）');
}
/* 这一行原来是「信号源 12 个」。信号源整套删掉后，改成守"场景里确实没有信标实体"，
   而**不是**连断言一起删 —— 删掉的话，将来有人把信标加回来这里也不会响。
   判据用"场景里有没有八面体/光晕"（下面那句 mesh 计数）加上"代码里还有没有信号源对象"。
   注意 signalBlanks（12 个坐标）**必须仍在**，但它是纯数据、不生成任何对象 ——
   第 5 节会把它和 signalAvoid 一起钉住。 */
/* 程序化物种：**代码保留、场上不生成**（用户 2026-09-23 选的是"保留代码"）。
   两个方向都守 —— 表里还在（将来能放回去），场上没有（当前的要求）。 */
{
  const proc = SPECIES_LIST.filter(sp => !sp.glb);
  ok(proc.length === 5 && proc.every(sp => sp.spawn === false),
     '5 个程序化物种仍登记在表里、且全部标了 spawn:false（' +
     proc.map(sp => sp.key + ':' + sp.spawn).join(' ') + '）');
  ok(proc.every(sp => typeof sp.build === 'function'),
     '它们的建模函数还在（删掉那一行 spawn:false 就能放回场上）');
  const spawnable = SPECIES_LIST.filter(sp => sp.spawn !== false);
  ok(spawnable.length === 8 && spawnable.every(sp => sp.glb),
     '生成 8 种导入生物（' + spawnable.map(s => s.key).join(', ') + '）');
}
ok(typeof signalObjs === 'undefined', '信号源对象数组已删（不是留了个空数组）');
ok(typeof signals === 'undefined', 'signals 坐标数组这个名字已彻底改掉（现名 signalBlanks）');
ok(terrain.geometry.attributes.position.count > 1000, '地面网格已生成');
/* 平地断言：这是「改成平地」这条需求的核心可核证据 —— 任何一个顶点抬起来都该失败 */
{
  const p = terrain.geometry.attributes.position;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < p.count; k++) { const y = p.getY(k); if (y < lo) lo = y; if (y > hi) hi = y; }
  console.log('  地面顶点高度范围 = ' + lo + ' ~ ' + hi + '（顶点数 ' + p.count + '）');
  ok(lo === 0 && hi === 0, '地面是平的（所有顶点 y 恒为 0）');
  ok(sampleHeight(37, -84) === 0 && sampleHeight(-99, 99) === 0, 'sampleHeight 在任何位置都返回 0');
  ok(slopeAt(12, -50) === 0, 'slopeAt 恒为 0（平地无坡）');
}
ok(scene.fog && scene.fog.density > 0, '雾已设置');
ok(!!globalThis.__loop, '主循环已注册');
ok(bag.materials === undefined, '背包上已经没有 materials 了（矿/孢子整个撤掉）');
ok(corpses.length === 0 && Array.isArray(corpses), '开局没有尸体（corpses 为空数组）');

/* ⚠️ 世界布局哨兵 —— 这一条是给后来人看的。
   8b 节的矿/孢子被撤掉时，**故意保留**了 scatter 调用与每件 3 次 rndWorld()
   作为"随机数配重"（理由见 index.html 8b 节的长注释）。
   如果有人"顺手清理"掉那几行，rndWorld 的消费位置会整体前移，
   下游（植被 101 株 / 营地 7 件）会**静默重排** ——
   断言可能仍全绿，但地图已经换了一张。
   所以这里钉死几个由 rndWorld 决定的具体值：它们一变，这里立刻响。

   ⚠️ 注意**哪条属于哪条流**，别把两件事混在一起（2026-09-23 补注）：
     · 营地中心 / 植被 101  → 来自共享流 rndWorld（SEED+991），是真正的"漂移哨兵"；
     · 史莱姆只数 / 动物总数 → 史莱姆走**另一条独立流** mulberry32(SEED+808)，
       程序化物种走 SEED+4242。所以它们**不是** rndWorld 的漂移哨兵，
       而是"内容账目"：本轮把数量从 8 改成 40 是有意的，
       这两条**必然**要跟着改 —— 改它们不等于哨兵失效。
   AssetPack 接入后营地等待植被完成，再按实测占地选址；
   中心为 (0.33, 63.86)，避免与植被相交。树已恢复原模型，植被仍为 101 个。 */
{
  const camp = campStats.center;
  ok(campStats.models === 7 && campStats.failed.length === 0, '营地 7 件全部装配（' + campStats.models + '）');
  ok(Math.abs(camp.x - 0.33) < 0.01 && Math.abs(camp.z - 63.86) < 0.01,
     '新植被避让后营地中心固定为 (0.33, 63.86)（实测 ' + camp.x.toFixed(2) + ', ' + camp.z.toFixed(2) + '）');
  ok(propStats.instances === 101, '随机流未漂移：植被/岩石实例数仍是 101（实测 ' + propStats.instances + '）');
  ok(slimeStats.instances === 58, '导入生物 58 只（史莱姆各 20、新增六种各 3）');
  ok(animals.length === 58, '动物总数 58；程序化物种不上场');
  /* 史莱姆落点用 s 锚一个：slime-ring 前 4 只在数量变化后**落点不变**
     （它们消费的还是流的最前面那几次），第 5 只开始才会分化。
     钉住第 0 只 ⇒ 既守"流没被额外消费"，也不会因为"数量改了"而误报。 */
  {
    const s0 = animals.find(a => a.species.key === 'slime-ring');
    console.log('  slime-ring#0 落点 = (' + s0.x.toFixed(2) + ', ' + s0.z.toFixed(2) + ')  baseScale=' + s0.baseScale.toFixed(3));
    ok(Math.abs(s0.x - (-11.8)) < 0.05 && Math.abs(s0.z - 69.4) < 0.05,
       '史莱姆流未漂移：slime-ring#0 仍在 (-11.8, 69.4)（实测 ' + s0.x.toFixed(2) + ', ' + s0.z.toFixed(2) + '）');
  }
}

sec('2. 动物 userData 完整性');
const need = { walk: ['legs'], hop: ['hind', 'body'] };
const missing = [];
for (const a of animals) {
  const ud = a.g.userData;
  if (!ud.kind) missing.push('kind');
  if (ud.kind === 'land') {
    if (!ud.gait) missing.push('gait');
    (need[ud.gait] || []).forEach(k => { if (!ud[k]) missing.push(ud.gait + '.' + k); });
    if (typeof ud.speed !== 'number') missing.push(ud.gait + '.speed');
  } else {
    if (!ud.wings || ud.wings.length !== 2) missing.push(ud.kind + '.wings');
    if (typeof ud.radius !== 'number' || !(ud.radius > 0)) missing.push(ud.kind + '.radius');
    if (typeof ud.alt !== 'number') missing.push(ud.kind + '.alt');
  }
}
ok(missing.length === 0, 'userData 字段齐备（缺失: ' + (missing.join(', ') || '无') + '）');

/* 边界：四肢/翼不能整段藏进身体包围盒 —— 这是低模动物最容易犯的错 */
const bb = o => { o.geometry.computeBoundingBox(); return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); };
let hiddenLegs = [];
for (const a of animals) {
  const ud = a.g.userData;
  if (ud.kind !== 'land') continue;
  if (ud.gait === 'walk') {
    for (const L of ud.legs) {
      const lb = bb(L.pivot.children[0]);
      if (lb.max.y < 0.06) hiddenLegs.push(a.species.key + ' 腿没踩到地(maxY=' + lb.max.y.toFixed(2) + ')');
    }
  } else if (ud.gait === 'hop') {
    for (const p of ud.hind) {
      const foot = bb(p.children[1]);
      if (foot.max.y < 0.06) hiddenLegs.push('hopper 脚悬空(maxY=' + foot.max.y.toFixed(2) + ')');
    }
  }
}
ok(hiddenLegs.length === 0, '所有陆生动物的脚都踩到地面（' + (hiddenLegs.join('; ') || '无问题') + '）');
/* ⚠️ 上面这条现在是**空覆盖**：场上只有史莱姆，它们是 gait='squash'、既没有 legs
   也没有 hind，循环里两只分支都进不去。留着它是给"哪天把程序化物种放回场上"用，
   但**必须显式说出"现在是空的"**，否则"全绿"会被误读成"腿的几何被测过了"。 */
{
  const withLegs = animals.filter(a => a.g.userData.gait === 'walk');
  const withHind = animals.filter(a => a.g.userData.gait === 'hop');
  const gaits = [...new Set(animals.map(a => a.g.userData.gait))].sort();
  console.log('  场上步态分布 = [' + gaits.join(', ') + ']｜walk ' + withLegs.length + ' 只｜hop ' + withHind.length + ' 只');
  ok(withLegs.length === 0 && withHind.length === 0,
     '带四肢/后肢的生物 0 只 ⇒ 上面"脚踩到地"是空覆盖（程序化物种不上场）');
}

sec('3. 主循环 900 帧（15 秒）');
started = true;
let loopErr = null;
const T0 = Date.now();
try { for (let i = 0; i < 900; i++) loop(); } catch (e) { loopErr = e; }
ok(!loopErr, '主循环无异常' + (loopErr ? '：' + loopErr.message : ''));
if (loopErr) console.log(loopErr.stack.split('\\n').slice(0, 5).join('\\n'));
const ms = Date.now() - T0;
console.log('  900 帧逻辑耗时 ' + ms + ' ms（' + (ms / 900).toFixed(2) + ' ms/帧，纯 CPU）');
ok((globalThis.__renders || 0) >= 900, 'render 被调用 ' + (globalThis.__renders || 0) + ' 次');

sec('4. 15 秒后的世界状态');
const land = animals.filter(a => a.g.userData.kind === 'land');
const flyers = animals.filter(a => a.g.userData.kind !== 'land');
const maxR = Math.max(...land.map(a => Math.max(Math.abs(a.x), Math.abs(a.z))));
console.log('  陆地动物离场地中线最远 = ' + maxR.toFixed(1) + '（空气墙在 ' + ARENA + '，动物自留 0.94 余量 → ' + (ARENA * 0.94).toFixed(1) + '）');
ok(maxR <= ARENA * 0.94 + 0.6, '无动物越界');
ok(animals.every(a => Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.y)), '动物坐标始终有限');
ok(animals.every(a => Number.isFinite(a.g.position.x) && Number.isFinite(a.g.position.y) && Number.isFinite(a.g.position.z)), '网格 position 有限');
ok(animals.every(a => Number.isFinite(a.g.rotation.y)), '朝向有限');
/* ⚠️ 飞行 / 步行腿 这两组断言现在**覆盖面是空的**：场上只有史莱姆
   （kind='land'、没有 wings、没有 legs）。空数组的 .every() 恒为 true ——
   那正是"装饰品断言"的典型形态（全绿但什么都没验）。所以：
   把"当前确实是空的"写成**显式断言**，并且在变非空时把数字打出来。 */
ok(flyers.length === 0, '飞行生物 0 只（程序化飞行物种不上场）⇒ 下面离地高度那条是空覆盖');
if (flyers.length) {
  const hover = flyers.map(a => a.y - sampleHeight(a.x, a.z));
  console.log('  飞行者离地 ' + Math.min(...hover).toFixed(1) + ' ~ ' + Math.max(...hover).toFixed(1) + ' m');
  ok(flyers.every((a, i) => hover[i] > 2), '飞行者离地 >2m');
}
const walkers = land.filter(a => a.g.userData.legs);
ok(walkers.length === 0, '带腿的动物 0 只 ⇒ 腿摆动那条是空覆盖');
if (walkers.length) {
  ok(walkers.every(a => Math.abs(a.g.userData.legs[0].pivot.rotation.x) > 0.005), '所有步行兽的腿都在摆动');
}
ok(camera.position.y > sampleHeight(player.x, player.z) - 1, '相机在地表之上');

sec('5. 按 E 的两个系统（信号源 / 物种图鉴）—— 已整套移除');
/* 【这一节原来是三节：5 观测动物（按 E）、6 采集信号源、7 完成条件】
   2026-09-23 用户要求把"资源和相关收集"整个去掉，并在追问下明确选了
   **两个都去掉** —— 即"按 E 观测物种（图鉴）"与"按 E 采集 12 处信号源"整套删除；
   通关遮罩那问也选了"一起去掉"。所以现在**全场没有通关条件**，是沙盒。
   于是这一节的断言方向整体翻过来：不是"按 E 会发生什么"，而是"这套东西确实撤干净了"。
   ⚠️ 为什么不留着旧断言改成 skip：留着 skip 的断言会在下一次有人"顺手清理"时
   被当成噪音删掉，而这里正是最需要守卫的地方（删了这一堆，玩家手里的交互就少了一半）。 */
ok(typeof tryScan === 'undefined', 'tryScan() 已删（E 键原来的处理器）');
ok(typeof setDone === 'undefined', 'setDone() 已删（通关横幅的入口）');
ok(typeof speciesSeen === 'undefined', 'speciesSeen 记账表已删（图鉴的账本）');
ok(typeof beepScan === 'undefined' && typeof beepDone === 'undefined',
   'beepScan() / beepDone() 已删（只服务这两个系统的音效）');
ok(typeof STAM_GAIN_SIGNAL === 'undefined' && typeof STAM_GAIN_SPECIES === 'undefined',
   '两条大额即时回气常量已删（采集 +30 / 观测 +12）');
ok(!('near' in state) && !('nearAnimal' in state), 'state 上不再有 near / nearAnimal（按 E 的目标槽）');
ok(!('scanned' in state) && !('complete' in state), 'state 上不再有 scanned / complete');
ok(!('wind' in state) && !('windT' in state), 'state 上不再有 wind / windT（地表风速读数已删）');
{
  const ks = Object.keys(state).sort().join(',');
  console.log('  state 字段 = ' + ks);
  ok(ks === 'sprinting,stamina', 'state 只剩真正有读者的两个字段（' + ks + '）');
}
/* ⚠️ 这一条**方向相反**，是刻意放在一起做对照的：
   图鉴撤了，但 SPECIES_LIST **必须还在** —— 它不只是图鉴，
   动物的物种 / 数量 / 体型区间 / 是否飞行 / glb 模型名全在这张表里，
   是第 9 节建 41 只动物的唯一依据。删了它动物就全没了。 */
ok(SPECIES_LIST.length === 13 &&
   SPECIES_LIST.every(sp => sp.key && sp.name && sp.count > 0) &&
   SPECIES_LIST.reduce((a, sp) => a + sp.count, 0) === 91,
   'SPECIES_LIST 仍在（13 个物种；count 之和 91 = 未生成的程序化 33 + 导入 58）');

/* E 键必须**真的解绑**，而不是绑了个空函数 —— 后者会留下一个假的接线口。
   判据：按住 E 跑几帧，弹夹 / 尸体 / 场景对象数都不许动，体力也不许出现"大额回气"。
   （不断言"体力完全不变"：站定时体力本来就在按 STAM_REGEN_IDLE 回气。） */
{
  player.x = 0; player.z = 0; player.vx = player.vz = 0; player.vy = 0;
  player.y = sampleHeight(0, 0); player.onGround = true; player.flying = false;
  state.stamina = 50; state.sprinting = false;
  const before = { mag: mag.length, corpses: corpses.length, kids: scene.children.length };
  pressKey('KeyE'); for (let i = 0; i < 3; i++) loop(); releaseKey('KeyE');
  console.log('  按住 E 3 帧后体力 = ' + state.stamina.toFixed(2) + '（起点 50）');
  ok(state.stamina < 51 && state.stamina >= 49.9,
     '按 E 没有触发任何大额回气 / 消耗（50 → ' + state.stamina.toFixed(2) + '）');
  ok(mag.length === before.mag && corpses.length === before.corpses,
     '按 E 不改弹夹、不造尸体');
  ok(scene.children.length === before.kids, '按 E 不往场景里加对象（场景 ' + before.kids + ' 个直属子节点）');
}
/* 保留下来的是那 12 个"空位"坐标 —— 纯随机数配重，见第 1 节的布局哨兵。
   signalBlanks 只提供坐标、signalAvoid 只给 8c / 8d 当避让锚点，**都不生成任何对象**。
   （这一条和第 1 节哨兵是同一件事的两面：那边守"随机流没漂移"，这边守"留下来的这两样
   确实还在、形状也没变"。少一个 signalAvoid 里的 r，8c 的避让判据就会静默放宽。） */
ok(Array.isArray(signalBlanks) && signalBlanks.length === 12,
   '空位仍是 12 个（随机数配重，实际 ' + (signalBlanks || []).length + '）');
ok(signalBlanks.every(s => Number.isFinite(s.x) && Number.isFinite(s.z)), '空位坐标有限');
ok(Array.isArray(signalAvoid) && signalAvoid.length === 12 && signalAvoid.every(a => a.r === 6),
   'signalAvoid 仍是 12 条 r=6 的避让锚点（8c 植被 / 8d 营地都在用）');

sec('8. 长时稳定性（再 1800 帧）');
let e3 = null;
try { for (let i = 0; i < 1800; i++) loop(); } catch (e) { e3 = e; }
ok(!e3, '1800 帧无异常' + (e3 ? '：' + e3.message : ''));
ok(animals.every(a => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)), '长时运行后动物坐标仍有限');
ok(Number.isFinite(player.x) && Number.isFinite(player.y), '玩家坐标有限');
ok(state.stamina >= 0, '体力不为负（' + state.stamina.toFixed(1) + '）');

sec('9. 矿/孢子/星岩 —— 已整套移除（8b 节现在只剩"随机数配重"）');
/* 这一节原来是"素材散布 + 自动拾取"。矿（辉光晶核）/孢子囊/星岩碎片整个撤掉后，
   这里改成**守着"撤干净了"**，同时守着"配重还在"。
   为什么两件都要守：配重少一行，下游整张地图静默重排（见第 1 节的布局哨兵）。 */
ok(bag.materials === undefined, '背包上不再有 materials 字段');
ok(typeof collectMaterials === 'undefined', 'collectMaterials() 已删');
ok(typeof updatePickables === 'undefined', 'updatePickables() 已删');
ok(typeof flashPick === 'undefined', 'flashPick() 已删（连 element #pick 一起）');
ok(typeof PICK_R === 'undefined' && typeof PICK_DY === 'undefined', '拾取半径常量已删');
ok(pickables.length === MATERIAL_TYPES.length && pickables.length === 3,
   '配重仍是三组（' + pickables.length + '）');
ok(pickables.every(p => p.mesh === null), '三组都**没有** InstancedMesh（世界里不再有它们）');
{
  const want = MATERIAL_TYPES.reduce((a, d) => a + d.count, 0);
  ok(pickableItems.length === want, '配重点位数 = 各类 count 之和（' + pickableItems.length + ' / ' + want + '）');
  ok(pickableItems.every(it => Number.isFinite(it.x) && Number.isFinite(it.z) && it.y === 0),
     '配重点位坐标仍然有限、贴地（scatter 那条路照旧跑了）');
  ok(pickableItems.every(it => it.taken === true), '配重点位全部标记为已拾取（永远不可拾取）');
}
/* 把玩家挪到"离原点最近的那个配重点位"上跑 30 帧 —— 原来是走到就捡，
   现在应该一点动静都没有（场景不多对象、也没有任何计数被写出来）。 */
{
  const near = pickableItems.reduce((a, b) =>
    Math.hypot(b.x, b.z) <= Math.hypot(a.x, a.z) ? b : a);
  player.x = near.x; player.z = near.z;
  player.y = sampleHeight(near.x, near.z);
  player.vx = player.vz = 0;
  const before = scene.children.length;
  for (let i = 0; i < 30; i++) loop();
  ok(scene.children.length === before,
     '站在原素材点上跑 30 帧，场景没有多出任何对象（' + before + ' → ' + scene.children.length + '）');
  ok(bag.materials === undefined, '也没有任何拾取计数被写出来');
}

/* ------------------------------------------------------------
   9b. 植被与岩石（8c 节）—— 真实 GLB 解析结果
   为什么放在第 9 节之后：8c 的 avoidList 要避开 pickableItems / signalBlanks，
   而这两者都是模块初始化时就建好的；放在这里语义上"配重点位已就位，再看植被占位"。
   （对了：那个 avoidList 现在还引用着 pickableItems —— 这不是忘了删，
     见 8b 节的长注释：avoid 列表变短会改变拒绝采样的次数，一样会让随机流漂移。）
   Node 里字节由 harness 用 fs 预读注入（浏览器那条走 fetch），
   但**解析那一段完全同一条路**，所以这里量到的几何/矩阵就是浏览器里的那份。
   ↑ 本文件整体是模板字符串，下面的注释里**不能出现反引号**。
   ------------------------------------------------------------ */
sec('9b. 植被与岩石（8c 节 · 真实 GLB）');
ok(propStats.failed.length === 0,
   '9 个模型全部解析成功（失败 ' + propStats.failed.length + ' 项：' + (propStats.failed.join('; ') || '无') + '）');
ok(propStats.models === PROP_DEFS.length, '装配 ' + PROP_DEFS.length + ' 种模型（实际 ' + propStats.models + '）');
ok(propMeshes.length === PROP_DEFS.length, '每种模型一个 InstancedMesh（' + propMeshes.length + ' 个）');
{
  const wantN = PROP_DEFS.reduce((a, d) => a + d.n, 0);
  ok(propStats.instances === wantN,
     '实例数 = 各类 n 之和（' + propStats.instances + ' / ' + wantN + '，拒绝采样没丢件）');
}
/* 把每个实例的矩阵**读回来**——断言"真的写进去了"，不是"我以为写了"。
   InstancedMesh 的默认矩阵是单位阵：不烘一次的话 101 个实例会全部叠在原点上，
   而 position/count 这些账目仍然是对的 —— 所以只能从 instanceMatrix 反读。 */
{
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let nonFinite = 0, offGround = [], outside = [], noBall = [], maxAbs = 0, minS = Infinity, maxS = -Infinity;
  for (const mesh of propMeshes) {
    if (!mesh.boundingSphere) noBall.push(mesh.name);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      if (!m4.elements.every(Number.isFinite)) nonFinite++;
      m4.decompose(p, q, s);
      if (Math.abs(p.y - GROUND_Y) > 1e-6) offGround.push(mesh.name + '#' + i + ' y=' + p.y.toFixed(3));
      const r = Math.max(Math.abs(p.x), Math.abs(p.z));
      maxAbs = Math.max(maxAbs, r);
      if (r > ARENA) outside.push(mesh.name + '#' + i + ' r=' + r.toFixed(1));
      minS = Math.min(minS, s.x); maxS = Math.max(maxS, s.x);
    }
  }
  console.log('  实例最大 |x|,|z| = ' + maxAbs.toFixed(1) + '（空气墙在 ' + ARENA + '）');
  console.log('  实例缩放范围     = ' + minS.toFixed(2) + ' ~ ' + maxS.toFixed(2));
  ok(nonFinite === 0, '全部实例矩阵元素有限（非有限 ' + nonFinite + ' 个）');
  ok(offGround.length === 0,
     '全部实例底面贴地 y=' + GROUND_Y + '（离地 ' + offGround.length + ' 个：' + (offGround.slice(0, 3).join(', ') || '无') + '）');
  ok(outside.length === 0, '全部实例在方形场地内（越界 ' + outside.length + ' 个）');
  ok(minS > 0.1 && minS < maxS, '实例缩放已写入且各不相同（' + minS.toFixed(2) + ' ~ ' + maxS.toFixed(2) + '）');
  /* 包围球这条不是吹毛求疵：InstancedMesh.boundingSphere 初值是 null，
     不 computeBoundingSphere() 的话视锥剔除会拿**几何自身**的球（半径≈1）判，
     镜头一离开世界原点，整片植被会被整体剔掉、凭空消失。 */
  ok(noBall.length === 0,
     '每个 InstancedMesh 都算了包围球（缺 ' + noBall.length + ' 个：' + (noBall.join(', ') || '无') + '）');
}
/* 避让真的生效 —— 这是 8c 里 avoidList 判据的**反向断言**（那边拒绝、这边检查落点）。
   不做这一步的话，"树长在空位上"只会在人肉截图时才被发现。
   注意这里量的是 signalBlanks（12 个"空位"坐标），**不是信号源**：
   实体早删了，但避让锚点留着（理由见 index.html 8 节的长注释）。 */
{
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let hitBlank = 0, hitPick = 0, minBlank = Infinity, minPick = Infinity;
  for (const mesh of propMeshes) {
    const def = PROP_DEFS.find(d => 'prop:' + d.name === mesh.name);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
      for (const sg of signalBlanks) {
        const d = Math.hypot(sg.x - p.x, sg.z - p.z);
        minBlank = Math.min(minBlank, d);
        if (d < 6 + def.radius - 1e-6) hitBlank++;
      }
      for (const it of pickableItems) {
        const d = Math.hypot(it.x - p.x, it.z - p.z);
        minPick = Math.min(minPick, d);
        if (d < 1.6 + def.radius - 1e-6) hitPick++;
      }
    }
  }
  console.log('  离最近空位 ' + minBlank.toFixed(1) + ' m｜离最近素材 ' + minPick.toFixed(1) + ' m');
  ok(hitBlank === 0, '没有植被/岩石压在空位上（侵入 ' + hitBlank + ' 例）');
  ok(hitPick === 0, '没有植被/岩石压住可拾取素材（遮挡 ' + hitPick + ' 例）');
}
/* 更严的一条：**中心点在场地内**不等于"没探出墙"。
   树冠在 |x|=85 处有 4.4 m 半径，就可能伸到 89.4；stones/grass 的 half 是 ARENA*0.93~0.94，
   余量更小。所以把每个实例的**几何包围盒 8 个角**真正乘上实例矩阵，取世界坐标里最大的 max(|x|,|z|)。
   这条能挡住"某天把 half 调大 / 把缩放上限调大"造成的探墙。 */
{
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  const CORNERS = [];
  for (const cx of [0, 1]) for (const cy of [0, 1]) for (const cz of [0, 1]) CORNERS.push([cx, cy, cz]);
  let over = [], reach = 0, worst = '';
  for (const mesh of propMeshes) {
    const bb = mesh.geometry.boundingBox;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      let r = 0;
      for (const [ix, iy, iz] of CORNERS) {
        v.set(ix ? bb.max.x : bb.min.x, iy ? bb.max.y : bb.min.y, iz ? bb.max.z : bb.min.z).applyMatrix4(m4);
        r = Math.max(r, Math.abs(v.x), Math.abs(v.z));
      }
      if (r > reach) { reach = r; worst = mesh.name + '#' + i; }
      if (r > ARENA) over.push(mesh.name + '#' + i + ' r=' + r.toFixed(1));
    }
  }
  console.log('  离墙最近的一株伸出到 = ' + reach.toFixed(1) + ' m（' + worst + '，空气墙 ' + ARENA + '）');
  ok(over.length === 0, '植被/岩石实体没有一处探出空气墙（越界 ' + over.length + ' 处）');
}

/* 小物件不能被大树整个罩住。
   为什么专门加这条：8c 的 avoidList 只避开**空位和可拾取素材**，
   prop 之间**互不避让** —— 也就是"一棵 1.7 m 的灌木正好长在 9 m 树冠底下"是被允许的，
   而那种情况下灌木在画面上完全看不见，**表现为"这个素材没生效"**
   （用户就是这么问的：「bush 素材是否没有成功体现？」）。

   ⚠️ 两个都踩过、都会让断言变成装饰品的坑：
   ① **不能用包围盒水平半径判。** 第一版那么写，把"一块石头嵌在树根下"报成遮挡
      （FAIL 1 个：stone-01#10 落在 tree-01#10 冠内），而 g1_spawn_view 里肉眼明明看得见它：
      叶团在 2.5 m 以上、石头只有 1.3 m —— 包围盒判据把"树冠高高在上"和"树冠贴着地面"
      当成了同一件事。
   ② **不能读 instanceMatrix.elements[0] 当缩放。** 有旋转时 m11 = s·cos(yaw)
      —— 不只是"yaw 接近 90° 时接近 0"，**yaw 过了 90° 就直接变负**。
      树 #0 的 yaw = −120.7°，elements[0] = 9.37·cos(−120.7°) = −4.78，
      ⇒ 用包围盒算出的粗筛半径 t.rad = −2.71 m（负数），
      ⇒ hypot(d) > t.rad + R（= −1.28）对**任何**距离都成立 ⇒ 每棵树都在这一跳被
      continue 掉 ⇒ **断言恒真**。这个坑是靠"强行把一棵灌木挪到树心，看断言会不会
      FAIL"查出来的 —— 当时它照样报 0 例。**断言写完必须主动制造一次违规来验证它会响**，
      否则"全绿"说明不了任何事。
   ③ 粗筛半径也不要靠包围盒推 —— 树的形状是"细树干 + 宽叶团"，包围盒水平半对角线
      乘缩放是**上界里的上界**（实测 5.32 m，而树高只有 9.4 m）。直接用已经算出来的
      顶点世界坐标求"到自身变换原点的最大水平距离"，精确且不比原来贵。
   ⚠️ 这段代码整体在 DRIVER 模板字符串里（51~546 行）：**注释里不能出现反引号**，
      否则模板被截断、后面第一个标识符就是 SyntaxError。踩过一次。 */
{
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();

  const trees = [];                       // { pts: [[x,y,z]…], tx, tz, rad }
  for (const mesh of propMeshes) {
    if (mesh.name !== 'prop:tree-01') continue;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      m4.decompose(tp, tq, ts);                 // ← 缩放/位置只从 decompose 取
      const tx = tp.x, tz = tp.z;
      const pts = [];
      let rad = 0;
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(m4);
        pts.push([v.x, v.y, v.z]);
        const d = Math.hypot(v.x - tx, v.z - tz);
        if (d > rad) rad = d;                   // 顶点到树心的最大水平距离（精确）
      }
      trees.push({ pts, tx, tz, rad });
    }
  }

  const buried = [];
  let minClear = Infinity, worst = '无';
  for (const mesh of propMeshes) {
    if (mesh.name === 'prop:tree-01') continue;
    const bb = mesh.geometry.boundingBox;
    const rad0 = 0.5 * Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      m4.decompose(tp, tq, ts);
      const top = tp.y + bb.max.y * ts.y;       // 物件顶面（模型底面精确在 y=0）
      const R = rad0 * ts.x;
      for (const t of trees) {
        if (Math.hypot(t.tx - tp.x, t.tz - tp.z) > t.rad + R) continue;   // 离得远，跳过
        let lowest = Infinity;
        for (const r of t.pts) {
          if (r[1] > top) continue;                                     // 只看物件顶面以下的树几何
          if (Math.hypot(r[0] - tp.x, r[2] - tp.z) > R) continue;        // 只看物件足迹正上方
          if (r[1] < lowest) lowest = r[1];
        }
        if (lowest === Infinity) continue;
        const clear = lowest - top;
        if (clear < minClear) { minClear = clear; worst = mesh.name + '#' + i; }
        if (clear <= 0) buried.push(mesh.name + '#' + i + ' 的足迹被树干/叶团占位 ' + (-clear).toFixed(2) + ' m');
      }
    }
  }
  console.log('  树几何在物件足迹内的最低点 − 物件顶面 = ' +
              (minClear === Infinity ? '（无任何交叠）' : minClear.toFixed(2) + ' m（最近的一例 ' + worst + '）'));
  ok(buried.length === 0, '没有小物件被树占位（被占 ' + buried.length + ' 个：' +
     (buried.slice(0, 3).join('; ') || '无') + '）');
}

/* 出生点留空 —— 一觉醒来看不见自己站在树里面 */
{
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let minSpawn = Infinity;
  for (const mesh of propMeshes) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
      minSpawn = Math.min(minSpawn, Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z));
    }
  }
  const clear = Math.min(...PROP_DEFS.map(d => d.spawnClear));
  console.log('  离出生点最近的一株 = ' + minSpawn.toFixed(1) + ' m（各类要求 >= ' + clear + '）');
  ok(minSpawn >= clear - 1e-6, '出生点留空生效（最近 ' + minSpawn.toFixed(1) + ' m >= ' + clear + '）');
}
/* stone-02 的材质兜底：这个 GLB **没有材质**，GLTFLoader 会补一个
   MeshStandardMaterial{ color:白, metalness:1, roughness:1 }。
   金属度 1 且没有环境贴图 ⇒ 渲染成近黑的一块。这里断言它已被换成中性岩石材质。 */
{
  const s2 = propMeshes.find(m => m.name === 'prop:stone-02');
  ok(!!s2, 'stone-02 已装配');
  if (s2) {
    const mt = s2.material;
    console.log('  stone-02 材质 = metalness ' + mt.metalness + ' / roughness ' + mt.roughness +
                ' / map ' + (mt.map ? '有' : '无') + ' / color #' + mt.color.getHexString());
    ok(!(mt.map === null && (mt.metalness ?? 0) >= 0.9),
       'stone-02 没有落在"无贴图 + 金属度拉满"的签名上（那种会渲染成近黑）');
  }
}
/* 三条取数路：注入的 ArrayBuffer / 内联 base64 / fetch。
   只有"字节从哪来"不同，**解析是同一条路**。
   为什么非要三条都测：内联 base64 只有单文件版会走、fetch 只有起了服务器的浏览器会走，
   Node 默认走的是注入那条 —— 不测的话这两条真实入口在测试里从来没有被执行过。 */
{
  const real = globalThis.__propBuffers['tree-01'];
  const b64 = Buffer.from(new Uint8Array(real)).toString('base64');

  const pmEl = document.getElementById('__propmodels');
  pmEl.textContent = JSON.stringify({ 'tree-01': b64 });
  let viaInline = null, inlineErr = null;
  try { viaInline = await propBytes('tree-01'); } catch (e) { inlineErr = e; }
  pmEl.textContent = '';                                  // 别污染后续
  ok(!inlineErr && !!viaInline && viaInline.byteLength === real.byteLength,
     '内联 base64 路可用（' + (inlineErr ? '抛 ' + inlineErr.message : viaInline.byteLength + ' B / 磁盘 ' + real.byteLength + ' B') + '）');
  if (viaInline) {
    const a = new Uint8Array(viaInline), b = new Uint8Array(real);
    let diff = -1;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff = i; break; }
    ok(diff < 0, '内联 base64 解码与磁盘字节逐字节一致（' + (diff < 0 ? '全同' : '第 ' + diff + ' 字节起不同') + '）');
  }

  /* fetch 路：Node 里没有"相对路径 fetch 本地文件"，塞一个假的进去，只为断言 URL 拼对了 */
  const realFetch = globalThis.fetch, saved = globalThis.__propBuffers;
  let gotUrl = null, viaFetch = null, fetchErr = null;
  try {
    globalThis.fetch = u => { gotUrl = u; return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(real) }); };
    globalThis.__propBuffers = null;                       // 逼 propBytes 走到 fetch 分支
    viaFetch = await propBytes('tree-01');
  } catch (e) { fetchErr = e; } finally {
    globalThis.__propBuffers = saved;
    globalThis.fetch = realFetch;
  }
  ok(!fetchErr && gotUrl === './models/tree-01.glb',
     'fetch 路 URL 拼对（' + (fetchErr ? '抛 ' + fetchErr.message : gotUrl) + '）');
  ok(viaFetch === real, 'fetch 路把 arrayBuffer 原样交回，没有二次拷贝');
}

sec('9c. 前哨营地（8d 节 · 建筑模块套装）');
ok(campStats.failed.length === 0,
   '7 件建筑模块全部解析成功（失败 ' + campStats.failed.length + ' 项：' + (campStats.failed.join('; ') || '无') + '）');
ok(campStats.models === CAMP_LAYOUT.length + 1,
   '装配 ' + (CAMP_LAYOUT.length + 1) + ' 件（' + CAMP_LAYOUT.length + ' 件表里写死 + 1 件围栏），实际 ' + campStats.models);
ok(campMeshes.length === campStats.models, '每件一个 InstancedMesh（' + campMeshes.length + ' 个）');
{
  const wantN = CAMP_LAYOUT.length + FENCE_N;
  ok(campStats.instances === wantN,
     '实例数 = ' + CAMP_LAYOUT.length + ' 件 + 围栏 ' + FENCE_N + ' 段 = ' + wantN + '（实际 ' + campStats.instances + '）');
}
/* 逐实例反读矩阵。这里比植被那节还多两条：
   · **建筑不能歪** —— 用 yaw-only 的四元数，欧拉角 X/Z 必须严格为 0
     （植被允许 ±tilt 的随机歪斜，建筑歪一度就是"模型塌了"）
   · **不能捅穿围栏** —— 每件的外缘到营地中心的距离必须小于围栏半径 */
{
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(),
        s = new THREE.Vector3(), eul = new THREE.Euler();
  let nonFinite = 0, offGround = [], outside = [], noBall = [], tilted = [];
  let worstReach = 0, worstName = '', minR = Infinity;
  for (const mesh of campMeshes) {
    if (!mesh.boundingSphere) noBall.push(mesh.name);
    const bb = mesh.geometry.boundingBox;
    const rad0 = 0.5 * Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      if (!m4.elements.every(Number.isFinite)) nonFinite++;
      m4.decompose(p, q, s);
      if (Math.abs(p.y - GROUND_Y) > 1e-6) offGround.push(mesh.name + '#' + i + ' y=' + p.y.toFixed(3));
      if (Math.max(Math.abs(p.x), Math.abs(p.z)) > ARENA) outside.push(mesh.name + '#' + i);
      eul.setFromQuaternion(q, 'YXZ');
      if (Math.abs(eul.x) > 1e-6 || Math.abs(eul.z) > 1e-6)
        tilted.push(mesh.name + '#' + i + ' x=' + eul.x.toFixed(4) + ' z=' + eul.z.toFixed(4));
      if (mesh.name === 'prop:camp-fence') continue;      // 围栏就在那条弧上，不参与"圈内"检查
      /* 外缘到营地中心的距离：中心 + 该实例位置差 + 水平半径。用矩阵反读，不用名义值 */
      const dc = Math.hypot(p.x - campStats.center.x, p.z - campStats.center.z);
      const reach = dc + rad0 * s.x;
      if (reach > worstReach) { worstReach = reach; worstName = mesh.name + '#' + i; }
      minR = Math.min(minR, dc);
    }
  }
  console.log('  营地外缘最远伸到 ' + worstReach.toFixed(2) + ' m（' + worstName +
              '，围栏在 ' + FENCE_R.toFixed(2) + ' m）');
  ok(nonFinite === 0, '营地实例矩阵元素有限（非有限 ' + nonFinite + ' 个）');
  ok(offGround.length === 0,
     '营地全部实例底面贴地 y=' + GROUND_Y + '（离地 ' + offGround.length + ' 个：' + (offGround.slice(0, 3).join(', ') || '无') + '）');
  ok(outside.length === 0, '营地全部实例在方形场地内（越界 ' + outside.length + ' 个）');
  ok(tilted.length === 0,
     '建筑没有任何一处歪斜（歪的 ' + tilted.length + ' 个：' + (tilted.slice(0, 3).join(', ') || '无') + '）');
  ok(noBall.length === 0, '营地每个 InstancedMesh 都算了包围球（缺 ' + noBall.length + ' 个）');
  /* 除围栏自己以外的 6 件，都应该落在围栏圈内。
     围栏本身当然在 R 上（它就在那条弧上），所以这里必须把它排除 ——
     不排除的话这条断言永远会红，而红的原因跟"建筑捅穿围栏"毫无关系。 */
  ok(worstReach < FENCE_R,
     '6 件建筑都在围栏圈内（最远 ' + worstReach.toFixed(2) + ' < ' + FENCE_R.toFixed(2) + '）：'
     + (worstReach < FENCE_R ? '是' : '**有件捅穿了围栏**'));
}
/* 围栏弧要**首尾相接**：相邻两段的中心距必须等于弦长（= 一段栅栏的长度）。
   差得多就说明段数/半径不匹配 —— 要么裂出缝、要么叠在一起。
   这条正是 FENCE_R 那个公式的**反向验证**：公式要是写错了，这里立刻报出来。 */
{
  const fenceMesh = campMeshes.find(m => m.name === 'prop:camp-fence');
  if (!fenceMesh) {
    ok(false, '找不到围栏 InstancedMesh');
  } else {
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const pts = [];
    for (let i = 0; i < fenceMesh.count; i++) {
      fenceMesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
      pts.push({ x: p.x, z: p.z, s: s.x });
    }
    const chord = 0.393 * FENCE_S;
    let maxErr = 0, minD = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      maxErr = Math.max(maxErr, Math.abs(d - chord));
      minD = Math.min(minD, d);
    }
    console.log('  围栏相邻段中心距最小 ' + minD.toFixed(3) + ' m，与段长 ' + chord.toFixed(3) + ' m 的最大偏差 ' + maxErr.toFixed(3) + ' m');
    ok(maxErr < chord * 0.05,
       '围栏首尾相接无裂缝（最大偏差 ' + maxErr.toFixed(3) + ' m < 段长 5%）');
    /* 围栏只在背侧：所有段相对营地中心，应该在"背离入口"的半边 */
    let front = 0;
    for (const p2 of pts) {
      const dx = p2.x - campStats.center.x, dz = p2.z - campStats.center.z;
      /* 把世界方向转回营地局部坐标：世界 (cosθ, −sinθ) 对应局部 +X，
         所以局部 z = dx·sinθ + dz·cosθ */
      const th = campStats.center.yaw;
      const lz = dx * Math.sin(th) + dz * Math.cos(th);
      if (lz > 0) front++;
    }
    ok(front === 0, '围栏只围背侧，正面 240° 敞开当入口（落在正面的段数 ' + front + '）');
  }
}
/* 营地选址：不压在出生点/空位/素材/已有植被上，且离墙有富余。
   这是 campCenter() 里那串 avoidList 判据的**反向断言** —— 只在人肉截图时才发现就太晚了。
   （判据里那条"离空位 >= 6 m"原本是给信号源留的通道，信号源删了之后
   空位仍然是"别长东西"的锚点，判据不动。） */
{
  let hitBlank = 0, hitPick = 0, hitProp = 0, minBlank = Infinity, minProp = Infinity;
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const mesh of campMeshes) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
      for (const sg of signalBlanks) {
        const d = Math.hypot(sg.x - p.x, sg.z - p.z);
        minBlank = Math.min(minBlank, d);
        if (d < 6) hitBlank++;
      }
      for (const it of pickableItems) if (Math.hypot(it.x - p.x, it.z - p.z) < 1.6) hitPick++;
      for (const f of propFootprints) {
        const d = Math.hypot(f.x - p.x, f.z - p.z);
        minProp = Math.min(minProp, d);
        if (d < f.r) hitProp++;
      }
    }
  }
  const dSpawn = Math.hypot(campStats.center.x - SPAWN.x, campStats.center.z - SPAWN.z);
  const dWall = ARENA - Math.max(Math.abs(campStats.center.x), Math.abs(campStats.center.z));
  console.log('  营地中心 (' + campStats.center.x + ', ' + campStats.center.z + ')' +
              '｜离出生点 ' + dSpawn.toFixed(1) + ' m｜离墙 ' + dWall.toFixed(1) + ' m' +
              '｜离最近空位 ' + minBlank.toFixed(1) + ' m｜离最近植被 ' + minProp.toFixed(1) + ' m');
  ok(hitBlank === 0, '营地没有压在空位上（侵入 ' + hitBlank + ' 例）');
  ok(hitPick === 0, '营地没有压住可拾取素材（遮挡 ' + hitPick + ' 例）');
  ok(hitProp === 0, '营地没有长进已有植被/岩石里（重叠 ' + hitProp + ' 例）');
  ok(dSpawn >= 46 && dSpawn <= 84, '营地离出生点 46~84 m（实际 ' + dSpawn.toFixed(1) + '）—— 值得走过去，也不至于找不到');
  ok(dWall > CAMP_R, '营地离空气墙有富余（' + dWall.toFixed(1) + ' > 占地半径 ' + CAMP_R + '）');
}
/* 营地里各件**互不重叠**。固定布局最容易犯的错就是这一条：
   初版把 Cube 放在离 Dome 3.4/2.2 的地方，Dome 底半径 2.25 m —— 真相交。
   判据用"水平圆 + 竖直区间"而不是包围盒：Dome 是圆顶，包围盒会把四角算成实体、
   于是把"石头嵌在树根下"那类误报又搬回来一次（9b 里已经踩过）。 */
{
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const bodies = [];
  for (const mesh of campMeshes) {
    const bb = mesh.geometry.boundingBox;
    /* 水平半径取"两轴最大值的一半"而不是半对角线：半对角线是四角距离，
       对圆形/方形构件都偏大，会把本该合规的间距判成重叠。 */
    const rad0 = 0.5 * Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
      bodies.push({ name: mesh.name + '#' + i, x: p.x, z: p.z,
                    r: rad0 * s.x, y0: p.y + bb.min.y * s.y, y1: p.y + bb.max.y * s.y });
    }
  }
  const hits = [];
  let minGap = Infinity, worst = '无';
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) {
      const A = bodies[a], B = bodies[b];
      /* 围栏段之间是**故意首尾相接**的，圆模型表达不了这件事：
         圆半径取的是水平两轴里较大的那半（= 半长 0.59 m），而相邻段圆心距正好等于段长，
         两个圆恰好相切（间隙 0.00）。所以围栏↔围栏这一对交给上面那条弦长断言管，
         这里跳过 —— 留着的话它会在浮点误差上随机翻红，红的原因还跟重叠无关。 */
      if (A.name.startsWith('prop:camp-fence') && B.name.startsWith('prop:camp-fence')) continue;
      if (A.y0 > B.y1 || B.y0 > A.y1) continue;            // 竖直方向不重叠
      const d = Math.hypot(A.x - B.x, A.z - B.z);
      const gap = d - (A.r + B.r);
      if (gap < minGap) { minGap = gap; worst = A.name + ' ↔ ' + B.name; }
      if (gap < -1e-6) hits.push(A.name + ' ↔ ' + B.name + ' 重叠 ' + (-gap).toFixed(2) + ' m');
    }
  }
  console.log('  营地各件最近间隙 ' + (minGap === Infinity ? '（只有一个物件）' : minGap.toFixed(2) + ' m（最近的一对 ' + worst + '）'));
  ok(hits.length === 0, '营地各件互不重叠（重叠 ' + hits.length + ' 对：' + (hits.slice(0, 3).join('; ') || '无') + '）');
}

sec('9d. 史莱姆（唯一的导入物种，也是场上全部生物）');
ok(slimeStats.failed.length === 0,
   '8 个生物模型全部解析成功（失败 ' + slimeStats.failed.length + ' 项：' + (slimeStats.failed.join('; ') || '无') + '）');
ok(slimeStats.models === 8, '装配 8 种生物（实际 ' + slimeStats.models + '）');
{
  const want = SPECIES_LIST.filter(sp => sp.glb).reduce((a, sp) => a + sp.count, 0);
  ok(slimeStats.instances === want, '史莱姆实例数 = 各类 count 之和（' + slimeStats.instances + ' / ' + want + '）');
}
{
  const slimes = animals.filter(a => a.species.glb);
  const bad = [];
  for (const a of slimes) {
    const ud = a.g.userData;
    if (ud.kind !== 'land') bad.push(a.species.key + ' kind=' + ud.kind);
    if (ud.gait !== 'squash') bad.push(a.species.key + ' gait=' + ud.gait);
    if (!ud.body) bad.push(a.species.key + ' 没有 body');
    if (typeof ud.speed !== 'number') bad.push(a.species.key + ' 没有 speed');
    /* 必须只有一个 Mesh 子节点 —— 吸附/抛出逻辑按 group 操作，多挂一个就会漏掉 */
    const kids = a.g.children.filter(o => o.isMesh);
    if (kids.length !== 1) bad.push(a.species.key + ' 子 Mesh ' + kids.length + ' 个');
  }
  ok(bad.length === 0, '史莱姆的实体契约完整（问题 ' + bad.length + ' 个：' + (bad.slice(0, 3).join('; ') || '无') + '）');
  ok(slimes.length === 58, '场上有 58 只导入生物（实际 ' + slimes.length + '）');
  const keys = [...new Set(slimes.map(a => a.species.key))].sort();
  ok(keys.join(',') === 'baby-laugh,bull-aloof,kangaroo-peek,knife-shiba,mind-sphere,slime-ball,slime-ring,sunny-sun',
     '八个物种都在场上（' + keys.join(',') + '）');
}
/* 果冻材质**确实被降级了**：这个断言挡的是"哪天有人把 transmission 改回去"。
   降级不只是观感选择 —— three 里 material.transmission > 0 会让每帧多渲一遍
   半分辨率全场景，是这个场景里最贵的一条路径。 */
{
  const bad = [];
  for (const a of animals.filter(x => x.species.key === 'slime-ring' || x.species.key === 'slime-ball')) {
    const m = a.g.children.find(o => o.isMesh).material;
    if (m.transmission > 0) bad.push(a.species.key + ' transmission=' + m.transmission);
    if (!m.transparent) bad.push(a.species.key + ' 不是半透明');
    if (!(m.opacity > 0.3 && m.opacity < 1)) bad.push(a.species.key + ' opacity=' + m.opacity);
    if (!m.map) bad.push(a.species.key + ' 丢了贴图');
    if (m.type !== 'MeshStandardMaterial') bad.push(a.species.key + ' 材质类型=' + m.type);
  }
  ok(bad.length === 0, '史莱姆果冻已降级成普通半透明（问题 ' + bad.length + ' 个：' + (bad.slice(0, 3).join('; ') || '无') + '）');
}
/* 底面归零：几何的 min.y 必须是 0，否则实例摆到 y=0 就是半截埋在地里。
   这条正是新增 loadModel() 里那句 translate 的**可核证据** ——
   新素材原生的 min.y 是 −0.92（乘完节点缩放），不归零这条必挂。 */
{
  const bad = [];
  for (const a of animals.filter(x => x.species.glb)) {
    const g = a.g.children.find(o => o.isMesh).geometry;
    g.computeBoundingBox();
    if (Math.abs(g.boundingBox.min.y) > 1e-6) bad.push(a.species.key + ' minY=' + g.boundingBox.min.y.toFixed(4));
  }
  ok(bad.length === 0, '史莱姆几何底面已归零（minY≠0 的 ' + bad.length + ' 个：' + (bad.slice(0, 3).join('; ') || '无') + '）');
}
/* 会动 —— 不推进帧就断言"它在动"等于没断言。存下推进前后的坐标做比较。 */
{
  const slimes = animals.filter(a => a.species.glb);
  const before = slimes.map(a => ({ x: a.x, z: a.z, heading: a.heading, phase: a.phase }));
  /* 顺手量一下"朝向累计行程"：Σ|每帧 Δ朝向|。为什么量这个、不量净位移，见下面那条断言。 */
  const prevH = slimes.map(a => a.heading);
  let travel = 0;
  for (let i = 0; i < 240; i++) {
    loop(0.016);
    slimes.forEach((a, k) => { travel += Math.abs(a.heading - prevH[k]); prevH[k] = a.heading; });
  }
  let moved = 0, phased = 0, stuck = [];
  slimes.forEach((a, i) => {
    const b = before[i];
    if (Math.hypot(a.x - b.x, a.z - b.z) > 1e-3) moved++;
    else stuck.push(a.species.key + '#' + i);
    if (Math.abs(a.phase - b.phase) > 1e-2) phased++;
  });
  console.log('  推进 240 帧后：移动 ' + moved + '/' + slimes.length +
              '｜体形脉动 ' + phased +
              '｜全群朝向累计行程 ' + travel.toExponential(2) + ' rad');
  ok(moved === slimes.length, '每只史莱姆都在移动（没动的 ' + (stuck.join(', ') || '无') + '）');
  /* ⚠️ 这条曾经红过，而且**根因不在"移动"上**，写下来免得下次重查：
     卡在场地**角落**的那只会被"逐轴钳制"同时削掉两个分量 ⇒ 单帧位移恒为 0。
     （不是 rand 抽坏了，也不是速度算错 —— 是墙的边界情形。）
     index.html 墙段现在用"朝场地中心拐"的反应期解决它，并有专门的注释。 */
  ok(phased === slimes.length, '每只史莱姆的体形脉动相位都在走（弹跳轨道在推）');

  /* --- 转向：**别用"净位移"判** -------------------------------------------
     这条原来是"|Δ朝向| > 1e-4 才算转了"，会偶发红（实测出现过 7/8）。根因不是"没转"，
     而是**净位移会被抵消**：e.turning 每 2~7 秒重新随机一次，240 帧（3.84 s）
     正好跨 1~2 次重采样 ⇒ 朝向是一次**随机游走**，两段反向就可能抵消回原处。
     实测那次：turning = −0.0348，净位移 5.79e-5（判失败），而它的累计行程是
     1.9e-3 —— **一直在转，只是转回了原处**。
     所以换成两条都不会被抵消的判据。 */
  ok(travel > 1e-3, '全群朝向一直在走（240 帧累计行程 ' + travel.toExponential(2) +
     ' rad —— 用"路程"而不是"净位移"：随机游走的净位移会互相抵消，路程不会）');

  /* 逐只的**响应**：冻住 timer、每帧强制喂一个确定的 turning，看朝向跟不跟着走。
     这条是确定性的（不依赖随机取样），也正是"AI 在驱动朝向"这句话的真契约。
     三个坑都在这里堵上了：
       · flee 会**完全接管**朝向（heading = atan2(px,pz)，turning 被无视）
         ⇒ 先把玩家搬到远处，退出 9.5 m 的逃跑半径；
       · 撞空气墙原先会把 e.turning 重新随机掉 ⇒ 每帧重新写一次；
       · ⚠️ 2026-09-23 新增第三个、也是最先犯的那个：撞墙现在会进入
         "**朝场地中心拐**"的反应期（见 index.html 墙段），**反应期内 turning 是被无视的**。
         而反应期是被"每帧都被墙削"持续触发的 ⇒ 只重写 turning 不够，
         还得让它们**根本撞不到墙**：下面按 8×5 网格摆到场地内部
         （间距 4 m > 两半径之和 ≈2.4 m，不会互相挤），120 帧最多走 1~2 m，离 ±93 的墙很远。
         同时每帧把 wallT 清 0，双保险。
         这一条不写清楚，下一个人看到这条红会去查"转向接线"，而真正的原因是它贴着墙。 */
  {
    const savedP = { x: player.x, z: player.z };
    player.x = 9999; player.z = 9999;               // 退出所有逃跑范围
    const back = slimes.map(a => ({ heading: a.heading, turning: a.turning, timer: a.timer, x: a.x, z: a.z, wallT: a.wallT }));
    slimes.forEach((a, i) => { a.x = (i % 8) * 4 - 14; a.z = Math.floor(i / 8) * 4 - 8; a.wallT = 0; });
    const resp = slimes.map(a => {
      const h0 = a.heading;
      for (let i = 0; i < 120; i++) { a.turning = 0.45; a.timer = 1e9; a.wallT = 0; loop(0.016); }
      const plus = a.heading - h0;
      const h1 = a.heading;
      for (let i = 0; i < 120; i++) { a.turning = -0.45; a.timer = 1e9; a.wallT = 0; loop(0.016); }
      return { key: a.species.key, plus, minus: a.heading - h1 };
    });
    slimes.forEach((a, k) => Object.assign(a, back[k]));
    player.x = savedP.x; player.z = savedP.z;
    const bad = resp.filter(r => !(r.plus > 0 && r.minus < 0));
    console.log('  turning=±0.45 各 120 帧 → 朝向变化 ' +
                resp.map(r => (r.plus > 0 ? '+' : '') + r.plus.toExponential(1)).join(', ') + ' rad');
    ok(bad.length === 0, '每只史莱姆的朝向都跟着 turning 走（正反两个方向都验过；不合的 ' +
       bad.length + ' 只：' + (bad.map(b => b.key).join(', ') || '无') + '）');
  }
}
/* 体形脉动真的改到了子网格的缩放上 —— 只断言 phase 在变化，可能只是计数器在走。 */
{
  const body = animals.find(a => a.species.glb).g.children.find(o => o.isMesh);
  const seen = new Set();
  for (let i = 0; i < 90; i++) { loop(0.016); seen.add(body.scale.y.toFixed(4)); }
  ok(seen.size > 5, '体形脉动真的写到了 body.scale 上（90 帧里出现 ' + seen.size + ' 种不同的 y 缩放）');
}
/* 能被吸入 —— findVacuumTarget 只认 kind === 'land'，kind 写错就变装饰品 */
{
  const a = animals.find(x => x.species.glb);
  const saved = { x: player.x, z: player.z, yaw: player.yaw };
  /* 站到史莱姆南边、朝正北看它，让它落在准星锥里 */
  player.x = a.x; player.z = a.z + 4;
  player.yaw = Math.atan2(-(a.x - player.x), -(a.z - player.z));
  const tgt = findVacuumTarget();
  ok(!!tgt && tgt.species.glb === a.species.key,
     '史莱姆能被采集器选中（' + (tgt ? tgt.species.key : '没选中') + '）');
  player.x = saved.x; player.z = saved.z; player.yaw = saved.yaw;
}
/* 原来这里有一条「观测史莱姆 → 进图鉴」的断言（路径：按 E → tryScan → speciesSeen）。
   按 E 那套 2026-09-23 整体删除后这条路径不存在了 —— 史莱姆与玩家之间**只剩**两条路：
   ① 被吸进弹夹 / 吐出（上面那条 findVacuumTarget + input.mjs 里的 F / G 键）；
   ② 被拖去屠宰（第 13 节）。
   刻意留这段说明而不是静默删掉：否则将来有人看到"史莱姆没测图鉴接入"，
   会以为这里漏了测试，再给一条已不存在的链路补断言。
   改成一条**跨表对账**：带贴图动物的只数必须等于 SPECIES_LIST 里 glb 项的 count 之和 ——
   挡的是"改了物种表却没改动物散布"（反过来也挡：散布多建了几只而表里没写）。 */
{
  const fromList = SPECIES_LIST.filter(sp => sp.glb).reduce((a, sp) => a + sp.count, 0);
  const onField = animals.filter(a => a.species.glb).length;
  ok(onField === fromList,
     '带贴图动物只数 = SPECIES_LIST 里 glb 项 count 之和（场上 ' + onField + ' / 表里 ' + fromList + '）');
}

/* ============================================================
   9e. 本轮（2026-09-23）四项需求的专项断言
   ------------------------------------------------------------
   ①  地貌统一成「初始台地」
   ②  左下角小地图（正方形、标玩家位置与营地）
   ③  每个生物产生时获得圆柱碰撞体；尸体保留原碰撞体
   ④  生物之间 / 生物与空气墙的碰撞：**滑动而不是卡死**
   ⑤  所有生物都用史莱姆的拉伸弹跳（形状无关）
   ============================================================ */
sec('9e. 地貌 / 小地图 / 碰撞体 / 碰撞滑动 / 拉伸弹跳');

/* --- ① 地貌 --- */
ok(REGION_NAME === '初始台地', '地貌常量 = 初始台地（实际 ' + REGION_NAME + '）');
{
  /* 全场都叫这个名字：**多点取样**。只测一个点抓不到"分区哈希其实还在"。
     采样点刻意分布在四个象限 + 边界内侧 + 原点。 */
  const pts = [[0, 0], [50, 50], [-50, -50], [90, -90], [-99, 99], [93.9, 0.1], [12, -77]];
  const names = [...new Set(pts.map(p => biomeAt(p[0], p[1])))];
  console.log('  7 个采样点的地貌返回值 = [' + names.join(', ') + ']');
  ok(names.length === 1 && names[0] === '初始台地', '场地任意位置的地貌都是「初始台地」');
  ok(biomeAt() === '初始台地', 'biomeAt() 不带参数也返回同一个名字（HUD 就是这么调的）');
}
loop();
ok(el('biome').textContent === '初始台地',
   'HUD 地貌那一行确实显示「初始台地」（实际 ' + JSON.stringify(el('biome').textContent) + '）');

/* --- ② 小地图 --- */
{
  const cv = el('mapCanvas');
  ok(!!cv, '小地图画布 #mapCanvas 存在');
  /* ⚠️ **不能**在这里断言 cv.width === 220：夹具的 getElementById 返回的是
     一个假对象（不解析 HTML 属性），它的 width 恒为 0 —— 那会是个假 FAIL。
     画布尺寸由 0b 节的**静态源码检查**守（id="mapCanvas" width="220" height="220"），
     "真的是正方形"由 _probe_hud.mjs 在真浏览器里量 canvas 矩形守。 */
  ok(typeof drawMinimap === 'function', 'drawMinimap() 存在');
  /* 像素层面的正确性这里验不了 —— 夹具的 2D 上下文是桩，不记录像素。
     这里只能验"能被反复调用且不抛错"，画面的正确性交给
     _probe_hud.mjs（真浏览器量矩形）与人工查看。**别把这条读成"小地图是对的"。** */
  let mErr = null;
  try { for (let i = 0; i < 5; i++) drawMinimap(); } catch (e) { mErr = e; }
  ok(!mErr, 'drawMinimap() 连画 5 次不抛错' + (mErr ? '：' + mErr.message : ''));
  ok(Number.isFinite(campStats.center.x) && Number.isFinite(campStats.center.z),
     '营地中心是可用的输入（小地图靠它标点）：(' + campStats.center.x.toFixed(2) + ', ' + campStats.center.z.toFixed(2) + '）');
  /* 营地装配失败时 campStats.center 是 undefined —— 小地图必须能容忍
     （装饰性模型失败不该连累 HUD）。手动制造一次那个状态。 */
  const savedCenter = campStats.center;
  campStats.center = undefined;
  let mErr2 = null;
  try { drawMinimap(); } catch (e) { mErr2 = e; }
  campStats.center = savedCenter;
  ok(!mErr2, '营地装配失败时 drawMinimap() 不抛错' + (mErr2 ? '：' + mErr2.message : ''));
}

/* --- ③ 圆柱碰撞体 --- */
{
  const bad = [];
  for (const a of animals) {
    const c = a.cyl;
    if (!c) { bad.push(a.species.key + ' 没有 cyl'); continue; }
    if (!Number.isFinite(c.r) || !Number.isFinite(c.h) || !Number.isFinite(c.y0) || c.r <= 0 || c.h <= 0) {
      bad.push(a.species.key + ' cyl 非法 = ' + JSON.stringify(c));
      continue;
    }
    /* "相近大小"的粗防线：圆柱半径不可能比体高还大（扁饼），也不可能细到体高的 1/6。
       这不是精确判据，只挡"明显不对"。 */
    if (c.r > c.h * 1.05) bad.push(a.species.key + ' 半径 ' + c.r.toFixed(2) + ' > 体高 ' + c.h.toFixed(2));
    if (c.r < c.h / 6) bad.push(a.species.key + ' 半径过细 ' + c.r.toFixed(2));
  }
  ok(bad.length === 0, '每个生物都有合法的圆柱碰撞体（问题 ' + bad.length + ' 个：' + (bad.slice(0, 3).join('; ') || '无') + '）');
  const rs = animals.map(a => a.cyl.r), hs = animals.map(a => a.cyl.h);
  console.log('  碰撞体半径 = ' + Math.min(...rs).toFixed(2) + ' ~ ' + Math.max(...rs).toFixed(2) +
              ' m｜体高 = ' + Math.min(...hs).toFixed(2) + ' ~ ' + Math.max(...hs).toFixed(2) + ' m');
  ok(Math.min(...rs) > 0.2 && Math.max(...rs) < 3, '半径都在"生物尺度"上（0.2~3 m）');
  /* 和**真实几何**对一次账。为什么必须对账：measureCylinder 里任何一处写错
     （忘了乘 scale / 把 y 当成水平方向 / 取错轴）都会得到一个"看着有、其实没用"的数字，
     而"非 NaN、大于零"这种弱断言**骗得过**一个自洽的坏数字。
     ⚠️ 判据必须用**几何自身的局部包围盒**，不能用 Box3.setFromObject(g)（世界 AABB）：
        ① 世界 AABB 会被 group 的**朝向**放大（盒子绕 Y 转 45° 时水平尺寸乘 √2）；
        ② 还会被弹跳形变放大（这一刻正好在拉伸/压扁）。
        第一版就是这么写的，量出 0.665 的"偏差" —— 那是**量法**的偏差，不是碰撞体的。
        几何的局部包围盒不受旋转影响，而 measureCylinder 的定义正是"局部盒 × 缩放"，
        所以这条对账得到的是精确的 1.000，同时仍然能抓住上面那三类写错。 */
  {
    const errs = [];
    for (const a of animals) {
      const body = a.g.userData.body;
      if (!body || !body.geometry) { errs.push(a.species.key + ' 没有可直接量的 body 几何'); continue; }
      body.geometry.computeBoundingBox();
      const bb = body.geometry.boundingBox;
      const wantR = 0.5 * Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * a.baseScale;
      const ratio = a.cyl.r / wantR;
      if (Math.abs(ratio - 1) > 0.02) errs.push(a.species.key + ' 半径比值 ' + ratio.toFixed(3));
    }
    console.log('  圆柱半径 / 几何局部盒半径：' + animals.length + ' 只全部逐只对账');
    ok(errs.length === 0, '圆柱半径 = 几何局部盒半径 × baseScale（偏差 >2% 的 ' + errs.length + ' 只：' +
       (errs.slice(0, 3).join('; ') || '无') + '）');
    /* 体高同样对一次：底面归零 ⇒ y0 应≈0、h 应等于几何高度 × 缩放。 */
    const hErr = [];
    for (const a of animals) {
      const bb = a.g.userData.body.geometry.boundingBox;
      const wantH = (bb.max.y - bb.min.y) * a.baseScale;
      if (Math.abs(a.cyl.h - wantH) > 0.02) hErr.push(a.species.key + ' h=' + a.cyl.h.toFixed(3) + ' 期望 ' + wantH.toFixed(3));
      if (Math.abs(a.cyl.y0) > 0.02) hErr.push(a.species.key + ' y0=' + a.cyl.y0.toFixed(3) + '（底面应≈0）');
    }
    ok(hErr.length === 0, '体高 = 几何高度 × baseScale，且底面贴地（y0≈0）（问题 ' + hErr.length + ' 个：' +
       (hErr.slice(0, 3).join('; ') || '无') + '）');
  }
}

/* Real slaughter registers a dynamic compound bone body; live AI also avoids its bounds. */
{
  const a = animals.find(x => x.species.glb && !x.captured);
  const saved = { x: player.x, z: player.z, yaw: player.yaw };
  player.x = 0; player.z = 0;
  a.x = 1.5; a.z = 1.5;
  a.g.position.set(a.x, sampleHeight(a.x, a.z), a.z);
  ok(captureAnimal(a) === true, '先把它吸进弹夹（屠宰只认背包里的那只）');
  magToBag(0);
  const k = pals.indexOf(a);
  ok(k >= 0, '它已经在背包里（下标 ' + k + '）');
  const n0 = corpses.length;
  ok(slayPal('bag', k) === true, '屠宰成功');
  ok(!isSolid(a) && a.slaughterPhase === 'launch', '投射期间不参与静态碰撞');
  for (let i=0;i<100;i++) updateSlaughter(.016);
  ok(corpses.length === n0 + 1, '尸体进了 corpses（' + n0 + ' → ' + corpses.length + '）');
  const c = corpses[corpses.length - 1];
  ok(c.cyl.r>0&&c.cyl.h>0&&bonePhysics.status(c)?.mass>0&&bonePhysics.status(c)?.shapes===2,
     '骨头具有动态复合碰撞体，碰撞尺寸来自骨头本身');
  ok(isSolid(c) === true, '尸体仍然算"实体"（参与碰撞解算：活体绕着它滑开）');
  player.x = saved.x; player.z = saved.z; player.yaw = saved.yaw;
}

/* --- ④ 碰撞：重叠会被解算掉，而且是**滑动**不是卡死 ---
   把除被测目标外的所有生物临时 captured = true"下架"：
   isSolid() 与主循环都会跳过它们 ⇒ 得到一个**干净的两人场景**，
   否则 40 只里随便一只路过就会污染判据（而且结论会依赖它们恰好站在哪）。
   测完必须还原 —— 这只是借用 captured 这个字段当开关，不是真的把它们收进弹夹。 */
{
  const ob = corpses[corpses.length - 1];                 // 上面那具尸体：静态障碍
  bonePhysics.teleport(ob,{x:0,y:sampleHeight(0,0),z:0});
  for(let i=0;i<240;i++)bonePhysics.step(1/60);

  const live = animals.find(a => a.species.glb && !a.captured);
  const others = animals.filter(a => a !== live);
  const savedFlags = others.map(a => a.captured);
  others.forEach(a => { a.captured = true; });
  player.x = 9999; player.z = 9999;                       // 退出逃跑半径

  const savedL = { x: live.x, z: live.z, heading: live.heading, turning: live.turning, timer: live.timer, wallT: live.wallT, phase: live.phase };
  const sum = ob.cyl.r + live.cyl.r;
  live.turning = 0; live.timer = 1e9; live.wallT = 0;

  /* 先把**重叠**造出来（间距 = 半径和的 40%），跑几帧看有没有被分开。 */
  live.heading = 0;                                       // forward = (0,−1)：与接触法向垂直（切向）
  live.x = sum * 0.4; live.z = 0;
  for (let i = 0; i < 8; i++) loop(0.016);
  const dAfter = Math.hypot(live.x - ob.x, live.z - ob.z);
  console.log('  重叠 60% 起步 → 8 帧后间距 ' + dAfter.toFixed(3) + ' m（半径和 ' + sum.toFixed(3) + '）');
  ok(dAfter >= sum - 0.02, '重叠被解算掉了（间距 ' + dAfter.toFixed(3) + ' >= 半径和 ' + sum.toFixed(3) + '）');

  /* 再验**滑动**：起点刚好贴着（不重叠），朝向仍是切向 ⇒ 它应该贴着障碍滑走。
     为什么必须用切向：朝法向的话"位移≈0"是**正确**行为（它本来就前进不了），
     拿它当判据会把"正确"判成"卡死"。切向才是区分"滑开 vs 被钉住"的那一刀。
     为什么用**尸体**当障碍而不是另一只活体：尸体不动，是干净参照物；
     两只活体都动的话，得测相对位移，判据会绕。 */
  live.x = sum * 1.01; live.z = 0;
  const x0 = live.x, z0 = live.z;
  for (let i = 0; i < 60; i++) loop(0.016);
  const dz = Math.abs(live.z - z0), dx = Math.abs(live.x - x0);
  const dEnd = Math.hypot(live.x - ob.x, live.z - ob.z);
  console.log('  贴着障碍朝切向跑 1 秒：切向位移 ' + dz.toFixed(3) + ' m｜法向位移 ' + dx.toFixed(3) +
              ' m｜结束间距 ' + dEnd.toFixed(3) + ' m');
  ok(dz > 0.25, '贴着障碍仍能沿**切向**滑走（切向位移 ' + dz.toFixed(3) + ' m > 0.25 ⇒ 不是被钉在原地）');
  ok(dEnd >= sum - 0.02, '滑动全程没有插进障碍里（结束间距 ' + dEnd.toFixed(3) + ' >= ' + sum.toFixed(3) + '）');

  /* 两两重叠：任意两只的间距都不小于半径和（解算收敛的**全局**判据，
     而不是只看刚才那一对）。 */
  {
    others.forEach(a => { a.captured = false; });
    for (let i = 0; i < 4; i++) loop(0.016);
    let pen = 0, worst = 0;
    const list = animals.filter(isSolid);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = Math.hypot(list[j].x - list[i].x, list[j].z - list[i].z);
        const over = (list[i].cyl.r + list[j].cyl.r) - d;
        if (over > 0.02) pen++;
        if (over > worst) worst = over;
      }
    }
    console.log('  全群两两重叠 = ' + pen + ' 对（参与解算 ' + list.length + ' 只，最大侵入 ' + worst.toFixed(3) + ' m）');
    ok(pen === 0, list.length + ' 只全群两两不重叠（侵入 >2 cm 的 ' + pen + ' 对）');
    others.forEach((a, i) => { a.captured = savedFlags[i]; });
  }
  Object.assign(live, savedL);
  live.g.position.set(live.x, live.y, live.z);
  /* 清掉那具当障碍用的尸体：留着会多一个静态障碍，污染后面章节的滑动/位置断言。 */
  bonePhysics.remove(ob);
  corpses.length = 0;
  ob.g.visible = false;
}

/* --- ⑤ 拉伸弹跳：轨道性质 + 真的写进身体 + 与外形无关 --- */
{
  /* sampleHop 是纯函数，可以直接对轨道本身下断言 —— 而且**必须**这样测：
     只测"body.scale 在变"是抓不到"没有过冲、没有蓄力"的（那些都是手感的关键）。 */
  const ids = t => sampleHop(t);
  const crouch = ids(0.16);          // 蓄力极值
  const launch = ids(0.30);          // 起跳极值
  const land   = ids(0.78);          // 触地压缩极值
  const over   = ids(0.88);          // 回弹过冲极值
  console.log('  轨道关键帧：蓄力 sy=' + crouch.sy.toFixed(2) + ' sxz=' + crouch.sxz.toFixed(2) +
              '｜起跳 sy=' + launch.sy.toFixed(2) + ' sxz=' + launch.sxz.toFixed(2) + ' lift=' + launch.lift.toFixed(2) +
              '｜触地 sy=' + land.sy.toFixed(2) + ' sxz=' + land.sxz.toFixed(2) +
              '｜过冲 sy=' + over.sy.toFixed(2) + ' lift=' + over.lift.toFixed(2));
  ok(crouch.sy < 0.85 && crouch.sxz > 1.05, '蓄力段：压扁 + 横向铺开（体积补偿成对）');
  ok(launch.sy > 1.2 && launch.sxz < 0.9, '起跳段：拉长 + 横向收窄');
  ok(land.sy < 0.8, '触地段：最猛的一次压缩（sy ' + land.sy.toFixed(2) + ' < 0.8）');
  /* **过冲**是"Q弹"的可核判据：落地回弹必须冲过静息位（sy > 1）再回来。
     少了这一段，动画就是"压扁→弹回"，读起来是硬的。 */
  ok(over.sy > 1.05 && over.lift < 0.02, '回弹段**冲过静息位**（过冲 sy ' + over.sy.toFixed(2) + ' > 1.05 且已贴地）');
  /* 体积补偿：sy 与 sxz **整体反向**成对（拉长时横向收窄）。逐点扫一遍。
     ⚠️ 判据不能写成"逐点严格反向"：轨道是**分段插值**的，两段缓动在两个轴上的
        穿越时刻不完全重合 ⇒ 在"从蓄力切到起跳"、"从过冲切回静息"这两处，
        会有一小段两个轴**同向**（都 >1 或都 <1）。
        第一版按"逐点严格"判，就红了 —— 那两段的偏差量都 <0.03，肉眼与观感都看不出来，
        所以这里给 **0.03 的死区**：只把"看得出来地同向"算作违背。
        这既保住了"体积补偿确实成立"这个真结论，也不会因为插值细节假红。 */
  {
    const TOL = 0.03;
    let bad = 0, samples = 0, maxAbs = 0, sameDirMax = 0;
    for (let i = 0; i <= 400; i++) {
      const q = ids(i / 400);
      const dy = q.sy - 1, dx = q.sxz - 1;
      samples++;
      maxAbs = Math.max(maxAbs, Math.abs(dy));
      if (dy > TOL && dx > TOL) { bad++; sameDirMax = Math.max(sameDirMax, Math.min(dy, dx)); }
      if (dy < -TOL && dx < -TOL) { bad++; sameDirMax = Math.max(sameDirMax, Math.min(-dy, -dx)); }
    }
    console.log('  扫 ' + samples + ' 点：sy 最大偏离 ±' + maxAbs.toFixed(2) +
                '｜同向偏差 >' + TOL + ' 的点 = ' + bad + '（最大 ' + sameDirMax.toFixed(3) + '）');
    ok(bad === 0, 'sy 与 sxz 始终反向成对（同向偏差 >' + TOL + ' 的点应为 0）');
    ok(maxAbs > 0.25, '形变幅度够大、看得见（最大 ±' + maxAbs.toFixed(2) + '）');
  }
  /* lift 非负、且确实到过顶（不然只是"原地抖"）。 */
  {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 200; i++) { const L = ids(i / 200).lift; lo = Math.min(lo, L); hi = Math.max(hi, L); }
    ok(lo >= 0, '离地系数全程不为负（不会陷进地面）');
    ok(hi > 0.95, '确实跳到过最高点（peak lift ' + hi.toFixed(2) + '）');
    /* 周期首尾必须衔接：t=0 与 t=1 是同一个姿态，否则每跳一次都会"啪"地跳一下。 */
    const a0 = ids(0), a1 = ids(1 - 1e-9);
    ok(Math.abs(a0.sy - a1.sy) < 0.01 && Math.abs(a0.sxz - a1.sxz) < 0.01,
       '相位首尾无缝衔接（t=0 sy=' + a0.sy.toFixed(3) + ' vs t→1 sy=' + a1.sy.toFixed(3) + '）');
  }
  /* 真的写进了身体：跑一段帧，看真实出现过的 sy 范围 —— 
     直接读 body.scale（而不是再算一遍 sampleHop），
     否则测的是"公式能算"而不是"帧循环真的调了它"。 */
  {
    const a = animals.find(x => x.species.glb);
    let syLo = Infinity, syHi = -Infinity, sxzLo = Infinity, sxzHi = -Infinity;
    for (let i = 0; i < 120; i++) {
      loop(0.016);
      const s = a.g.userData.body.scale;
      syLo = Math.min(syLo, s.y); syHi = Math.max(syHi, s.y);
      sxzLo = Math.min(sxzLo, s.x); sxzHi = Math.max(sxzHi, s.x);
    }
    console.log('  120 帧里 body.scale 实测 y ∈ [' + syLo.toFixed(2) + ', ' + syHi.toFixed(2) +
                ']  x/z ∈ [' + sxzLo.toFixed(2) + ', ' + sxzHi.toFixed(2) + ']');
    ok(syHi > 1.15 && syLo < 0.85, 'body.scale.y 真的走过了"拉长 >1.15 / 压扁 <0.85"两端');
    ok(sxzLo < 0.95 && sxzHi > 1.05, 'body.scale.x/z 也跟着反向走了（不是只缩 Y）');
    ok(Math.abs(a.g.scale.x - a.baseScale) < 1e-9,
       'group.scale 没被动过（还是 baseScale）—— 形变只作用在 body 上，不与捕获/抛出打架');
  }
  /* 与外形无关：这条只能靠**结构**断言（场上只有一种外形，没法用两个形状对比）。
     判据 = 帧循环里不存在按步态/物种分支的代码。
     ⚠️ 这条要在 0b 节用 htmlSrc 静态查（见那里），不能写在这里 —— 
        driver 会被拼进游戏模块，那个作用域里没有 htmlSrc。 */
  ok(animals.filter(a => a.g.userData.kind === 'land').every(a => !!a.g.userData.body),
     '每个陆生生物都有 ud.body（形变的作用对象），所以换任何外形都不缺目标');
}

sec('10. 飞行物理');
player.x = 0; player.z = 0; player.y = sampleHeight(0, 0);
player.vx = player.vz = 0; player.vy = 0;
player.onGround = true; player.flying = false;
state.stamina = 100;
enterFlight();
ok(player.flying === true, 'enterFlight() 进入飞行模式');
/* 这里直接改 keys —— 走 keydown 监听器会踩到「双击空格」的 300ms 判定窗口，
   那是接线层的职责，交给 input.mjs 测。 */
const groundY = sampleHeight(0, 0);
keys['Space'] = true;
let peakY = player.y;
for (let i = 0; i < 60; i++) { loop(); peakY = Math.max(peakY, player.y); }
keys['Space'] = false;
console.log('  按住空格 1 秒上升 ' + (peakY - groundY).toFixed(1) + ' m（体力 ' + state.stamina.toFixed(0) + '）');
ok(peakY - groundY > 3, '按住空格上升（' + (peakY - groundY).toFixed(1) + ' m）');
const hoverY = player.y;
for (let i = 0; i < 60; i++) loop();
console.log('  松手 1 秒后高度变化 ' + (player.y - hoverY).toFixed(2) + ' m');
ok(Math.abs(player.y - hoverY) < 1.5, '松手后悬停：不掉也不继续升');
keys['ShiftLeft'] = true;
const beforeDown = player.y;
for (let i = 0; i < 40; i++) loop();
keys['ShiftLeft'] = false;
console.log('  按住 Shift 0.66 秒下降 ' + (beforeDown - player.y).toFixed(1) + ' m');
ok(player.y < beforeDown - 1, '飞行时 Shift 是下降（不是冲刺）');

player.y = FLY_CEIL + 50; player.vy = 0;
keys['Space'] = true;
for (let i = 0; i < 30; i++) loop();
keys['Space'] = false;
ok(player.y <= FLY_CEIL + 0.01, '高度被钳制在 ' + FLY_CEIL + ' m 以内（实际 ' + player.y.toFixed(1) + '）');

sec('11. 体力耗尽 → 强制取消飞行');
state.stamina = 0.4;
player.y = sampleHeight(player.x, player.z) + 20;
player.vy = 0; player.flying = true;
let flErr = null, flFrames = 0;
try { while (player.flying && flFrames++ < 120) loop(); } catch (e) { flErr = e; }
ok(!flErr, '体力耗尽过程无异常' + (flErr ? '：' + flErr.message : ''));
ok(player.flying === false, '飞行模式已被强制取消（' + flFrames + ' 帧后）');
/* 注意：落地后玩家是站定状态，体力会按 STAM_REGEN_IDLE 回气 ——
   所以只能断言"刚刚被压到过 0 附近"，不能断言仍然是 0。 */
console.log('  强制降落后体力 = ' + state.stamina.toFixed(2));
ok(state.stamina < 5, '体力确实被压到过 0 附近（' + state.stamina.toFixed(2) + '）');
for (let i = 0; i < 300; i++) loop();
ok(Math.abs(player.y - sampleHeight(player.x, player.z)) < 0.05,
   '强制降落后落回地面（离地 ' + (player.y - sampleHeight(player.x, player.z)).toFixed(2) + ' m）');
state.stamina = 0;
enterFlight();
ok(player.flying === false, '力竭状态下 enterFlight() 拒绝起飞');

sec('12. 背包数据渲染');
const fakeEntry = { species: SPECIES_LIST[0], baseScale: 1.00 };
mag.push(fakeEntry);
let bagErr = null;
try { setBagPage(0); setBagPage(1); } catch (e) { bagErr = e; }
ok(!bagErr, 'renderBag() 两页都能渲染' + (bagErr ? '：' + bagErr.message : ''));
ok(el('bagPage0').innerHTML.includes(SPECIES_LIST[0].name), '帕鲁页列出了弹夹里的物种名');
/* 原来这里有 3 条图鉴断言（区块存在 / 进度 n / n / 两个史莱姆都在列 —— 见 git 历史）。
   图鉴整套删除后方向翻过来：**页里不许再出现图鉴**。
   判据同时查文案与 DOM 结构（.dex 列表 / <i class="got"> 勾），因为"删了标题留了列表"
   是这类删改最可能出现的半途状态，而那半截在画面上是看不见的（没有数据就是空盒子）。 */
{
  const h0 = el('bagPage0').innerHTML;
  ok(!h0.includes('物种图鉴'), '帕鲁页不再有图鉴区块');
  ok(!/物种图鉴|class="dex"|<i[^>]*class="[^"]*got/.test(h0), '帕鲁页没有残留的图鉴 DOM / 勾');
  ok(h0.includes('弹夹') && h0.includes('背包'), '帕鲁页仍有弹夹 / 背包两块（删图鉴没有误伤主体）');
}
/* Breeding now lives in the world, not a second inventory page. */
{
  setBagPage(1);
  ok(bag.page === 0 && bagPageEls.length === 1, '旧切页调用仍只显示库存');
  ok(!/data-breed-/.test(el('bagPage0').innerHTML), '库存不包含繁衍操作');
  const pods = []; scene.traverse(o => { if (o.name === 'breeding-pod') pods.push(o); });
  ok(pods.length === 3, '世界恰有三个太空舱');
  ok(pods[0].position.x === 0 && pods[0].position.z === 23, '太空舱位于预留空地');
  ok(pods.every((pod,id)=>pod.position.x===CHAMBER_POSITIONS[id].x
    &&pod.position.z===CHAMBER_POSITIONS[id].z), '三个舱都使用配置位置');
  ok(typeof openPalMenu === 'undefined', '旧右键繁衍入口不存在');
}
/* 屠宰块：它在卡片最下方，**不在任何一页里**，所以它不属于上面任何一组断言。
   这里只守一条：页面上的计数**跟着真数组走** —— 写死成 0 的假计数同样会露馅。 */
ok(el('slayCount').textContent === String(corpses.length),
   '屠宰块计数 = corpses.length（页面上 ' + el('slayCount').textContent + ' / 实际 ' + corpses.length + '）');
mag.pop();

/* ============================================================
   12b. 弹夹（10）⇄ 背包（999）
   ------------------------------------------------------------
   这一节要守住的核心约束来自需求原文：
     · 吸入的帕鲁进**弹夹**，不直接进背包
     · 背包里的帕鲁**发射不了**，必须手动拖回弹夹
     · 弹夹装不下时**不吸**，而不是溢出到背包
   全部走真实入口（captureAnimal / transferPal / allMagToBag / trySpit），
   不手工构造内部结构 —— 测试里的 release() 只用来在**小节末尾**把
   这一节造出来的动物放回世界，不参与任何断言的推导。
   ============================================================ */
sec('12b. 弹夹（10）⇄ 背包（999）');
ok(MAG_MAX === 10 && BAG_MAX === 999, '容量常量：弹夹 ' + MAG_MAX + ' / 背包 ' + BAG_MAX);
ok(mag !== pals && Array.isArray(mag) && Array.isArray(pals), '弹夹与背包是两个独立的池子');

const release = a => { a.captured = false; a.g.visible = true; a.g.scale.setScalar(a.baseScale); };
while (mag.length) release(mag.shift());
while (pals.length) release(pals.shift());
ok(mag.length === 0 && pals.length === 0, '起点：弹夹 0 / 背包 0');

ok(magToBag(0) === false && bagToMag(0) === false, '两边都空时转移返回 false（不抛错）');
ok(transferPal('nope', 0) === false, '未知来源不做事');
ok(allMagToBag() === 0, '弹夹空时「全部转入」返回 0');

/* --- 装满弹夹（场上有 41 只，吸 10 只绰绰有余） --- */
const grabs = [];
let grabErr = null;
try {
  while (mag.length < MAG_MAX) {
    const a = animals.find(x => !x.captured && !x.launch && x.g.userData.kind === 'land');
    if (!a) break;
    if (captureAnimal(a) !== true) break;
    grabs.push(a);
  }
} catch (e) { grabErr = e; }
ok(!grabErr, '连续吸入无异常' + (grabErr ? '：' + grabErr.message : ''));
ok(mag.length === MAG_MAX, '弹夹正好装满 ' + MAG_MAX + ' 只（实际 ' + mag.length + '，吸了 ' + grabs.length + ' 次）');

/* 满了以后：吸不进**且不溢出到背包** —— "必须手动拖"这条设计全靠它 */
{
  const extra = animals.find(x => !x.captured && !x.launch && x.g.userData.kind === 'land');
  ok(!!extra, '场上还有可吸的动物（否则下面这条断言没意义）');
  const r = extra ? captureAnimal(extra) : true;
  ok(r === false && mag.length === MAG_MAX && pals.length === 0,
     '弹夹满时拒绝吸入，且没有溢出到背包（弹夹 ' + mag.length + ' / 背包 ' + pals.length + '）');
  if (r === false) ok(extra.captured !== true && extra.g.visible === true, '被拒绝的那只留在世界里');
}

/* --- 弹夹 → 背包（走真实入口 transferPal） --- */
const head = mag[0];
ok(transferPal('mag', 0) === true, '拖弹夹第 0 格 → 背包：成功');
ok(mag.length === MAG_MAX - 1 && pals.length === 1,
   '两侧计数都动了（弹夹 ' + mag.length + ' / 背包 ' + pals.length + '）');
ok(pals[0] === head, '搬过去的就是弹夹最前面那只（FIFO 语义一致）');
ok(transferPal('mag', 99) === false && transferPal('mag', -1) === false, '越界索引被拒');

/* --- 背包 → 弹夹 --- */
const back = pals[0];
ok(transferPal('bag', 0) === true, '拖背包第 0 格 → 弹夹：成功');
ok(pals.length === 0 && mag.length === MAG_MAX,
   '两侧计数都动了（背包 ' + pals.length + ' / 弹夹 ' + mag.length + '）');
ok(mag[mag.length - 1] === back, '拖回来的那只排在弹夹**末尾**，不插队');

/* --- 「全部转入背包」 --- */
const moved = allMagToBag();
ok(moved === MAG_MAX && mag.length === 0 && pals.length === MAG_MAX,
   '「全部转入背包」搬走 ' + moved + ' 只（弹夹 ' + mag.length + ' / 背包 ' + pals.length + '）');
ok(allMagToBag() === 0, '再按一次没东西可搬，返回 0');

/* --- 逐个拖回弹夹（真实入口重复 10 次） --- */
let eachOk = true;
for (let i = 0; i < MAG_MAX; i++) if (bagToMag(0) !== true) eachOk = false;
ok(eachOk && mag.length === MAG_MAX && pals.length === 0, '逐个拖回 10 只：弹夹满、背包空');

/* --- 弹夹满 + 背包非空 ⇒ 从背包拖进来必须被拒 --- */
transferPal('mag', 0);
ok(mag.length === MAG_MAX - 1 && pals.length === 1, '制造出「弹夹 9 / 背包 1」的中间态');
{
  const a = animals.find(x => !x.captured && !x.launch && x.g.userData.kind === 'land');
  if (a) captureAnimal(a);
}
ok(mag.length === MAG_MAX, '弹夹已补满（' + mag.length + '）');
ok(transferPal('bag', 0) === false, '弹夹满时从背包拖进来被拒');
ok(pals.length === 1 && mag.length === MAG_MAX,
   '被拒后两侧都没动（背包 ' + pals.length + ' / 弹夹 ' + mag.length + '）');

/* --- 发射只认弹夹 --- */
bag.open = false; paused = false;
const bagOnly = pals[0];
ok(bagOnly.captured === true, '背包里那只处于"已捕获"状态');
for (let i = 0; i < MAG_MAX; i++) trySpit();
ok(mag.length === 0, '按 G ' + MAG_MAX + ' 次把弹夹打空');
ok(pals.length === 1 && bagOnly.captured === true && bagOnly.g.visible === false,
   '弹夹打空后，背包里那只**没有**被发射（仍是收起状态）');
trySpit();
ok(pals.length === 1 && bagOnly.captured === true, '弹夹空时再按 G 也不会动背包 —— 只能发射弹夹里的');

/* --- 背包上限 999 同样是**真的**上限，不是装饰 ---------------------------------
   这条分支同样"不加测试就永远跑不到"：没人会往背包塞 999 只。
   做法：**只把数组长度顶到上限**（pals.length = BAG_MAX 会造出空槽），
   再照常走真实入口 magToBag / allMagToBag，看它们认不认这个上限。
   为什么可以这样改：四个搬运函数只读 pals.length 与 pals.splice、并不遍历内容，
   所以"长度到上限"就是它们眼里的"满了"。
   ⚠️ 只在本段内改，段尾必须原样还回去（下面有还原断言兜着）。 */
{
  const keepPals = pals.splice(0, pals.length);          // 先把原有那 1 只取出来
  const aCap = animals.find(x => !x.captured && !x.launch && x.g.userData.kind === 'land');
  ok(!!aCap, '场上还有可吸的动物（否则下面这条上限断言没意义）');
  if (aCap) captureAnimal(aCap);
  const magBefore = mag.length;
  ok(magBefore >= 1, '弹夹里有一只可以尝试搬走（' + magBefore + '）');

  pals.length = BAG_MAX;
  ok(pals.length === BAG_MAX, '背包长度已顶到上限 ' + BAG_MAX);
  ok(magToBag(0) === false, '背包满时 magToBag 返回 false（不抛错、也不丢件）');
  ok(mag.length === magBefore, '被拒后弹夹没动（' + mag.length + ' / ' + magBefore + '）');
  ok(allMagToBag() === 0, '背包满时「全部转入」一只都搬不动（返回 0）');
  ok(mag.length === magBefore, '同上，弹夹仍然一只没少（' + mag.length + '）');

  pals.length = 0;                                       // 还原
  for (const a of keepPals) pals.push(a);
  ok(pals.length === keepPals.length, '背包内容已还原（' + pals.length + ' 只）');
  if (aCap) { release(aCap); mag.shift(); }               // 把试验用的那只放回世界
  ok(mag.length === magBefore - 1, '试验用的那只已放回世界（弹夹 ' + mag.length + '）');
}

/* 收尾：把这一节造出来的东西放回世界 */
release(bagOnly); pals.shift();
ok(mag.length === 0 && pals.length === 0, '本节收尾：弹夹与背包都清空');

/* ============================================================
   12c. 屠宰块
   ------------------------------------------------------------
   背包拖入屠宰块后关闭 UI，投射生物，落地爆炸并留下 Q 版骨头。
   走真实入口 transferPal('bag', idx, 'slay') —— 也就是 UI 的 drop 处理器
   实际调的那个函数、实际用的参数顺序（区名要传下去），不直接调 slayPal。
   ============================================================ */
sec('12c. 屠宰块（背包 → 尸体）');
{
  /* 造 3 只进背包（走的仍是 吸入 → 搬进背包 那条真实数据流） */
  for (let i = 0; i < 3; i++) {
    const a = animals.find(x => !x.captured && !x.launch && !x.species.fly);
    if (!a) break;
    a.x = player.x + 1.5; a.z = player.z + 1.5;
    a.g.position.set(a.x, sampleHeight(a.x, a.z), a.z);
    if (!captureAnimal(a)) break;
    magToBag(0);
  }
  ok(pals.length === 3, '准备就绪：背包里 3 只（' + pals.length + '）');

  /* ① 弹夹里的不能直接屠宰 —— 用户说的是"从背包拖拽" */
  {
    const mOnly = animals.find(x => !x.captured && !x.launch && !x.species.fly);
    if (mOnly) captureAnimal(mOnly);
    const magN = mag.length, palN = pals.length;
    ok(magN >= 1, '弹夹里有一只备用（' + magN + '）');
    ok(transferPal('mag', 0, 'slay') === false, '弹夹里的拖到屠宰块会被拒（只认背包）');
    ok(mag.length === magN && pals.length === palN,
       '被拒之后两边都没动（弹夹 ' + mag.length + ' / 背包 ' + pals.length + '）');
    magToBag(0);                                  // 收进背包，别污染后面的计数
  }

  /* ② 越界 / 未知来源一律 false，不抛错 */
  ok(transferPal('bag', 99, 'slay') === false && transferPal('bag', -1, 'slay') === false,
     '越界索引被拒（返回 false 而不是抛错）');
  ok(transferPal('nope', 0, 'slay') === false, '未知来源被拒');

  /* ③ 真宰一只 */
  player.yaw = 0;                                  // 前方向 = (-sin0, -cos0) = (0, -1)，算起来干净
  const victim = pals[0];
  const palN0 = pals.length, aniN0 = animals.length;
  /* Preserve references to prove that shared living-creature materials stay unchanged. */
  const matBefore = [];
  victim.g.traverse(o => { if (o.isMesh) matBefore.push(o.material); });
  const x0 = player.x, z0 = player.z;
  ok(transferPal('bag', 0, 'slay') === true, '屠宰成功（返回 true）');
  ok(pals.length === palN0 - 1, '背包里少了一只（' + palN0 + ' → ' + pals.length + '）');
  ok(animals.length === aniN0 - 1, 'animals 里也少了一只（' + aniN0 + ' → ' + animals.length + '）');
  ok(animals.indexOf(victim) === -1, '它已经不在 animals 里（AI / 吸尘器 / 观测都碰不到它了）');
  ok(corpses.length === 1 && corpses[0] === victim, 'corpses 收下了这一只（' + corpses.length + '）');
  ok(victim.dead === true && victim.captured === false, '标记为 dead 且不再是"已捕获"');
  ok(victim.g.visible === true && victim.g.scale.x === victim.baseScale, '尸体可见、缩放已还原');
  ok(victim.launch?.t === 0 && victim.launch.dur === .55 && victim.launch.peak === 3.6,
     '使用普通投射的时长与抛物线高度');
  const originalGroup = victim.g;
  const burstCount = slaughterBursts.length;
  updateSlaughter(.275);
  ok(victim.launch && victim.x === x0 && Math.abs(victim.z-(z0-CORPSE_DIST/2))<1e-9,
     '投射中途的位置沿现有抛物线前进');
  ok(slaughterBursts.length === burstCount, '落地前不提前爆炸');
  updateSlaughter(.275);
  ok(victim.slaughterPhase === 'anticipation' && !victim.launch, '落地后短暂膨胀');
  updateSlaughter(.2);
  ok(victim.slaughterPhase === 'bones' && slaughterBursts.length === burstCount+1,
     '落地后只创建一次爆炸');
  updateSlaughter(.5);

  ok(Math.abs(victim.x - x0) < .2 && Math.abs(victim.z - (z0 - CORPSE_DIST)) < .2,
     '落在玩家正前方 ' + CORPSE_DIST + ' m（实测 dx=' + (victim.x - x0).toFixed(2) +
     ' dz=' + (victim.z - z0).toFixed(2) + '）');
  ok(victim.boneBounds.minY>=sampleHeight(victim.x,victim.z)-.03,
     '动态骨头碰撞体没有穿过地面');
  ok(Math.abs(victim.g.position.x - victim.x) < 1e-9 && Math.abs(victim.g.position.z - victim.z) < 1e-9
     && Math.abs(victim.g.position.y - victim.y) < 1e-9, '网格位置跟着一起搬了');

  /* Bone meshes replace the original without mutating shared creature materials. */
  {
    const matAfter = [];
    victim.g.traverse(o => { if (o.isMesh) matAfter.push(o.material); });
    ok(victim.g.name === 'cartoon-bone-remains' && victim.g !== originalGroup,
       '原生物替换为圆润骨头遗体');
    ok(originalGroup.parent === null, '原生物从场景移除');
    ok(matAfter.length > 0 && matAfter.every(m => !matBefore.includes(m)),
       '骨头不复用生物材质');
    const stillOriginal = [];
    originalGroup.traverse(o => { if (o.isMesh) stillOriginal.push(o.material); });
    ok(stillOriginal.every((m,i) => m === matBefore[i]), '原生物的共享材质未改动');
    ok(matAfter.every(m => !m.transparent && m.opacity === 1), '骨头材质不透明');
    const effect = slaughterBursts[slaughterBursts.length-1];
    ok(effect.pieces.filter(p => p.isBlood).length === 32, '爆炸带有圆润红色飞溅');
    const burstAge = effect.age;
    const wasPaused = paused;
    paused = true;loop();paused = wasPaused;
    ok(effect.age === burstAge, '暂停时爆炸粒子不推进');
  }

  /* Settled rigid bodies sleep instead of continuing live AI movement. */
  {
    for(let i=0;i<300;i++)updateSlaughter(1/60);
    const px = victim.x, pz = victim.z, py = victim.y;
    const vis = victim.g.visible;
    for (let i = 0; i < 60; i++) loop();
    ok(Math.hypot(victim.x-px,victim.y-py,victim.z-pz)<.03,
       '稳定后的骨头停止明显运动');
    ok(victim.g.visible === vis, '仍然可见（没被哪个系统顺手藏起来）');
    ok(pals.indexOf(victim) === -1, '也不在背包里（不会被再拖一次）');
  }

  /* Loaded models use the same effect without changing shared textures. */
  {
    const n0 = corpses.length;
    const slime = animals.find(x => x.species.glb && !x.captured && !x.launch);
    ok(!!slime, '场上还有史莱姆可以宰（带贴图的物种）');
    if (slime) {
      const srcMats = [];
      slime.g.traverse(o => { if (o.isMesh) srcMats.push(o.material); });
      const srcMaps = srcMats.map(m => m.map);
      const hasMap = srcMaps.some(m => !!m);
      ok(hasMap, '这只史莱姆确实带贴图（否则下面那条断言是空跑）');

      if (captureAnimal(slime)) magToBag(0);
      ok(pals.indexOf(slime) >= 0, '它已经在背包里（索引 ' + pals.indexOf(slime) + '）');
      ok(transferPal('bag', pals.indexOf(slime), 'slay') === true, '宰掉这只史莱姆');
      const c = corpses[corpses.length - 1];
      ok(c === slime && corpses.length === n0 + 1,
         '再宰一只：corpses ' + n0 + ' → ' + corpses.length);
      ok(corpses[0] !== corpses[1], '两具尸体是不同对象');

      /* 下面全是要读 c 的。c 不存在 = "尸体压根没进 corpses"（例如 slayPal 里
         那句 push 被人删了）—— 这时候**不要**让它抛 TypeError 把整个 driver 打断：
         那样后面的断言一条都跑不到，报错信息也只剩一句 "Cannot read properties of
         undefined"，看不出是哪条契约破了。这里显式改成一条 FAIL 然后跳过。 */
      if (!c) {
        ok(false, '尸体没进 corpses ⇒ 材质那一组断言无法进行（器皿是空的）');
      } else {
        for (let i=0;i<100;i++) updateSlaughter(.016);
        const newMats = [];
        c.g.traverse(o => { if (o.isMesh) newMats.push(o.material); });
        ok(c.g.name === 'cartoon-bone-remains' && newMats.every(m => !srcMats.includes(m)),
           '带贴图模型也替换为独立的骨头遗体');
        ok(srcMats.every((m, i) => m.map === srcMaps[i]),
           '原材质的贴图一个都没被动（同一物种另外 3 只共用它）');
        for (let i=0;i<320;i++) updateSlaughter(.016);
        ok(slaughterBursts.length === 0, '飞溅淡出后移除临时特效');
        ok(c.g.parent === scene && c.slaughterPhase === 'bones', '飞溅消失后骨头仍保留');
      }
    }
  }

  /* 收尾：把背包里剩下的放回世界，别让后面的东西看到"半路状态" */
  while (pals.length) release(pals.shift());
  ok(mag.length === 0 && pals.length === 0 && corpses.length === 2,
     '本节收尾：弹夹 0 / 背包 0 / 尸体 ' + corpses.length + ' 具');
}

/* ============================================================
   12d. 基因 与 繁衍（2026-09-23 用户规则）
   ------------------------------------------------------------
   这一节守的是"规则被实现成了规则本身"，而不是"页面看起来像那么回事"：
     · 每位 50% 继承（**逐位**二选一）
     · 每位基础 5% 突变，辐射可提升至 25%，整表随机且一定改变原值
     · 突变提示只说位点名，基因和提示词不提前暴露
     · 离线演示计时暂停不走；HTTP 以真实模型就绪为准，接生后亲代留槽位
     · 占位球把基因里能程序化表达的部分真的表出来（尺寸/颜色/质感/发光）
   ============================================================ */
sec('12d. 基因 与 繁衍');

/* --- 基因表本身 --- */
ok(GENE_COUNT === 36, '基因位 = 36（用户表 32 位 + 09-23 追加的 4 个附属物位，实际 ' + GENE_COUNT + '）');
ok(GENE_DEFS[0].opts.length === 1, '序号 1「骨骼」只有一档（用户表里就是唯一值）');
ok(GENE_DEFS[1].opts.join('') === BODY_GRADES.join(''), '序号 2「体型」= 6 档 A~F');
ok(GENE_DEFS[2].opts.length === 13, '序号 3「主体色」= 13 档（5 纯 + 5 浅 + 灰黑白）');
ok(GENE_DEFS[3].opts.length === 8, '序号 4「主体质感」= 8 档');
ok(GENE_DEFS[4].opts.length === 4, '序号 5「主体形态」= 4 档');
/* ⚠️ 用户的表里角冠·形态**缺 E**（A B C D _ F G）。这里按 6 项如实登记，没有替他补。 */
ok(GENE_DEFS[13].opts.length === 6 && GENE_DEFS[13].opts.includes('头盔'),
   '序号 14「角冠·形态」按 6 项登记（用户的表缺 E，没替他补）');
{
  const onOff = GENE_DEFS.filter(d => d.opts === ON_OFF).length;
  const color = GENE_DEFS.filter(d => d.opts === COLOR_NAMES).length;
  console.log('  基因位构成：有无 ' + onOff + ' 个｜颜色 ' + color + ' 个（各 13 档）｜' +
              (GENE_COUNT - onOff - color) + ' 个其它');
  ok(onOff === 9, '"有/无"位 9 个（眼/耳/角冠/翼/尾/背脊/四肢/爪/发光）');
  ok(color === 10, '颜色位 10 个（主体色 + 9 个部件色）—— 光颜色就占 ' + (10 * 13) + ' 个基因位');
  ok(GENE_DEFS.every(d => d.say && d.opts.length >= 1), '每个位都有"突变提示用的说法"和非空档位');
}
ok(GENE_MUTATE_P === 0.05, '突变率 = 5%（用户规则）');
ok(BREED_SLOTS === 6 && BREED_PAIRS === 3, '三座舱分别持有两亲代槽位');

/* --- 附属物（2026-09-23 12:34 用户追加的 4 个位）---
   ⚠️ 这四位的结构与前面 9 组"部件"**不同**：这里是「数量 + 3 个形态位」，**没有颜色位**。
      用户只给了这 4 行 ⇒ 断言也只守这 4 行，不给它补颜色。 */
{
  const gAtt = GENE_DEFS.filter(d => d.opts === ATTACH_FORMS);
  console.log('  附属物：数量 ' + GENE_DEFS[G_ATTACH_N].opts.join(' / ') +
              '｜形态表 ' + ATTACH_FORMS.join(' / ') + '（' + gAtt.length + ' 行共用同一个数组）');
  ok(GENE_DEFS[G_ATTACH_N].opts.join(',') === '0,1,2,3', '序号 33「附属物数量」= 4 档（0/1/2/3）');
  ok(gAtt.length === 3, '附属物1/2/3 三行都在（实际 ' + gAtt.length + ' 行）');
  /* 三行**必须是同一个数组引用**：用户给的三行字面完全相同，
     共用引用之后就不可能"改一个忘一个"。 */
  ok(GENE_DEFS[G_ATTACH1].opts === GENE_DEFS[G_ATTACH1 + 1].opts &&
     GENE_DEFS[G_ATTACH1].opts === GENE_DEFS[G_ATTACH1 + 2].opts,
     '三行形态共用同一个数组（改一处三行一起改）');
  ok(ATTACH_FORMS.join(',') === '剑,盾牌,天使光环,卫星式光环,炸药包', '形态表与用户原文逐字一致');
  /* 这四位的"有无"关系：数量 0 ⇒ 三个形态位**不表达**（和"有无 = 无"同一套）。 */
  ok(!GENE_DEFS.some(d => d.opts === ON_OFF && d.n > 32), '附属物没有额外的"有无"位（数量自己承担了这个角色）');
}
{
  const g = initialGenomeFor({ key: 'slime-ring', body: 'A' });
  ok(attachCountOf(g) === 0, '初始基因的附属物数量 = 0（现有 40 只本来没有附属物）');
  ok(attachListOf(g).length === 0, '数量 0 ⇒ 一件都不带（形态位此刻不表达）');
  /* 数量 2 ⇒ 只取前两个形态位；第 3 件**即使有位里有值也不出现**。 */
  const g2 = g.slice();
  g2[G_ATTACH_N] = 2;
  g2[G_ATTACH1] = 0; g2[G_ATTACH1 + 1] = 2; g2[G_ATTACH1 + 2] = 4;
  console.log('  数量 2 时实际带：' + attachListOf(g2).join('、') +
              '（第 3 件基因位 = ' + GENE_DEFS[G_ATTACH1 + 2].opts[g2[G_ATTACH1 + 2]] + '，不表达）');
  ok(attachCountOf(g2) === 2, '数量档位 B ⇒ 2 件');
  ok(attachListOf(g2).join(',') === '剑,天使光环', '数量 2 ⇒ 取前两件（剑、天使光环）');
  const g3 = g2.slice(); g3[G_ATTACH_N] = 3;
  ok(attachListOf(g3).join(',') === '剑,天使光环,炸药包', '数量 3 ⇒ 三件全取');
  const g0 = g2.slice(); g0[G_ATTACH_N] = 0;
  ok(attachListOf(g0).length === 0, '把数量改回 0 ⇒ 立刻一件都不带（形态位不表达）');
}
{
  /* 提示词：数量 0 一个字都不写（写了会被生成出多余的东西）；数量 ≥1 才写。 */
  const g = initialGenomeFor({ key: 'slime-ring', body: 'A' });
  ok(!/附属物/.test(genomeToPrompt(g)), '数量 0 ⇒ 提示词里不出现"附属物"');
  const g2 = g.slice(); g2[G_ATTACH_N] = 2;
  g2[G_ATTACH1] = 1; g2[G_ATTACH1 + 1] = 3;
  const p2 = genomeToPrompt(g2);
  ok(/附属物 2 件（盾牌、卫星式光环）/.test(p2), '数量 2 ⇒ 提示词写成「附属物 2 件（盾牌、卫星式光环）」');
}
{
  /* 突变提示：位点名要和用户给的句式一致。 */
  const lines = mutationLines([GENE_DEFS[G_ATTACH_N], GENE_DEFS[G_ATTACH1]]);
  console.log('  附属物的突变提示：' + lines.join(' ／ '));
  ok(lines[0] === '附属物的数量发生了突变！！！', '第 33 位的提示文案（' + lines[0] + '）');
  ok(lines[1] === '附属物1的形态发生了突变！！！', '第 34 位的提示文案（' + lines[1] + '）');
}
ok(BREED_MS_DEFAULT === 15000, '离线演示默认15秒，HTTP不使用本地倒计时');

/* --- 遗传：逐位 50/50 --- */
{
  const ga = new Array(GENE_COUNT).fill(0);
  const gb = new Array(GENE_COUNT).map((_, i) => GENE_DEFS[i].opts.length > 1 ? 1 : 0);
  let fromA = 0, total = 0, muts = 0, mutable = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const r = inheritGenome(ga, gb);
    muts += r.mutations.length;
    const mutated = new Set(r.mutations.map(d => d.n));
    for (let j = 0; j < GENE_COUNT; j++) {
      if (GENE_DEFS[j].opts.length > 1) mutable++;
      /* ⚠️ 只统计"这一位没突变、且两个亲本不同"的位置 ——
         突变过的位是新抽的随机值，它可能碰巧等于父方，会把比例带偏；
         亲本相同的位根本分不出继承自谁。第一版没做这两个过滤，
         量出来的比例是 0.47，看着像"遗传不是 50%"——那是**量法**的问题。 */
      if (mutated.has(j + 1) || ga[j] === gb[j]) continue;
      total++;
      if (r.genome[j] === ga[j]) fromA++;
    }
  }
  const p = fromA / total;
  console.log('  继承抽样 ' + total + ' 个位：取自父方 ' + (p * 100).toFixed(2) + '%');
  ok(Math.abs(p - 0.5) < 0.015, '亲本各 50% 进入子代（逐位二选一，实测 ' + (p * 100).toFixed(2) + '%）');
  const per = muts / mutable;
  console.log('  突变抽样：平均每只 ' + (muts / N).toFixed(2) + ' 位｜每位 ' + (per * 100).toFixed(2) + '%');
  ok(Math.abs(per - 0.05) < 0.004, '每位独立 5% 突变（实测 ' + (per * 100).toFixed(2) + '%）');
  /* 期望值：可突变位 = 36 − 1（骨骼只有一档）× 5%。
     ⚠️ 这个数字会随基因位数变化（加附属物时从 31→35 位、1.55→1.75 位/只），
        所以**从 mutable 现算**而不是写死 —— 写死的话每次加基因位都要回来改一次，
        而"改断言让它变绿"正是最该警惕的动作。 */
  {
    const exp = mutable / N * GENE_MUTATE_P;
    ok(Math.abs(muts / N - exp) < 0.2,
       '平均每只突变 ' + (muts / N).toFixed(2) + ' 位（可突变位 ' + (mutable / N) + ' × 5% = ' + exp.toFixed(2) + '）');
  }
}

/* --- 突变：整表随机 + **保证与原值不同** --- */
{
  let n = 0, changed = 0, hitFirst = 0;
  for (let t = 0; t < 300; t++) {
    /* 两个亲本**所有位都相同**（全 0）⇒ 任何突变都必然把值改掉，
       于是"新值 != 原值"这件事可以直接量。 */
    const r = inheritGenome(new Array(GENE_COUNT).fill(0), new Array(GENE_COUNT).fill(0));
    for (const d of r.mutations) {
      n++;
      const v = r.genome[d.n - 1];
      if (v !== 0) changed++;
      if (v === 1) hitFirst++;      // 13 档的颜色位如果"整表随机"，命中第 1 档是偶然不是必然
    }
  }
  ok(n > 100, '300 次繁衍确实抓到突变（' + n + ' 次）');
  ok(changed === n, '每次突变都改变了取值（' + changed + '/' + n + '）—— 不会"说了突变却前后一样"');
  ok(hitFirst < n * 0.6, '突变是**整表随机**而不是"只跳相邻档"（' + hitFirst + '/' + n + ' 次落在第 1 档）');
}

/* --- 突变提示：只说位点名，不含新值 --- */
{
  const lines = mutationLines([GENE_DEFS[5], GENE_DEFS[30]]);
  console.log('  突变提示示例：' + lines.join(' ／ '));
  ok(lines[0] === '眼睛的有无发生了突变！！！', '与用户给的例子逐字一致（' + lines[0] + '）');
  ok(lines[1] === '发光器官的颜色发生了突变！！！', '第二条也逐字一致（' + lines[1] + '）');
  ok(lines.every(l => l.endsWith('发生了突变！！！')), '每条都以「发生了突变！！！」结尾');
  ok(lines.every(l => l === GENE_DEFS.find(d => l.startsWith(d.say)) .say + '发生了突变！！！'),
     '只由"位点名 + 固定后缀"拼成，不带任何具体取值');
}

/* --- 初始基因：现有 40 只的起点 --- */
{
  const gRing = initialGenomeFor({ key: 'slime-ring', body: 'A' });
  const gBall = initialGenomeFor({ key: 'slime-ball', body: 'A' });
  ok(gRing.length === GENE_COUNT && gBall.length === GENE_COUNT, '初始基因也是 ' + GENE_COUNT + ' 位');
  ok(gRing[4] === 0, '现有史莱姆的主体形态 = 球形（用户已注明「现有的两个史莱姆算球形」）');
  ok(gRing[1] === 0 && gBall[1] === 0, '两者的体型都是 A');
  ok(gRing[3] === TEX_JELLY && gBall[3] === TEX_JELLY, '主体质感 = 胶质（= 实测的运行时材质）');
  ok(gRing[2] !== gBall[2], '主体色的起点按各自的贴图平均色落档（ring 白 / ball 浅蓝）');
  ok(GENE_DEFS.every((d, i) => d.opts !== ON_OFF || gRing[i] === 1),
     '9 个"有无"位起点全是「无」（它们本来就是没有零件的单体网格）');
  const a = animals.find(x => x.species.glb);
  ok(genomeOfPal(a) === genomeOfPal(a), '同一个体每次取到的基因是同一份（按物种缓存）');
}

/* --- 提示词：只说"有"的部件 --- */
{
  const g = initialGenomeFor({ key: 'slime-ring', body: 'A' });
  const p = genomeToPrompt(g);
  ok(p.includes('球形') && p.includes('胶质') && p.includes('体型：A'), '提示词含主体形态 / 质感 / 体型档位');
  ok(!/眼睛|耳朵|角冠|翅膀|尾巴|四肢|爪子|发光器官/.test(p),
     '「无」的部件**不写进提示词**（写了会被生成出来）');
  const g2 = g.slice(); g2[5] = 0;                 // 眼睛的有无 = 有
  const p2 = genomeToPrompt(g2);
  ok(/眼睛（红，动物眼）/.test(p2), '「有」的部件带上颜色与形态写进提示词');
  ok(p2.split('\\n').length === 4, '提示词是 4 段（模型总述 / 主体 / 部件 / 输出约束），实际 ' + p2.split('\\n').length + ' 段');
}

/* --- 占位球：基因里能程序化表达的部分真的表出来了 --- */
{
  const g = initialGenomeFor({ key: 'slime-ring', body: 'A' });
  const mk = (mut) => {
    const gg = g.slice();
    if (mut) mut(gg);
    const grp = buildOffspringBody(gg);
    return { mesh: grp.children[0], mat: grp.children[0].material, geo: grp.children[0].geometry };
  };
  const A = mk(null);
  A.geo.computeBoundingBox();
  const bb = A.geo.boundingBox;
  const box = BODY_BOX.A;
  console.log('  占位球包围盒 = ' + (bb.max.x - bb.min.x).toFixed(3) + ' × ' +
              (bb.max.y - bb.min.y).toFixed(3) + ' × ' + (bb.max.z - bb.min.z).toFixed(3) + ' m');
  ok(Math.abs((bb.max.x - bb.min.x) - box.x) < 1e-6 &&
     Math.abs((bb.max.y - bb.min.y) - box.y) < 1e-6 &&
     Math.abs((bb.max.z - bb.min.z) - box.z) < 1e-6,
     '占位球的包围盒 = 体型 A 的目标盒（逐轴）');
  ok(Math.abs(bb.min.y) < 1e-6, '底面归零（minY=0）');
  ok(A.mat.type === 'MeshStandardMaterial' && A.mat.metalness === 0 && A.mat.opacity === TEX_PRESET[TEX_JELLY].opacity,
     '主体质感「胶质」真的写进了材质（roughness ' + A.mat.roughness + ' / opacity ' + A.mat.opacity + '）');

  const C = mk(gg => { gg[1] = 2; });              // 体型 C
  C.geo.computeBoundingBox();
  const bC = C.geo.boundingBox;
  ok(Math.abs((bC.max.y - bC.min.y) - BODY_BOX.C.y) < 1e-6 &&
     Math.abs((bC.max.x - bC.min.x) - BODY_BOX.C.x) < 1e-6,
     '体型 C 的后代尺寸 = BODY_BOX.C（' + (bC.max.y - bC.min.y).toFixed(2) + ' m 高）');

  const R = mk(gg => { gg[2] = 0; });              // 主体色 = 红
  ok(R.mat.color.getHex() === COLOR_RGB[0], '主体色「红」写到材质 color 上（#' + R.mat.color.getHexString() + '）');

  const M = mk(gg => { gg[3] = 5; });              // 主体质感 = 金属
  ok(Math.abs(M.mat.metalness - 1) < 1e-9, '主体质感「金属」→ metalness = 1');

  const G0 = mk(null);                             // 发光器官 = 无（初始基因）
  ok(G0.mat.emissive.r + G0.mat.emissive.g + G0.mat.emissive.b === 0, '发光器官「无」⇒ 不自发光');
  const G1 = mk(gg => { gg[29] = 0; gg[30] = 4; }); // 发光器官=有，颜色=紫
  ok(G1.mat.emissive.getHex() === COLOR_RGB[4] && G1.mat.emissiveIntensity > 0,
     '发光器官「有」⇒ 按发光颜色自发光（#' + G1.mat.emissive.getHexString() + '）');

  /* ⚠️ **每个后代一份独立材质**：现有 20 只史莱姆共用材质是有意的（同物种），
     但后代个个不同色 ⇒ 不 clone 的话"改一只就是改全部"（陷阱 57）。 */
  ok(A.mat !== mk(null).mat, '每只后代拿到的是**独立材质**（不是共享实例）');
  ok(A.mat.color !== R.mat.color, '颜色也是独立的 Color 实例');
}

/* --- 槽位搬运：真的从背包移出 --- */
{
  while (mag.length) release(mag.shift());
  while (pals.length) release(pals.shift());
  for (let i = 0; i < BREED_SLOTS; i++) breeding.slots[i] = null;

  const a = animals.find(x => x.species.glb && !x.captured && !x.launch);
  a.x = player.x + 1; a.z = player.z + 1;
  a.g.position.set(a.x, sampleHeight(a.x, a.z), a.z);
  ok(captureAnimal(a) === true, '先把它吸进弹夹再搬进背包');
  magToBag(0);
  ok(pals.includes(a), '它在背包里');

  const i0 = palToSlot(a);
  ok(i0 === 0, '送进第一个空槽位（实际 ' + i0 + '）');
  ok(pals.indexOf(a) === -1, '它**不在背包里了**（用户：移到槽位后就不存在背包里）');
  ok(breeding.slots[0] === a, '它占着 0 号槽位');
  ok(palToSlot(a) === -1, '同一只不能再占第二个槽位（不在背包里 ⇒ 找不到）');

  ok(slotToBag(0) === true, '点槽位里的帕鲁 = 放回背包');
  ok(pals.includes(a) && breeding.slots[0] === null, '背包和槽位都对上了');
  while (pals.length) release(pals.shift());
}

/* Backend capacity remains enforced without a context menu. */
{
  let n = 0;
  while (pals.length < BREED_SLOTS) {
    const a = animals.find(x => x.species.glb && !x.captured && !x.launch);
    if (!a) break;
    a.x = player.x + 1; a.z = player.z + 1;
    a.g.position.set(a.x, sampleHeight(a.x, a.z), a.z);
    if (!captureAnimal(a)) break;
    magToBag(0);
    n++;
  }
  ok(pals.length === BREED_SLOTS, '先凑够 ' + BREED_SLOTS + ' 只进背包（实际 ' + pals.length + '）');
  let filled = 0;
  while (freeSlotCount() > 0 && pals.length) if (palToSlot(pals[0]) >= 0) filled++;
  ok(filled === BREED_SLOTS && freeSlotCount() === 0, '六个槽位填满');
  ok(palToSlot(breeding.slots[0]) === -1, '不能重复将亲代放入其他槽');
}

/* --- 完整流程：交配 → 倒计时（真实时间）→ 接生 --- */
{
  ok(pairCanMate(0) === true, '0 号对两只就位 ⇒ 可以交配');
  ok(startMate(0) === true, '点交配返回成功');
  const pr = breeding.pairs[0];
  ok(pr.state==='irradiating'&&!pr.genesLocked,'先进入辐射调节阶段');
  breedAdvance(BREED_MS);
  ok(pr.state==='irradiating'&&pr.ms===0,'未确认时不会用离线时间跳过辐射');
  ok(confirmMateRadiation(0),'确认本轮基础突变率');
  ok(pr.state === 'running', '进入倒计时');
  ok(!!pr.genome && pr.genome.length === GENE_COUNT&&pr.genesLocked, '确认后基因定稿');
  ok(pr.prompt.length > 20, '模型使用最终基因的提示词');

  setBagPage(1);
  const h = el('bagPage0').innerHTML;
  ok(pr.ms === 0 && BREED_MS === BREED_MS_DEFAULT, '开始离线演示进度');
  /* **不告诉用户**：交配后页面上不能出现基因值 / 提示词内容。 */
  ok(!/提示词|prompt|genome/.test(h), '页面上不出现"提示词/基因"这类字眼');
  ok(!h.includes(pr.prompt.split('\\n')[0]), '也不出现提示词的内容');
  /* ⚠️ 第一版这里用了 NUL 字符（反斜杠 u0000 的转义）当"没有突变"的哨兵值。
     坑在于模板字符串会把它**求值成真的 NUL 字节**写进拼出来的临时 .mjs，
     import 时报 Invalid or unexpected token —— 而 node --check 完全正常，
     因为它看的是转义前的源文件。改用布尔式子，不用哨兵。 */
  ok(pr.mutations.length === 0 || !h.includes(mutationLines(pr.mutations)[0]),
     '突变点也不提前泄露（基因已定但不说）');

  breedAdvance(BREED_MS - 1);
  ok(breeding.pairs[0].state === 'running', '离线演示尚未完成时不能接生');
  ok(takeBaby(0) === null, '提前点接生拿不到东西（不抛错）');
  breedAdvance(1);
  ok(breeding.pairs[0].state === 'ready', '离线演示完成 ⇒ 可以接生');
  ok(anyPairReady() === true, 'HUD 提醒的条件成立');
  ok(slotToBag(0) === false, 'ready 阶段仍锁定亲代');

  const nBag = pals.length;
  const baby = takeBaby(0);
  renderBag();
  ok(!!baby, '接生拿到了后代');
  ok(pals.includes(baby), '后代**回到背包**（用户要求）');
  ok(pals.length === nBag + 1, '背包只数 +1（' + nBag + ' → ' + pals.length + '）');
  ok(!!breeding.slots[0] && !!breeding.slots[1], '**亲代留在槽位**（用户要求）');
  ok(breeding.pairs[0].state === 'idle', '这一对回到可再交配状态（继续繁衍是玩家的选择，不是按钮）');
  ok(!!baby.genome && baby.genome.length === GENE_COUNT, '后代带着自己的基因');
  ok(baby.captured === true && baby.g.visible === false, '后代以"在背包里"的状态存在（捕获语义）');
  ok(!!baby.cyl && baby.cyl.r > 0, '后代也有圆柱碰撞体（用户：繁衍时也要）');
  {
    const want = BODY_BOX[BODY_GRADES[baby.genome[1]]];
    ok(Math.abs(baby.cyl.h - want.y) < 0.02 && Math.abs(baby.cyl.r - Math.max(want.x, want.z) / 2) < 0.02,
       '后代的碰撞体尺寸跟着它的体型档位（h=' + baby.cyl.h.toFixed(2) + '，期望 ' + want.y.toFixed(2) + '）');
  }

  ok(baby.g.userData.speed === baby.species.speed, '实际速度与遗传速度一致');
  ok(breeding.result.name === baby.species.name, '出生结果记录正确名称');
  ok(mutationLines(breeding.result.mutations).length === breeding.result.mutations.length,
     '突变记录可以转换为逐位提示');
  ok(takeBaby(0) === null, '重复出生不会创建第二只');
}

/* --- 计时：真实时间 + 暂停不走（用户要求）--- */
{
  const savedMs = BREED_MS, savedNow = performance.now;
  let now = 1000; performance.now = () => now;
  try {
    BREED_MS = 40; paused = false; debugStill = false; breedClockLast = -1;
    ok(startMate(0), '同一舱可以再次繁衍');
    ok(confirmMateRadiation(0), '新一轮确认后才开始离线生成计时');
    loop(); now += 39; loop();
    ok(breeding.pairs[0].state === 'running', '真实毫秒未到阈值时仍等待');
    paused = true; now += 120000;
    resume(); loop();
    ok(breeding.pairs[0].ms === 39, '暂停停帧再恢复不补入120秒');
    bag.open = true; now += 1; loop(); bag.open = false;
    ok(breeding.pairs[0].state === 'ready', '打开背包不冻结业务孕育时钟');
  } finally { performance.now = savedNow; BREED_MS = savedMs; breedClockLast = -1; }
}

/* --- 收尾：清干净，别让后面看到半路状态 --- */
{
  for (let p = 0; p < BREED_PAIRS; p++) { breeding.pairs[p].state = 'idle'; }
  for (let i = 0; i < BREED_SLOTS; i++) if (breeding.slots[i]) slotToBag(i);
  while (pals.length) release(pals.shift());
  while (mag.length) release(mag.shift());
  for (let p = 0; p < BREED_PAIRS; p++) {
    breeding.pairs[p].state = 'idle'; breeding.pairs[p].ms = 0;
    breeding.pairs[p].genome = null; breeding.pairs[p].mutations = [];
  }
  ok(freeSlotCount() === BREED_SLOTS && mag.length === 0 && pals.length === 0,
     '本节收尾：槽位全空 / 弹夹 0 / 背包 0');
}

${DRIVER_FOOTER}
`;

let failed = outerFails > 0;
try {
  await runGame(DRIVER);
} catch (err) {
  console.log('\n运行失败：' + (err && err.message));
  failed = true;
}
console.log(failed ? '\n>>> 集成测试有失败 <<<' : '\n>>> 集成测试全部通过 <<<');
process.exit(failed ? 1 : 0);
