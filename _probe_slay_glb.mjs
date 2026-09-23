/**
 * 探针：&slay=glb 到底做了什么？
 * 拿**完全相同的**查询串重启世界，然后把末端状态摊开：
 * 背包里每只的物种、是不是带贴图的、corpses 有多少、animals 有多少。
 *
 * 来历：这个探针是为一次**静默失效**写的 —— `&slay=glb` 当时什么都不做（corpses 0 具），
 * 而弹夹/背包的计数全对，看着像逻辑错。摊开末端状态才看出根因是**时序错**：
 * 调试入口块跑在三处 `await` 之前，那一刻场上还没有带贴图的史莱姆。
 * 修法是把它搬到 `renderer.setAnimationLoop(loop)` 之前。
 *
 * 现在这条路径已经有正式断言了（`test/boot-params.mjs` 第二轮 DRIVER2：
 * corpses 1 / animals 41→40 / 物种是 slime-ring / 贴图换成了新建 canvas）。
 * 这个探针留着当"末端状态摊开"的通用工具 —— 下次有参数静默失效时改 SEARCH 就能用。
 */
import { runGame, DRIVER_HEAD, DRIVER_FOOTER } from './test/harness.mjs';

const SEARCH = '?autostart=1&intro=0&still=1&hud=0&fill=1&slay=glb';

const DRIVER = `
${DRIVER_HEAD}
sec('末端状态：' + location.search);
console.log('  弹夹 ' + mag.length + ' 只：' + mag.map(a => a.species.key).join(', '));
console.log('  背包 ' + pals.length + ' 只：' + pals.map(a => a.species.key + (a.species.glb ? '(glb)' : '')).join(', '));
console.log('  尸体 ' + corpses.length + ' 具｜动物 ' + animals.length + ' 只');
console.log('  SPECIES_LIST 的 key / glb 字段：' +
  SPECIES_LIST.map(sp => sp.key + (sp.glb ? '*glb' : '')).join(', '));
const slimes = animals.filter(a => a.species.glb);
console.log('  场上还剩 ' + slimes.length + ' 只带贴图的：' +
  slimes.map(a => a.species.key + (a.captured ? '(已捕)' : '')).join(', '));
console.log('  q.get("slay") = ' + JSON.stringify(new URLSearchParams(location.search).get('slay')) +
            '｜Number 化 = ' + Number(new URLSearchParams(location.search).get('slay')));
${DRIVER_FOOTER}
`;

await runGame(DRIVER, { search: SEARCH });
