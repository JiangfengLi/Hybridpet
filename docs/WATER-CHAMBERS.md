# 四面玻璃、爱心辐射枪与生成进度

日期：2026-09-23。目标项目：`alien-walk-B`。
本轮涉及文件修改前备份在
`C:/Users/can/Desktop/alien-walk-B-before-water-20260923-163135`。

## 舱体展示

三座舱都保留原位置与独立任务，前后左右均为玻璃观察窗。
正面仍随舱门开合；背面和两侧以框架替换原不透明墙板。
合舱后的两只展示副本继续匀速结合，不增加旋转或加速输入。

模型生成期间，以及全屏结合阶段，对 `pod-suspension` 显示组施加轻微摇摆、
横向位移和上下起伏。根节点、玩家/生物碰撞边界和弹药命中体固定，
避免晃动改变世界交互位置。暂停时晃动冻结；就绪、出错、开舱后逐渐归零。

正面靠近底部、基座上方是粉色分段数码状态条，用 20 段灯条及 000–100% 数字显示，不显示 H2O 标志。
它与底部的模型生成百分比是两套不同状态。

## 爱心辐射枪

- 舱处于 `sealing` 或 `irradiating` 时，玩家位于其中心水平 10 米内、
  高度低于 6 米，可按 E 或点击情境按钮领取爱心辐射枪。
- 原采集枪隐藏，替换为粉色小枪；情境按钮、舱体 HUD 和准星颜色同步更新。
- 按住左键发射粉色空心爱心，只有细轮廓、没有内部填充。松开停止发射，已发出的爱心继续飞行。
- 爱心辐射枪装备期间 F/G 不再吸取或发射生物，不扣除弹夹里的生物。
- 密封后可按 E 确认当前爱心进度，也可点 HUD“确认生成”；满 100% 自动确认。定稿后才提交 Tripo，进入 `generating` 后停止积累本轮进度。
- 离开所有结合舱的检测区后按 E 收起，恢复原枪。若舱已就绪或出错，
  不再提供爱心辐射枪时也可收起，然后继续原舱体交互。
- 暂停、背包、失焦、页面隐藏、收枪和全屏演出会停止发射并清除在途弹药，恢复后需重新按左键。

| 参数 | 默认值 |
| --- | --- |
| 初始宽度 | 0.12 米 |
| 最大宽度 | 1.4 米 |
| 放大过程 | 随飞行距离线性变大，飞行 8 米后不再放大 |
| 最大飞行距离 | 12 米，接近末端淡出，达到上限回收 |
| 飞行速度 | 9 米/秒 |
| 发射间隔 | 0.1 秒 |
| 对象池 | 24 枚，复用几何与材质，不逐帧新建网格 |

参数导出在 `water-gun.mjs`：`HEART_RANGE`、`HEART_MIN_SIZE`、`HEART_MAX_SIZE`、`HEART_SPEED`、`HEART_INTERVAL`。

先用准星射线确定瞄准方向，弹药从枪口出发，之后保持发射时的世界方向。
逐段检测弹药中心的飞行路径，命中时才增加状态，不是按下左键就即时加值。
最近的舱体挡住后面的舱，即使它当前不能累积状态，也不会穿透它给后舱加值。
地面会阻挡向下的弹药；装饰道具、生物、骨头目前不作为这把枪的命中体。
只有装备爱心辐射枪、游戏正常运行、命中舱已合拢且本轮基因尚未确认时才累计状态。
每枚命中计入 0.1 秒的原有积累量，保持持续命中约每秒 6 个百分点。

声音是实时合成的滤波噪声加轻微水泵声，不需要额外音频文件。
所有合成节点接入已有 `soundGain`，受主音量、音效音量和静音控制，不改变背景音乐。

## 状态条接口

`chamber-water.mjs` 的 `createWaterCharge()` 管理单舱单轮数值：

| 项目 | 默认行为 |
| --- | --- |
| `value` | 0–1，独立于基因与生成进度 |
| `percent` | `floor(value * 100)` |
| 增长速度 | 持续命中每秒增加 0.06，即 6 个百分点 |
| 上限 | 1，不溢出 |
| 衰减 | 无 |
| 阈值 | 0.25、0.5、0.75、1，每轮每个阈值仅在向上跨越时触发 |
| 重置 | 结合演出完成且后代成功出生、新一轮开始，或主动结束失败的孕育任务 |
| 保留 | 模型就绪、演出取消时保留本轮进度；出生时已清零，领取不再更改 |

