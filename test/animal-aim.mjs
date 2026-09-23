/**
 * 打印取景坐标（配合 index.html 的 ?still=1&pos=…&watch=… 用）：
 *   场上全部生物（2026-09-23 起只有导入的 2 种史莱姆）、营地中心与入口。
 * 用法： node test/animal-aim.mjs
 *
 * ⚠️ 程序化物种（grazer / scuttler / hopper / ray / bird）当前 `spawn: false`、不上场，
 *    所以下面那张 dist 表里它们暂时用不到 —— **故意留着**：
 *    将来把某个物种放回场上（删掉 SPECIES_LIST 里那行 spawn:false），
 *    这张表就能直接用，不用重新想"每种该站多远"。
 *
 * 2026-09-22 改写：原来这份文件**自己又搭了一套最小 DOM 桩**，其中没有 GLTFLoader 的
 * 三处必要桩（self / createImageBitmap / ImageBitmapLoader.load）。后果是 8c/8d/8e
 * 的模型全都静默装配失败 —— 报错被各自的 try/catch 吞掉（那是刻意的：装饰性模型
 * 不该让游戏起不来），于是这个脚本**照样打印"通过"**，但它描述的世界里
 * 一棵树、一个营地、一只史莱姆都没有。
 *   这是"验证手段本身出错比被测对象出错更难发现"的又一例：脚本看起来在正常工作。
 *   现在统一改成复用 test/harness.mjs 的 runGame()，桩和主流程与其它测试同一条路。
 */
import { runGame, DRIVER_HEAD } from './harness.mjs';

const DRIVER = `
${DRIVER_HEAD}

/* ---------- 1. 所有动物（程序化 5 物种 + 史莱姆 2 物种） ---------- */
const bySp = {};
for (const a of animals) {
  const k = a.g.userData.kind === 'land' ? a.species.key : a.g.userData.kind;
  (bySp[k] = bySp[k] || []).push({
    x: +a.x.toFixed(1), z: +a.z.toFixed(1), y: +a.y.toFixed(1),
    s: +a.g.scale.x.toFixed(2), h: +a.g.rotation.y.toFixed(3),
  });
}
for (const k of Object.keys(bySp)) console.log(k.padEnd(12), JSON.stringify(bySp[k]));

/* ---------- 2. 营地 ---------- */
const cc = campStats.center;
/* 入口方向：局部 +Z 映射到世界 (sinθ, cosθ)，θ = campStats.center.yaw */
const ex = Math.sin(cc.yaw), ez = Math.cos(cc.yaw);
console.log('');
console.log('营地：' + campStats.models + ' 件 / ' + campStats.instances + ' 实例，中心 (' +
            cc.x + ', ' + cc.z + ')，围栏 R ' + FENCE_R.toFixed(2) + ' m，入口朝向 (sin,cos)=(' +
            ex.toFixed(2) + ', ' + ez.toFixed(2) + ')');
console.log('  ' + 'camp-wide'.padEnd(12) +
  ' pos=' + (cc.x + ex * 24).toFixed(1) + ',' + (cc.z + ez * 24).toFixed(1) +
  '&watch=' + cc.x + ',' + cc.z + ',2.5    (24 m 外看全景，围栏 R ' + FENCE_R.toFixed(1) + ')');
console.log('  ' + 'camp-entry'.padEnd(12) +
  ' pos=' + (cc.x + ex * 12).toFixed(1) + ',' + (cc.z + ez * 12).toFixed(1) +
  '&watch=' + cc.x + ',' + cc.z + ',1.8    (12 m 外看入口)');
console.log('  ' + 'camp-dome'.padEnd(12) +
  ' pos=' + (cc.x + ex * 8.5).toFixed(1) + ',' + (cc.z + ez * 8.5).toFixed(1) +
  '&watch=' + cc.x + ',' + cc.z + ',1.6    (8.5 m 外看穹顶)');

/* ---------- 3. 取景建议 ---------- */
console.log('');
console.log('取景建议（站到目标附近，用 watch 自动对准镜头）:');
/* 每种生物的取景距离。前 5 个是程序化物种的（当前不上场，留着备用，见文件头注释）。 */
const dist = { grazer: 7, scuttler: 5, hopper: 6, ray: 7, bird: 5, 'slime-ring': 5, 'slime-ball': 5 };
for (const k of Object.keys(bySp)) {
  const a = bySp[k][0];
  /* 陆生模型正面按 +X 取景；飞行模型保留原 -Z 约定。 */
  const airborne = k === 'ray' || k === 'bird';
  const fx = airborne ? -Math.sin(a.h) : Math.cos(a.h);
  const fz = airborne ? -Math.cos(a.h) : -Math.sin(a.h);
  const d = dist[k] || 7;
  console.log('  ' + k.padEnd(12) +
    ' pos=' + (a.x + fx * d).toFixed(1) + ',' + (a.z + fz * d).toFixed(1) +
    '&watch=' + a.x + ',' + a.z + (k === 'ray' || k === 'bird' ? ',' + a.y : '') +
    '   (朝向 h=' + a.h + ')');
}
console.log('');
console.log('素材组账目：植被 ' + propStats.models + ' 种/' + propStats.instances + ' 实例｜营地 ' +
            campStats.models + ' 件/' + campStats.instances + ' 实例｜史莱姆 ' +
            slimeStats.models + ' 种/' + slimeStats.instances + ' 只');
const fails = propStats.failed.length + campStats.failed.length + slimeStats.failed.length;
console.log('装配失败合计 = ' + fails +
            (fails ? '（植被 ' + propStats.failed.length + '｜营地 ' + campStats.failed.length +
                     '｜史莱姆 ' + slimeStats.failed.length + '）' : ''));
ok(fails === 0, '取景脚本跑到的世界是完整的（三组素材全部装配成功）');
`;

await runGame(DRIVER);
