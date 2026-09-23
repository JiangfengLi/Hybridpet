# 当前架构分析验证记录

> 历史记录提示：本文件保留分析阶段的原始结果和源码指纹，其中旧测试失败、构建依赖遗漏等结论不能直接套用于后续已修改的文件。后续工作记录见[集成状态补记](docs/INTEGRATION-STATUS.md)。该补记也不是完整验收报告；验证已按用户要求停止。

> 日期：2026-09-23。对象：`.`。
> 配套：[项目架构](docs/CURRENT-ARCHITECTURE.md) · [繁衍专题](docs/CURRENT-BREEDING-ARCHITECTURE.md)。
> 本次是分析和文档任务，不是太空舱集成完工验收。只改 Markdown，没有修复游戏、替换测试或重建磁盘发行版。

## 1. 证据边界

本轮执行：

- 源码与新模块静态追踪，核对既有文档。
- 本地 JS/MJS 语法检查。
- 六个既有 Node 检查入口，串行运行。
- 使用现有 harness 执行 26 项太空舱流程检查。
- 冲刺路径与空旷位置对照实验。
- 构建器在内存中生成结果，拦截文件写入，检查依赖遗漏。
- 文档链接、行号范围与表格结构检查。

没有执行：

- 真浏览器完整演出、GPU 像素、桌面/手机截图验收。
- 真实音效、原生拖放、指针锁、页面后台挂起实验。
- 外部模型生成联调。
- 999 个真实生物的渲染压力测试。
- 网络/建模异常注入、资源泄漏长时统计。
- `_mutate.py` 或会覆盖产物的原始 `test/run.sh`。

夹具中门开度为 0、`opaque=true` 只能证明控制状态；不能证明从任意角度都没有视觉穿帮。影片时间遍历全部阶段也不等于画面质量合格。

## 2. 源码快照

Node：`v24.16.0`。Shell：PowerShell。该目录未见 Git 元数据，不能根据提交历史确定变更归属。

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| index.html | 236659 | d7d67f3dea012926cd378b17f092a867e8f77167eb1f02c7d7b63ba4d32efeca |
| alien-walk-standalone.html | 8543650 | e40abac67686073124961d20bed797f0f3f9068fb31df962975a26d96ac40f8e |
| build-standalone.mjs | 11820 | 13a4fe3a6b18175c295ac2bf62edbde6beabd08e5c10c5a869801e573b9b9485 |
| chamber-system.mjs | 8199 | 4854d54584e00c9b6f5a375fcdf58b12cbd6f01776fb6e3a8527076ca907c4e3 |
| chamber-view.mjs | 9435 | 84f67c0b53e1c5bbf3a3e2093235548b98d31fcb9333554af30d44c5f579c011 |
| chamber-performance.mjs | 8734 | 30d24baf7f64e7146fb2440a98776673b6e7d9975f5e39d40c20813602bacf54 |
| chamber-stage.mjs | 2066 | aee1d679786601113e6e9db9183dbee75d57137c1f21c0139474d10f8fc107e4 |
| chamber.css | 3723 | 2d9f3b45135ac0a9baf70b1bc44c255e2da7009d6d3d6f05d7138d2b136ee3d0 |
| test/harness.mjs | 14595 | 0254bad7ac9e5b8d6ffc4d2af8578a6545aa8a6566011aeb8743a0253a18ab80 |

初始模型库存为 18 GLB，vendor 为 4 JS，演出音频 25,995 字节。旧发行版的指纹与历史记录相同，但当前 index 的指纹已经不同。

## 3. 既有测试结果

| 命令 | 退出码 | 当前观察 |
| --- | ---: | --- |
| `node --check` 扫描 | 0 | 根目录、test、fusion-v1 共 41 个 JS/MJS 通过 |
| `node test/check-driver-backticks.mjs` | 0 | 24 个模板字符串检查通过 |
| `node test/integration.mjs` | 1 | 旧页签/6槽/3对断言失败；`openPalMenu is not defined` 使后续中断 |
| `node test/input.mjs` | 1 | 11 项失败 |
| `node test/boot-params.mjs` | 1 | 第一轮旧页签7项失败；中间两轮6/5项通过；最后旧繁衍按钮路径失败并异常 |
| `node test/scene-cost.mjs` | 0 | 28 项通过 |
| `node test/animal-aim.mjs` | 0 | 三组素材装配失败合计 0 |

41 个文件的语法扫描不包含 vendor，不单独抽取 HTML 内脚本；HTML 游戏主体的可解析性由实际 harness 执行补充验证。顶层真实浏览器导入并未被 harness 覆盖。

### 3.1 失败分类

**旧行为契约未迁移**

- 期望背包存在繁衍页、页签点击、数字 2 切页。
- 期望三对六格、右键 `openPalMenu`。
- `bagpage=1` 期望显示繁衍页。
- 旧交配/接生按钮的事件委托已删除。
- 旧测试要求拖拽模式 Esc 恢复；源码现在切换暂停。