系统提供以下订阅接口，返回取消订阅函数：

```js
const stopWatching = chamberWater.onChange(event => {
  // event: chamberId, taskId, previous, value, percent, reason
  // reason: "spray" or "reset"
});

const stopEffects = chamberWater.onThreshold(event => {
  // Additional field: threshold, e.g. 0.5.
  // Add future effects here, scoped by chamberId and taskId.
});

const state = chamberWater.getState(0); // Pod 01; IDs are 0, 1, 2.
stopWatching();
stopEffects();
```

底层对应 `chamberSystem.onWaterChange()` / `onWaterThreshold()`。
`createChamberSystem({waterThresholds:[...]})` 可在初始化时配置阈值。
回调拿到只读快照，某个回调抛错不会阻断主循环。当前已接入本轮基因突变率：
`5% + 20% × 爱心进度`。本轮固定随机计划，确认后基因和概率锁定，再提交一次模型任务；
不会因为每次命中重新提交或重试付费任务。详细流程见 `RADIATION-MUTATION.md`。

`__chamberStatus(id)` 返回 `water`、`progress` 和视图状态；
`__heartGunStatus()` 返回装备、按压、发射、命中舱及在途弹药距离/尺寸。
`__waterGunStatus()`、`chamberWater`、`createWaterGun()` 和 `reason: "spray"` 等旧接口名称保留兼容；游戏显示名称已全部改为“爱心辐射枪”。

## Tripo 进度

HTTP 模式的数据链：

```text
Tripo API progress
  -> existing service/client polling
  -> breeding.pairs[p].generation
  -> offspringProgress(pair)
  -> chamber HUD + world display
```

直接显示 API 百分比，不用时间伪造增长。API 达到 100% 但模型仍在下载或解析时，
保留相应阶段文字，`pair.state` 仍为 `running`。只有浏览器模型加载成功才置为 `ready`。
模型早于 90 秒完成也可就绪；超过 90 秒仍继续等待，合舱动画继续运行，但已锁定的基因和爱心条不再改变。
每轮仍只固定一次基因与请求 ID，失败重试和放弃后的过期响应隔离沿用原逻辑。

浏览器暂停不等于暂停远端 Tripo 任务；远端可以继续完成，恢复后显示实际进度。
发射状态、世界动画和音效则在本地暂停时停止。

直接双击单文件 HTML 不连接 Tripo，显示明确标注的离线演示百分比。
默认 15 秒，只生成离线占位模型；`?breed=N` 只调整这条演示路径。
真实模型生成继续使用 B 的 `start.bat` / `serve.py`，服务端密钥与缓存未改动。

## 文件分工

- `chamber-view.mjs`：四面玻璃、显示组晃动、固定命中体、粉色数码状态条。
- `chamber-system.mjs`：装备交互路由、每舱数值、射线选择与事件派发。
- `chamber-water.mjs`：纯数值累积、阈值与重置。
- `water-gun.mjs`：爱心辐射枪、线框弹药池、飞行命中和实时合成音效。
- `index.html`：输入与暂停、两把枪切换、模型进度、未来效果接口。
- `mutation-rate.mjs`：爱心进度对应的概率、固定随机计划与基因解析。
- `build-standalone.mjs`：连同遗骸物理和基因概率模块，合计内联 21 个模块，原六份音频保留。

## 验证边界

按照用户此前要求，本轮不运行测试、浏览器验证、截图或试听，不调用付费 API。
已编写 `test/water.mjs` 与 `test/heart-gun.mjs`，并调整 Tripo、离线进度和打包用例；这些用例尚未运行。
实际画面、爱心弹发射手感与音效听感仍待恢复验证后确认。
本轮只执行单文件构建及其内置资源检查，不将打包成功视为玩法验收。

使用 `node build-standalone.mjs` 重新生成单文件版；运行时所需模块随包内联，不依赖远端物理库。
枪声由代码实时合成，不计入六份原有音频文件。
