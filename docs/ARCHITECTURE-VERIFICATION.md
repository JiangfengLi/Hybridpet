# 架构分析验证记录

> **历史验证记录**：以下结果对应 `index.html` SHA256 以 `9D2479E6` 开头的旧快照。
> 当前源码指纹、测试失败项及太空舱流程验证见 [CURRENT-VERIFICATION.md](docs/CURRENT-VERIFICATION.md)，不要把下面的“全通过”用于当前版本验收。

> 总览：[ARCHITECTURE.md](ARCHITECTURE.md)。
> 专题：[BREEDING-ARCHITECTURE.md](docs/BREEDING-ARCHITECTURE.md)。
>
> 本记录用于区分“代码推断”“夹具复现”和“真实浏览器验证”。本轮没有修改游戏业务代码。

## 1. 环境与快照

| 项目 | 本轮值 |
| --- | --- |
| 项目目录 | `.` |
| Shell | PowerShell |
| Node | `v24.16.0` |
| Python 路径 | `C:/Users/can/AppData/Local/Programs/Python/Python311/python.exe` |
| 本机读取时间之一 | `2026-09-23 11:16:29 +08:00` |
| 同一时间的纽约日期 | `2026-09-22` |
| Git | 该交付目录不是 Git 仓库 |

源码指纹：

```text
index.html
SHA256 9D2479E6CB1266F59E139D28E0F6D6D0323E67D2C1C16829485B8544C3B03F98
bytes  240468

alien-walk-standalone.html
SHA256 E40ABAC67686073124961D20BED797F0F3F9068FB31DF962975A26D96AC40F8E
bytes  8543650
```

以上两个文件、既有测试、素材和启动脚本均未被本轮改写。测试夹具会按自身实现创建临时 `.mjs`，正常结束后自行删除。

## 2. 验证范围

已执行：

- 根目录和子目录清点。
- 主脚本启动、资源装配、实体 / 库存 / 繁衍 / UI / 主循环的静态追踪。
- README 与历史设计稿的分阶段交叉核对。
- `.mjs` 语法闸门和 driver 字符串检查。
- 现有 Node 测试与场景诊断。
- 繁衍边界的补充夹具复现。
- 不落盘的单文件构建与既有产物逐字节比较。

未执行：

- 真实 WebGL 浏览器运行、截图或像素检查。
- `_probe_hud.mjs`、`_probe_dnd.mjs` 的浏览器布局 / 原生拖放检查。
- 浏览器真实后台挂起后恢复的时序实验。
- 实际生成 999 只后代的长时性能压力测试。
- 网络生成服务联调。
- `_mutate.py`，因为它会临时改写源码，且本轮不需要该操作。

没有将“没有运行”写成“已通过”。

## 3. 现有测试结果

### 3.1 结果表

| 命令 / 检查 | 结果 | 说明 |
| --- | --- | --- |
| `node --check` | 26 个 `.mjs` 全通过 | `test/`、构建脚本与 JS 探针；不包含 Python 检查 |
| `node test/check-driver-backticks.mjs` | 退出码 0 | driver 模板转义检查 |
| `node test/integration.mjs` | 退出码 0；driver 345 项通过 | 另有脚本前置检查；不把 345 宣称为所有层次的总数 |
| `node test/input.mjs` | 退出码 0；154 项通过 | DOM 桩上的合成事件 |
| `node test/boot-params.mjs` | 退出码 0；四轮 45 / 6 / 5 / 20 项通过 | 包含快速繁衍接线 |
| `node test/scene-cost.mjs` | 退出码 0；28 项通过 | 静态开销和部分稳定性 |
| `node test/animal-aim.mjs` | 退出码 0 | 资源失败计数 0；取景诊断 |
| 只读单文件构建 | 通过 | 18 个模型和内联模块校验通过；产物与磁盘一致 |

本轮没有直接运行 `test/run.sh`。该脚本既包含原机 Node 路径，也会重写发行产物，因此改为逐项串行执行检查，并对构建采用内存拦截写入的方式。

### 3.2 推荐复跑命令

```powershell
Set-Location 'C:\Users\can\Desktop\alien-walk-20260923'

node test/check-driver-backticks.mjs
node test/integration.mjs
node test/input.mjs
node test/boot-params.mjs
node test/scene-cost.mjs
node test/animal-aim.mjs
```

这些测试应串行执行。不同 Node 进程中的夹具序号都从 1 开始，可能同时写同一个 `test/.tmp-harness-1.mjs`，不适合未经隔离直接并行。

语法闸门：