这些需要先确认新规则，再改成等价的新入口回归测试，不能只删断言使其“变绿”。

**测试场景前提改变**

输入测试连续向 +Z 行走，然后在同一路径冲刺。新增舱体正位于 `(0,23)`，碰撞边界约在 `z=19.85`。

本轮复现：

```text
行走测试开始 z = 12.0000
行走结束     z = 17.6000
随后冲刺结束 z = 19.8500，被舱体挡住
空旷位置 x=-30 的 60 帧对照：
  行走 = 5.6000 m
  冲刺 = 9.8933 m
  比值 = 1.7667
```

因此这条失败不能直接解释为“冲刺速度失效”；应把纯速度测试移到无障碍区，另增加舱碰撞测试。

**不能从中断套件推断全部其余行为正常**

原 integration 和 boot 测试均有异常中断，后续断言没跑完。已分类的失败原因不等于穷尽全部潜在回归。

### 3.2 推荐复跑方式

在项目根目录串行运行：

```powershell
node test/check-driver-backticks.mjs
node test/integration.mjs
node test/input.mjs
node test/boot-params.mjs
node test/scene-cost.mjs
node test/animal-aim.mjs
```

不要并发启动使用 harness 的多个进程：它们可能同时写 `test/.tmp-harness-1.mjs`。测试会创建临时模块并在结束时清理，这与修改业务源码不同。

## 4. 太空舱补充验证

### 4.1 测试方式

通过 `runGame()` 调用生产 `chamberSystem`、真实 Three.js 射线、真实基因和出生函数；渲染器/DOM/音频仍是桩。

选取一只 ring、一只 ball，玩家放在 `(0,14)`，分别用相机瞄准两槽，调用 `fire()`。按固定 dt 推进展示，使用 `breedAdvance(90000)` 精确推进业务等待。

26 项检查均通过：

| 组别 | 覆盖 |
| --- | --- |
| 投放 | 左/右槽实际射线命中、第二只自动开始、单对两格 |
| 关门/等待 | 密封状态、业务 ready、演出开始 |
| 输入/返回 | repeat 不计数、返回成功、预定基因保留 |
| 演出 | 10 次输入进入 surge，最终到 complete |
| 出生 | 只新增一个实体、实际基因等于计划、两处速度均0.62 |
| 归属 | 后代初始不在弹夹/背包而由舱持有 |
| 重复推进 | 继续 tick 不重复出生，舱门重新全开 |
| 容量 | 两容器满时领取失败但 child 保留 |
| 领取 | 优先入弹夹、重复领取失败、亲代留槽 |
| 几何隔离 | 两亲代原始顶点数组不变 |
| 下一轮 | 可重新开始，控制器 task 递增至2 |

本次加速后的演出推进用了 579 个 `1/60` 秒步长，遍历：

```text
entry → drawing → weaving → coiling → sphere → separating → birth → result
```

帧数是这个测试输入时机下的结果，不是固定演出总时长的产品承诺。

### 4.2 可复跑脚本

下面是本轮实验的可执行等价脚本，保存在 Markdown 中，不新增生产测试文件。

```powershell
$probe = @'
import { runGame } from './test/harness.mjs';
await runGame(`
const results = [];
const check = (c, name) => {
  results.push({ name, ok: !!c });
  if (!c) throw new Error(name);
};
started = true; paused = false; bag.open = false; debugStill = false;
player.x = 0; player.y = 0; player.z = 14;
camera.position.set(0, EYE, 14);
const parents = ['slime-ring', 'slime-ball']
  .map(k => animals.find(a => a.species.key === k));
