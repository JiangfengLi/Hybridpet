import { runGame, DRIVER_HEAD } from './test/harness.mjs';
const DRIVER = `
${DRIVER_HEAD}
console.log('模型       顶点数  索引数  三角  材质类型              transparent alphaTest side             color      emissive   贴图尺寸      实例数');
for (const mesh of propMeshes) {
  const g = mesh.geometry, m = mesh.material;
  const vtx = g.attributes.position.count;
  const idx = g.index ? g.index.count : 0;
  const map = m.map;
  const img = map && map.image ? (map.image.width + 'x' + map.image.height) : '(无)';
  console.log(
    mesh.name.replace('prop:','').padEnd(10) +
    String(vtx).padStart(6) + String(idx).padStart(8) +
    String(Math.round((idx||vtx)/3)).padStart(6) + '  ' +
    m.type.padEnd(22) +
    String(!!m.transparent).padEnd(12) + String(m.alphaTest).padEnd(10) +
    String(m.side).padEnd(16) +
    ('#' + m.color.getHexString()).padEnd(11) +
    ('#' + (m.emissive ? m.emissive.getHexString() : '-')).padEnd(12) +
    img.padEnd(14) + mesh.count
  );
}
console.log('\\n=== 贴图通道情况（判断是不是 alpha 叶片卡）===');
for (const mesh of propMeshes) {
  const m = mesh.material, map = m.map;
  console.log('  ' + mesh.name.replace('prop:','').padEnd(10) +
    ' map=' + (map ? map.constructor.name : 'null') +
    ' wrapS=' + (map && map.wrapS) + ' flipY=' + (map && map.flipY) +
    ' colorSpace=' + (map && map.colorSpace) +
    ' (index = 0-based)');
  /* 注意：JSON.stringify 已经返回字符串，后面不能再 .join()
     —— 这是我第一版写错的地方（报 "join is not a function"）。 */
  if (map) console.log('  ' + ' '.repeat(10) + ' 贴图 object 字段: ' + Object.keys(map).join(','));
}
console.log('\\n=== 三角形数与顶点颜色 ===');
for (const mesh of propMeshes) {
  const g = mesh.geometry;
  console.log('  ' + mesh.name.replace('prop:','').padEnd(10) +
    ' attrs=[' + Object.keys(g.attributes).join(', ') + ']  groups=' + g.groups.length +
    '  index=' + (g.index ? g.index.array.constructor.name : 'null'));
}
`;
await runGame(DRIVER);