```powershell
$files = @(Get-ChildItem test -Filter '*.mjs') +
         @(Get-Item build-standalone.mjs) +
         @(Get-ChildItem -Filter '_probe_*.mjs')

foreach ($file in $files) {
    node --check $file.FullName
    if ($LASTEXITCODE -ne 0) {
        throw "Syntax check failed: $($file.Name)"
    }
}
```

### 3.3 场景诊断摘要

```text
三角形总数                     578559
InstancedMesh                 16
静态实例总数                  123
植被 / 岩石                   9 种 / 101 实例 / 290409 三角
营地                          7 件 / 22 实例 / 65606 三角
史莱姆                        2 种 / 40 只 / 195980 三角
营地中心                      (-20.56, 45.47)
装配失败计数                  0
600 帧后 scene 子节点数量     73 -> 73
```

这些数值来自 Node 中真实几何的统计和桩渲染，不是实际 GPU 帧率。

## 4. 补充繁衍复现

### 4.1 观察结果

| 编号 | 检查 | 观察 |
| --- | --- | --- |
| B-01 | 开始后渲染一次，时间到后只执行 loop | 状态 ready、HUD 提醒亮，繁衍页 HTML 仍旧，没有接生按钮 |
| B-02 | 背包已达 999，再接生 | 任务被清空，后代已登记但隐藏，未进入背包 / 弹夹 / 槽位 |
| B-03 | ring 与 ball 接生 | `species.speed = 0.62`，`g.userData.speed = 1` |
| B-05a | 动画钩子模式连续请求两次接生 | 保存两个回调，状态仍 ready |
| B-05b | 第一回调结束后开新轮，再执行旧回调 | 新一轮尚在 running 就被接生 |
| B-06 | 控制时钟，暂停无帧，先恢复再 loop | 120 秒停帧间隔被计入，任务直接 ready |
| B-04 | 拖拽视角模式按 Esc | `paused` 仍为 false |

这些都是对当前生产函数的调用，未替换遗传、出生或状态转换实现。

需要注意：

- B-02 用轻量占位项填满 `pals`，只验证容量分支，不代表跑过 999 个 GLB 实体的渲染压力。
- B-05 使用代码已有的 `onBirthAnim` 钩子；默认同步路径没有启用它。
- B-06 控制时间函数和调用顺序，仅证明算法可受该顺序影响；没有验证具体浏览器后台调度概率。
- B-01 验证的是 DOM 桩上的 HTML 更新缺失，不是 CSS 显示效果。

### 4.2 可直接复跑的脚本

在项目根目录的 PowerShell 执行。脚本只是调用既有夹具，未新增生产代码文件：

```powershell
$probe = @'
import { runGame } from './test/harness.mjs';

await runGame(`
function verify(condition, message) {
  if (!condition) throw new Error(message);
  console.log('CONFIRMED ' + message);
}

for (const key of ['slime-ring', 'slime-ball']) {
  const a = animals.find(a => a.species.key === key);
  captureAnimal(a);
  magToBag(0);
  palToSlot(a);
}
started = true;
bag.open = true;
paused = false;

startMate(0);
renderBag();
const before = el('bagPage1').innerHTML;
breedAdvance(90000);
loop();
verify(
  breeding.pairs[0].state === 'ready' &&
  el('breedtag').classList.contains('on') &&
  el('bagPage1').innerHTML === before &&
  !before.includes('data-breed-birth="0"'),
  'B-01: ready state and HUD advance, breeding page stays stale'
);

const baby = takeBaby(0);
verify(
  baby.species.speed === 0.62 && baby.g.userData.speed === 1,
  'B-03: inherited speed differs from actual movement speed'
);

startMate(0);
breedAdvance(90000);
pals.length = 0;
for (let k = 0; k < BAG_MAX; k++) pals.push({ capacityFixture: k });
const lost = takeBaby(0);
verify(
  !!lost && animals.includes(lost) && lost.captured &&
  !lost.g.visible && !pals.includes(lost) &&
  !mag.includes(lost) && !breeding.slots.includes(lost) &&
  breeding.pairs[0].state === 'idle',
  'B-02: full-bag birth consumes job and leaves child unowned'
);

pals.length = 0;
startMate(0);
breedAdvance(90000);
const callbacks = [];
onBirthAnim = (pair, done) => callbacks.push(done);
takeBaby(0);
takeBaby(0);
verify(
  callbacks.length === 2 && breeding.pairs[0].state === 'ready',
  'B-05a: repeated requests schedule multiple callbacks'
);