const vertices = a => {
  const arrays = [];
  a.g.traverse(n => {
    if (n.isMesh) arrays.push(Array.from(n.geometry.attributes.position.array));
  });
  return JSON.stringify(arrays);
};
const original = parents.map(vertices);
parents.forEach(captureAnimal);
for (const [i, x] of [1.64, -1.64].entries()) {
  camera.lookAt(x, 2.6, 23); camera.updateMatrixWorld(true);
  check(chamberSystem.fire(), 'deposit ' + i);
}
check(chamberSystem.status().phase === 'sealing', 'auto start');
check(BREED_PAIRS === 1 && BREED_SLOTS === 2, 'one pair');
const planned = JSON.stringify(breeding.pairs[0].genome);
for (let i = 0; i < 30; i++) chamberSystem.tick(.05);
check(chamberSystem.status().view.opaque, 'sealed state');
breedAdvance(90000); chamberSystem.tick(.05);
check(chamberSystem.status().phase === 'ready', 'ready');
check(chamberSystem.interact(), 'start');
check(chamberSystem.status().phase === 'playing', 'playing');
chamberSystem.boost(true);
check(chamberSystem.status().performance.presses === 0, 'ignore repeat');
chamberSystem.boost();
check(chamberSystem.cancel(), 'return');
check(JSON.stringify(breeding.pairs[0].genome) === planned, 'preserve genome');
chamberSystem.interact();
for (let i = 0; i < 10; i++) chamberSystem.boost();
check(chamberSystem.status().performance.state === 'surge', 'surge');
const before = animals.length, phases = new Set();
let frames = 0;
while (chamberSystem.status().phase === 'playing' && frames++ < 1600) {
  chamberSystem.tick(1 / 60);
  phases.add(chamberSystem.status().performance.cinematicPhase);
}
check(chamberSystem.status().phase === 'complete', 'complete');
const child = chamberSystem.child;
check(animals.length === before + 1, 'one birth');
check(JSON.stringify(child.genome) === planned, 'same genome');
check(child.species.speed === .62 && child.g.userData.speed === .62, 'speed');
check(!mag.includes(child) && !pals.includes(child), 'pending ownership');
for (let i = 0; i < 60; i++) chamberSystem.tick(1 / 60);
check(animals.length === before + 1, 'no duplicate birth');
check(chamberSystem.status().view.openness === 1, 'reopened');
const oldMag = mag.slice(), oldBag = pals.slice();
mag.length = 0; pals.length = 0;
for (let i = 0; i < MAG_MAX; i++) mag.push({ species: { name: 'fixture' } });
for (let i = 0; i < BAG_MAX; i++) pals.push({ species: { name: 'fixture' } });
check(chamberSystem.collect() === false && chamberSystem.child === child,
      'full capacity preserves child');
mag.length = 0; pals.length = 0;
mag.push(...oldMag); pals.push(...oldBag);
check(chamberSystem.collect() && mag.includes(child), 'receive in magazine');
check(!chamberSystem.collect(), 'reject repeated collection');
check(breeding.slots.every(Boolean), 'retain parents');
parents.forEach((a, i) => check(vertices(a) === original[i], 'geometry ' + i));
check(chamberSystem.interact() && chamberSystem.status().task === 2, 'new task');
console.log(JSON.stringify({ results, frames, phases: [...phases] }));
`);
'@
node --input-type=module -e $probe
```

容量测试用轻量占位对象，不是实际创建 999 个模型。此脚本不验证真实鼠标/键盘事件、影片重播按钮、全部体型组合或失败补偿。

## 5. 只读构建实验

实验结果：

```text
构建器原有内联一致性检查：通过
内存生成产物：8,539,841 字节
是否等于磁盘旧发行版：否
是否仍有 ./chamber-system.mjs 动态 import：是
是否仍有外部 chamber.css：是
是否内联 __combine_audio：否
磁盘发行 HTML：未写入
```

这证明现有构建检查没有验证新模块闭包，不证明 file 模式具体浏览器报错文本；本轮未真实打开新产物。

复跑时可使用以下只读方式，避免直接执行构建命令覆盖旧版：

```powershell
$probe = @'
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
const source = fs.readFileSync('build-standalone.mjs', 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('const HERE = path.dirname(url.fileURLToPath(import.meta.url));',
           'const HERE = process.cwd();');
const target = path.resolve('alien-walk-standalone.html');
let output = null;
const readOnlyFs = {
  ...fs,
  writeFileSync(file, data) {
    if (path.resolve(file) !== target) throw new Error('Unexpected write');
    output = Buffer.from(data);
  },
  statSync(file) {
    return path.resolve(file) === target && output
      ? { size: output.length } : fs.statSync(file);
  }
};
new Function('fs', 'path', 'url', 'process', source)(readOnlyFs, path, url, process);
const text = output.toString();
console.log({
  matchesExisting: output.equals(fs.readFileSync(target)),
  generatedBytes: output.length,
  unbundledModule: text.includes("await import('./chamber-system.mjs')"),
  externalCss: text.includes('href="./chamber.css"'),
  hasEmbeddedAudio: text.includes('id="__combine_audio"')
});
'@
node --input-type=module -e $probe
```

该脚本依赖当前构建文件的文本结构，适合审计复现，不是建议长期维护的构建方式。后续应让正式构建工具支持指定输出位置和依赖完整性检查。

## 6. 当前文档变更清单

新增：

```text
docs/CURRENT-ARCHITECTURE.md
docs/CURRENT-BREEDING-ARCHITECTURE.md
docs/CURRENT-VERIFICATION.md
```

仅在以下历史文档顶部添加版本提示和当前入口，保留其原始分析：

```text
ARCHITECTURE.md
docs/BREEDING-ARCHITECTURE.md
docs/ARCHITECTURE-VERIFICATION.md
```

未把现有实现中的 TODO 自动变成执行任务；未修复测试失败；未改变遗传、玩法、演出或单文件产物。后续重构应以本次指纹和明确的新规则为基线。
