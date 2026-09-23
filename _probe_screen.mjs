/**
 * 把 g8 / g7 机位下**每个 prop 实例**投到屏幕像素上，打印类型 + 像素 + 投影半径。
 * 目的：截图里"中间那丛橄榄绿的到底是谁"不能靠肉眼认 —— 直接把答案算出来。
 * 相机用的是**游戏自己那个 camera**（同一 module 作用域），所以位置/朝向/FOV 全对。
 *
 * 用法： node _probe_screen.mjs "autostart=1&intro=0&still=1&pos=-4.7,50.5&watch=-4.7,44.57,1.0"
 */
import { runGame, DRIVER_HEAD } from './test/harness.mjs';

const search = process.argv[2];
if (!search) { console.error('要传查询串'); process.exit(2); }
const W = 960, H = 540;

const DRIVER = `
${DRIVER_HEAD}
for (let i = 0; i < 4; i++) loop();
camera.updateMatrixWorld(true);
console.log('相机位置 = (' + camera.position.x.toFixed(2) + ', ' + camera.position.y.toFixed(2) + ', ' + camera.position.z.toFixed(2) + ')');
console.log('相机 yaw/pitch = ' + player.yaw.toFixed(3) + ' / ' + player.pitch.toFixed(3) + '   fov=' + camera.fov + ' aspect=' + camera.aspect.toFixed(4));

const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
const rows = [];
for (const mesh of propMeshes) {
  const def = PROP_DEFS.find(d => 'prop:' + d.name === mesh.name);
  const bb = mesh.geometry.boundingBox;
  const rad = 0.5 * Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m4); m4.decompose(p, q, s);
    const shownScale = s.x;
    v.copy(p); v.y += (bb.max.y + bb.min.y) / 2 * shownScale;
    const dist = camera.position.distanceTo(v);
    const n = v.clone().project(camera);
    /* 投影半径：把包围球半径换算成屏幕像素（近似，水平方向）*/
    const radPx = (rad * shownScale) / (dist * Math.tan(camera.fov * Math.PI / 360)) * (${H} / 2);
    rows.push({
      name: def.name, i, dist, radPx,
      px: (n.x * 0.5 + 0.5) * ${W}, py: (-n.y * 0.5 + 0.5) * ${H},
      behind: n.z > 1 || n.z < -1,
      h: (bb.max.y - bb.min.y) * shownScale,
    });
  }
}
rows.sort((a, b) => a.dist - b.dist);
console.log('\\n类型        实例   距离    屏$x     屏$y    投影半径  游戏内高  在画面内?');
for (const r of rows) {
  const inFrame = !r.behind && r.px > -r.radPx && r.px < ${W} + r.radPx && r.py > -r.radPx && r.py < ${H} + r.radPx;
  if (r.dist > 60) continue;                       // 只看近场，远处全是噪声
  console.log('  ' + r.name.padEnd(9) + String(r.i).padStart(2) + '  ' +
    r.dist.toFixed(1).padStart(7) + ' m  ' +
    r.px.toFixed(0).padStart(5) + '  ' + r.py.toFixed(0).padStart(5) + '   ' +
    r.radPx.toFixed(0).padStart(5) + ' px   ' + r.h.toFixed(2) + ' m    ' + (inFrame ? '是' : '否'));
}
`;
await runGame(DRIVER, { search });