callbacks[0]();
startMate(0);
const count = pals.length;
callbacks[1]();
verify(
  pals.length === count + 1 && breeding.pairs[0].state === 'idle',
  'B-05b: stale callback delivers the next running job'
);
onBirthAnim = null;

const oldNow = performance.now;
performance.now = () => 500000;
try {
  paused = true;
  breedClockLast = 380000;
  resume();
  startMate(0);
  loop();
  verify(
    breeding.pairs[0].state === 'ready',
    'B-06: stopped-frame pause is counted after early resume'
  );
} finally {
  performance.now = oldNow;
}

paused = false;
dragLook = true;
bag.open = false;
fireKey('keydown', 'Escape');
verify(
  paused === false,
  'B-04: Escape does not pause drag-look fallback'
);
`);
'@

node --input-type=module -e $probe
```

`CONFIRMED` 表示当前缺陷 / 行为已被观察到，不是“期望行为的回归测试通过”。修复后这些观察式断言应转为断言正确结果，不能把缺陷保留作为验收目标。

## 5. 单文件产物的只读一致性验证

### 5.1 做了什么

执行构建脚本的实际逻辑，但将 `fs.writeFileSync()` 限定拦截为内存 Buffer，随后与现有 `alien-walk-standalone.html` 比较。

构建过程仍执行：

- Three.js 相对依赖闭包检查。
- 两段启动引导替换。
- 四份库源码内联。
- 18 个 GLB 的 Base64 编码和解码对照。
- script 结束标签数量检查。
- 模块文本与原文件对照。

结果为逐字节一致，没有覆盖磁盘发行文件。

### 5.2 可复跑脚本

```powershell
$verify = @'
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const source = fs.readFileSync('build-standalone.mjs', 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(
    'const HERE = path.dirname(url.fileURLToPath(import.meta.url));',
    'const HERE = process.cwd();'
  );

let generated = null;
const outputPath = path.resolve('alien-walk-standalone.html');
const readonlyFs = {
  ...fs,
  writeFileSync(file, data) {
    if (path.resolve(file) !== outputPath) {
      throw new Error('Unexpected write target');
    }
    generated = Buffer.from(data, 'utf8');
  },
  statSync(file) {
    if (path.resolve(file) === outputPath && generated) {
      return { size: generated.length };
    }
    return fs.statSync(file);
  }
};

new Function('fs', 'path', 'url', 'process', source)(
  readonlyFs, path, url, process
);

if (!generated || !generated.equals(fs.readFileSync(outputPath))) {
  throw new Error('Existing standalone differs from current source');
}
console.log('READ-ONLY BUILD: exact match; no file written');
'@

node --input-type=module -e $verify
```

这是针对当前脚本结构的审计辅助片段，不建议演化为通用构建工具。后续模块化时应给构建脚本增加正式的输出到临时位置 / 仅校验能力。

## 6. 对现有测试的解释边界

### 6.1 真实库，模拟环境

测试使用真实 Three.js 和 GLTFLoader，因此顶点、包围盒、材质对象和大部分装配逻辑可信。

但以下内容被替换：

- WebGLRenderer。
- DOM 元素与事件传播的一部分。
- Canvas 2D 绘图和纹理位图。
- 指针锁行为。
- 音频。
- 世界模拟的 Clock 步长。

测试里“渲染成功”不能替代真实浏览器中的视觉检查。

### 6.2 内部访问使重构影响扩大

测试 driver 与游戏主体拼成一个 module，能够直接访问 `breeding`、`pals`、`startMate()`。它没有经过稳定的导出接口。

拆分文件后需要同时调整：

1. driver 获取被测接口的方式。
2. harness 的章节截取和 Renderer 替换。
3. 外部模块相对路径。
4. 单文件构建对新模块的内联方式。

不能只在生产代码中新增 import，然后以旧测试无法启动为理由删除测试。

### 6.3 尚缺关键失败路径

原有繁衍测试覆盖了大量正常路径，但没有保护满包出生、连续异步回调、页面原地更新和后台停帧恢复等问题。

此外发现：

- 一条 `|| true` 恒真断言。
- `breed=N` 的注释与实际断言不相符。
- 遗传统计测试使用全局随机，不是完全确定性测试。

这不是否定现有测试，而是为重构明确需要新增的保护范围。

## 7. 本轮交付清单

仅新增：

```text
ARCHITECTURE.md
docs/BREEDING-ARCHITECTURE.md
docs/ARCHITECTURE-VERIFICATION.md
```

文档已将现行实现、历史讨论、已复现缺陷、静态风险和建议目标分开。后续开始改代码时，应先更新规则决策，再根据新的实现修订本文，而不是把本文的“当前缺陷”固化成长期规范。
