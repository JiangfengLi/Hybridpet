/**
 * 临时探针：把 8c 节里每种模型的实际落点打出来，用来给截图取景挑机位。
 * 用法： node _probe_props.mjs
 * 不是测试，不进 test/run.sh。
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';

const DRIVER = `
${DRIVER_HEAD}
const stats = globalThis.__propStats;
console.log('=== __propStats ===');
console.log(JSON.stringify(stats));

const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
const all = [];
for (const mesh of propMeshes) {
  const name = mesh.name.replace('prop:', '');
  const def = PROP_DEFS.find(d => d.name === name);
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
    all.push({ name, i, x: +p.x.toFixed(2), z: +p.z.toFixed(2), sc: +s.x.toFixed(2) });
  }
}
console.log('\\n=== 按类型分组（按离原点距离排序）===');
for (const def of PROP_DEFS) {
  const g = all.filter(a => a.name === def.name).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  console.log('\\n-- ' + def.name + '  n=' + g.length + '  单件缩放 ' + g[0].sc + '~' + g[g.length - 1].sc);
  for (const a of g) console.log('   (' + String(a.x).padStart(7) + ', ' + String(a.z).padStart(7) + ')  r=' + Math.hypot(a.x, a.z).toFixed(1).padStart(6) + '  sc=' + a.sc);
}

/* 挑机位：给每个候选落点算"周围 24 m 内同类有几株"，多一点的适合取景。
   同时给"最近信号源距离" —— 这个字段是吃过大亏加上的：
   信号源是十几米高的白色光柱，机位站在它 3.4 m 处时，整块糊住画面右半边，
   拍出来完全没法看（见 _shots 里 g2 的旧版机位）。取景前先看这一列。 */
console.log('\\n=== 取景建议（同类 30 m 内邻居数最多的 6 个点）===');
for (const def of ['tree-01', 'stone-01', 'grass-01', 'bush-01']) {
  const g = all.filter(a => a.name === def);
  const scored = g.map(a => ({ ...a, near: g.filter(b => b !== a && Math.hypot(b.x - a.x, b.z - a.z) < 30).length }))
                   .sort((a, b) => b.near - a.near).slice(0, 6);
  console.log('\\n' + def + ':');
  for (const a of scored) {
    const ds = signals.map(s => Math.hypot(s.x - a.x, s.z - a.z)).sort((p, q) => p - q);
    console.log('   (' + a.x + ', ' + a.z + ')  sc=' + a.sc +
                '  30m 内同类 ' + a.near + ' 株' +
                '  最近信号源 ' + ds[0].toFixed(1) + ' m' + (ds[0] < 12 ? '  ⚠ 太近，别把机位放这' : ''));
  }
}
`;

await runGame(DRIVER);
