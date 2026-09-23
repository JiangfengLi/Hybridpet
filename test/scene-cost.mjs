/**
 * 场景开销体检：统计三角形数 / 绘制批次 / 实例数，并检查预算。
 * 为什么单独一份：我一直加道具密度，但从没量过代价。
 *
 * 用法： node test/scene-cost.mjs
 */
import { runGame, DRIVER_HEAD, DRIVER_FOOTER } from './harness.mjs';

const DRIVER = `
${DRIVER_HEAD}
sec('场景开销');
let tris = 0, drawables = 0, instanced = 0, instTotal = 0, geoms = new Set(), mats = new Set();
for (const o of scene.children) {
  if (!o.isMesh && !o.isPoints && !o.isSprite && !o.isGroup) continue;
  o.traverse(n => {
    if (n.isMesh || n.isPoints || n.isSprite) {
      drawables++;
      if (n.isInstancedMesh) { instanced++; instTotal += n.count; }
      if (n.geometry) geoms.add(n.geometry.uuid);
      if (n.material) mats.add(n.material.uuid);
      const g = n.geometry;
      if (!g) return;
      const count = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      const inst = n.isInstancedMesh ? n.count : 1;
      if (n.isMesh) tris += (count / 3) * inst;
    }
  });
}
console.log('  可绘制对象      = ' + drawables + ' 个');
console.log('  三角形          = ' + Math.round(tris).toLocaleString('en-US') + ' 个');
console.log('  InstancedMesh   = ' + instanced + ' 个（实例总数 ' + instTotal + '）');
console.log('  不同 geometry   = ' + geoms.size + ' 个   不同 material = ' + mats.size + ' 个');
console.log('  动物            = ' + animals.length + ' 只');
console.log('  信号源          = 已整套移除（只留 ' + signalBlanks.length + ' 个"空位"坐标，零 mesh）');
console.log('  可拾取素材      = 已整套移除（只留 ' + pickableItems.length + ' 个"随机数配重点位"，零 mesh）');
console.log('  植被/岩石        = ' + propStats.models + ' 种 → ' + propStats.instances + ' 实例 / ' +
            Math.round(propStats.triangles).toLocaleString('en-US') + ' 三角（装配 ' + propStats.ms + ' ms）' +
            (propStats.failed.length ? '  ⚠ 失败 ' + propStats.failed.length + ' 项' : ''));
console.log('  营地            = ' + campStats.models + ' 件 → ' + campStats.instances + ' 实例 / ' +
            Math.round(campStats.triangles).toLocaleString('en-US') + ' 三角（装配 ' + campStats.ms + ' ms）' +
            '，中心 (' + campStats.center.x + ', ' + campStats.center.z + ')，围栏 R ' + FENCE_R.toFixed(2) + ' m');
console.log('  史莱姆          = ' + slimeStats.models + ' 种 → ' + slimeStats.instances + ' 只 / ' +
            Math.round(slimeStats.triangles).toLocaleString('en-US') + ' 三角（装配 ' + slimeStats.ms + ' ms）');

/* 预算拆项 —— 刻意不是"一个魔数"：
   三角形本身**不是**瓶颈（101 个植被实例只花 9 次 draw call，真正的代价是批次与顶点上传）。
   这条预算的作用是拦住"某天把实例数/缩放放大 10 倍"这类失控，而不是卡着不放。
   所以调高上限时必须把构成写出来，让下一个人看得出多出来的量是谁的：

     基础场景（地形 / 天空 / 云 / 浮尘 / 玩家）    ≈ 27k
     植被/岩石 9 种 → 101 实例                     290k
     营地 7 件 → 22 实例（围栏 16 段占 48k）         66k
     史莱姆 2 种 → 40 只（单只 ≈4.9k）             196k
     ———————————————————————————————————— 合计 ≈ 579k

   ⚠️ 2026-09-23 上限从 52 万提到 66 万，**唯一的原因是史莱姆从 8 只加到 40 只**
      （用户要求"把史莱姆补多一些"），把 39k 抬成了 196k；同时程序化物种不上场，
      基础场景从 ≈110k 掉到 ≈27k（33 只动物腾出来的）。两笔相抵净增 ≈62k。
      "绘制对象"反而从 386 掉到 67（40 只史莱姆各 1 个 Mesh + 16 个 InstancedMesh）。
      ⇒ 真正的代价是**顶点数**，不是批次。如果哪天要压回去，杠杆是
        "把 GLB 减面"（4.9k 三角对一只果冻球偏重）或"减少只数"，
        而不是去动上限本身。
   营地那 66k 里围栏是大头：16 段 × 3006。段数是算出来的（弦长必须等于段长，
   否则弧上裂缝），把它砍到 8 段就得把半径缩到 4.5 m —— 那就围不住 6 m 半径的建筑了。 */
ok(tris < 660000, '三角形 < 66 万（实测 ' + Math.round(tris).toLocaleString('en-US') + '）');
ok(drawables < 600, '绘制对象 < 600（实测 ' + drawables + '）');
/* 矿/孢子/星岩这一轮整套撤掉了。它们的实例化网格本来也要占 3 个批次 / 152 个实例，
   所以上面两条上限现在更松了 —— 但**别把上限往下调**：那 3 个批次腾出来的余量
   是留给"以后往营地里加东西"的，不是为了把预算卡得更紧。 */
ok(pickables.length === MATERIAL_TYPES.length && MATERIAL_TYPES.length === 3,
   '三组随机数配重还在（' + pickables.length + ' 组）—— 下游的落点全靠它，别清理');
ok(pickableItems.every(it => it.mesh === null),
   '配重点位一件 mesh 都没有（世界里确实看不到矿/孢子/星岩了）');

/* 信号源（12 个发光信标）2026-09-23 整套撤掉。守"世界里真的一个信标都没有了"。
   判据按**信标的形状特征**来，而不是按对象名字 —— 名字可以改，形状不会：
   每个信标 = 八面体 core + **加法混合光晕 Sprite** + 地面环 + 底座。
   场景里只用过一次 Sprite，就是远处恒星的光晕（index.html 那个 buildSky 里），
   所以"Sprite 总数"是个干净的判据：多出来的必然是信标光晕。
   ⚠️ 别把这条写成 sprites === 0 —— 恒星那一个是真的（它在 |x|,|z| > 400 的远处）。 */
{
  const sprites = [];
  scene.traverse(o => { if (o.isSprite) sprites.push(o); });
  console.log('  场景里的 Sprite = ' + sprites.length + ' 个（信标光晕会在这一项上出现）');
  ok(sprites.length === 1, '只剩恒星那一个 Sprite（实际 ' + sprites.length + '）');
  ok(sprites.every(o => Math.max(Math.abs(o.position.x), Math.abs(o.position.z)) > 400),
     '那个 Sprite 在场地外的远处（|x|,|z| > 400 ⇒ 是恒星不是信标）');
  ok(Array.isArray(signalBlanks) && signalBlanks.length === 12,
     '空位坐标仍是 12 个（纯随机数配重，实际 ' + signalBlanks.length + '）');
}

/* 碰撞体账目（2026-09-23 新增需求）：每个生物都要有圆柱碰撞体，尺寸是"生物尺度"。
   为什么放在"开销体检"里：碰撞解算每帧是**两两**比较，规模随只数平方增长 ——
   这属于"体检该发现的那一类"（r 写错不会崩，只会让 40 只挤成一团或者永远撞不上）。 */
{
  const bad = animals.filter(a => !a.cyl || !(a.cyl.r > 0) || !(a.cyl.h > 0) ||
                                  !Number.isFinite(a.cyl.r) || !Number.isFinite(a.cyl.h));
  ok(bad.length === 0, '每个生物都有合法（有限且为正）的圆柱碰撞体（问题 ' + bad.length + ' 只）');
  const rs = animals.map(a => a.cyl.r), hs = animals.map(a => a.cyl.h);
  console.log('  碰撞体          = ' + animals.length + ' 只，半径 ' +
              Math.min(...rs).toFixed(2) + ' ~ ' + Math.max(...rs).toFixed(2) + ' m，体高 ' +
              Math.min(...hs).toFixed(2) + ' ~ ' + Math.max(...hs).toFixed(2) + ' m');
  const pairs = animals.length * (animals.length - 1) / 2;
  console.log('  碰撞解算规模    = 两两 ' + pairs + ' 对 × 2 轮 = ' + (pairs * 2) + ' 次距离判定/帧');
  ok(pairs * 2 < 20000, '两两解算还在"每帧随便算"的量级（' + (pairs * 2) + ' 次/帧 < 20000）');
}

/* 三个素材组都必须是"每种模型恰好一个 InstancedMesh"。
   同一条判据守三处：谁哪天把 addPropInstances 改成逐个 new Mesh，
   三角数不会变、批次却会从 9/7 涨到 101/22，上面的 drawables 上限拦不住。 */
ok(propMeshes.length === propStats.models && propMeshes.every(m => m.isInstancedMesh),
   '植被/岩石：每种模型恰好一个 InstancedMesh（' + propMeshes.length + ' 个 / ' + propStats.models + ' 种）');
ok(campMeshes.length === campStats.models && campMeshes.every(m => m.isInstancedMesh),
   '营地：每件恰好一个 InstancedMesh（' + campMeshes.length + ' 个 / ' + campStats.models + ' 件）');

/* 这里原来有一条「素材矩阵重写 < 1 ms/帧」的计时：updatePickables() 每帧要把
   152 个实例矩阵重写一遍。矿/孢子撤掉后那个函数没了，这条计时也就没有对象了。 */

/* 配重点位的几何分布 —— 撤掉可见性之后，这里仍然值得守，
   理由是**它现在是 8c/8d 的 avoid 列表**：植被与营地选址靠它避开。
   如果这些点哪天聚成一团或缩到角落里，植被的拒绝采样就会跟着变形，
   而那种变化在"三角形数没变、批次没变"的体检里完全看不出来。

   ⚠️ 写这一节时才发现一件事：scatter(rnd, n, { minDist }) 里的 minDist
   量的是**离出生点的距离**（index.html:1133  hypot(x-SPAWN.x, z-SPAWN.z) < minDist），
   **不是点与点之间的最小间距**。所以"最近邻间距中位 = 7.0 m"这种说法会让人
   以为有个 7 m 的散布约束 —— 其实没有：实测最近的一对只有 1.17 m，完全合法。
   下面按它**真正保证**的东西来断言。 */
{
  const want = MATERIAL_TYPES.reduce((s, d) => s + d.count, 0);
  /* 注意：DRIVER 本身是模板字符串，里面**不能再用反引号**（会直接把外层字符串截断） */
  ok(pickableItems.length === want,
     '配重点位数 = 各类 count 之和（' + pickableItems.length + ' / ' + want + '，拒绝采样没丢件）');

  const out = pickableItems.filter(it => Math.max(Math.abs(it.x), Math.abs(it.z)) > ARENA + 1e-6);
  ok(out.length === 0, '配重点位全在方形场地内（越界 ' + out.length + ' 件）');

  /* scatter 真正保证的那条：全部离出生点 >= minDist（这里写死的 9 m） */
  const nearSpawn = pickableItems.filter(it => Math.hypot(it.x - SPAWN.x, it.z - SPAWN.z) < 9 - 1e-9);
  const dSpawn = pickableItems.map(it => Math.hypot(it.x - SPAWN.x, it.z - SPAWN.z)).sort((a, b) => a - b);
  console.log('  配重点位离出生点 = ' + dSpawn[0].toFixed(2) + ' ~ ' + dSpawn[dSpawn.length - 1].toFixed(1) +
              ' m（要求 >= 9）');
  ok(nearSpawn.length === 0, '配重点位都离出生点 >= 9 m（侵入 ' + nearSpawn.length + ' 件）');

  /* 分布别塌缩：至少要铺满场地的一大半，否则 avoid 列表退化成"只在角落生效" */
  const rs = pickableItems.map(it => Math.hypot(it.x, it.z)).sort((a, b) => a - b);
  const nn = pickableItems.map(it => {
    let best = 1e9;
    for (const o of pickableItems) if (o !== it) best = Math.min(best, Math.hypot(o.x - it.x, o.z - it.z));
    return best;
  });
  console.log('  配重点位离原点  = ' + rs[0].toFixed(1) + ' ~ ' + rs[rs.length - 1].toFixed(1) + ' m（中位 ' + rs[rs.length >> 1].toFixed(1) + '）');
  console.log('  最近邻间距      = 最近 ' + Math.min.apply(null, nn).toFixed(2) + ' m（此数**不受** minDist 约束）');
  ok(rs[rs.length - 1] > ARENA * 0.7, '配重铺到场地外圈（最远 ' + rs[rs.length - 1].toFixed(1) + ' > ' + (ARENA * 0.7).toFixed(1) + ' m）');
}

/* ============================================================
   草地贴图 与 天空
   ------------------------------------------------------------
   这一节**不能**当成"视觉通过"：草的密度、蓝天的舒服程度、云好不好看，
   全都只能靠人眼看图。这里只守"结构上装上了、参数没写反、没有把画面压黑"——
   这几条恰好是纯逻辑断言抓得到、而肉眼容易漏的那部分。
   ============================================================ */
sec('草地贴图 与 天空');
ok(!!terrain.material.map, '地面挂了贴图（不是只有顶点色）');
ok(terrain.material.map.image && terrain.material.map.image.width === 512,
   '草地贴图是程序化生成的 512² canvas');
ok(terrain.material.map.wrapS === THREE.RepeatWrapping && terrain.material.map.wrapT === THREE.RepeatWrapping,
   '贴图两向都是 RepeatWrapping（少一个方向，平铺就会露出最后一行/列）');
ok(terrain.material.map.repeat.x > 10 && terrain.material.map.repeat.y > 10,
   '平铺次数 = WORLD / GRASS_TILE（实测 ' + terrain.material.map.repeat.x + '）');
ok(terrain.material.roughness > 0.6, '草地不是镜面（roughness ' + terrain.material.roughness + '）');
{
  const col = terrain.geometry.attributes.color;
  let lo = 9, hi = -9;
  for (let i = 0; i < col.count; i++) {
    const v = col.getY(i);            // 顶点色是乘在贴图上的，看绿通道就够
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  console.log('  顶点色调制      = ' + lo.toFixed(3) + ' ~ ' + hi.toFixed(3));
  ok(hi - lo > 0.02, '大尺度斑驳真的写进去了（跨度 ' + (hi - lo).toFixed(3) + '，全 1 就等于没做）');
  ok(lo > 0.6 && hi <= 1.001,
     '调制范围 0.6~1.0：只能压暗不能提亮，超出就会一块死黑（' + lo.toFixed(2) + ' ~ ' + hi.toFixed(2) + '）');
}
/* 注意：这里**测不到**草地贴图的 anisotropy —— 测试夹具把 renderer 换成了桩对象，
   没有 capabilities，所以源码里那句 setMaxAnisotropy 会走"判空跳过"的分支。
   在真实浏览器里它应当等于 16（显卡上限）。这一条只能靠实拍截图看掠射角是否发糊。 */
ok(cloudLayers.length === 2 && cloudLayers.every(m => !!m.material.map && m.material.transparent === true &&
   m.material.depthWrite === false), '天空有 ' + cloudLayers.length + ' 层积云板（透明贴图，且不写深度）');
ok(cloudLayers.every(m => m.material.map.image && m.material.map.image.width > 512),
   '云贴图分辨率 > 512（实测 ' + cloudLayers[0].material.map.image.width + '，太小就会看出像素块）');
ok(cloudLayers.every(m => m.renderOrder < 0), '云的 renderOrder 在天穹之后、场景物体之前');
/* 云板必须是**水平**的：绝对不能在 y 上转任何角度（转了就是"云霄飞车"）。
   几何在构建时已经 rotateX 烘平，所以这里量的是世界包围盒的 y 厚度。 */
ok(cloudLayers.every(m => {
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  return box.max.y - box.min.y < 0.5;
}), '云板是水平的（世界包围盒 y 厚度 < 0.5 m）');
{
  /* 自转必须挂在世界时钟 tAcc 上 —— 直接给 tAcc 赋值再跑一帧，
     逐层断言 rotation.y 精确等于 phase + tAcc * spinRate。这比"跑 600 帧看它变了"更强：
     后者在把实现换成 performance.now() 之后照样会通过。 */
  tAcc = 100;
  loop();
  const bad = cloudLayers.filter(c =>
    Math.abs(c.rotation.y - (c.userData.phase + tAcc * c.userData.spinRate)) > 1e-9);
  ok(bad.length === 0,
     '两层云的自转都挂在世界时钟上（tAcc=' + tAcc.toFixed(3) + ' → ' +
     cloudLayers.map(c => c.rotation.y.toFixed(4)).join(' / ') + '）');
}

/* 长时间跑一次，确认没有泄漏式的增长 */
const before = scene.children.length;
for (let i = 0; i < 600; i++) loop();
ok(scene.children.length === before, '跑 600 帧后场景子节点数不变（' + before + ' → ' + scene.children.length + '）');

${DRIVER_FOOTER}
`;

let failed = false;
try {
  await runGame(DRIVER);
} catch (err) {
  console.log('\n运行失败：' + (err && err.message));
  failed = true;
}
console.log(failed ? '\n>>> 场景开销超预算 <<<' : '\n>>> 场景开销体检通过 <<<');
process.exit(failed ? 1 : 0);
