import {runGame, DRIVER_HEAD, DRIVER_FOOTER} from './harness.mjs';
await runGame(`
${DRIVER_HEAD}
started = true;
globalThis.__lockMode = 'ok';
document.pointerLockElement = el('app');
fireDoc('pointerlockchange', {});


sec('8a. Alt 显示鼠标，点击恢复');
const savedDragLook = dragLook;
dragLook = false;
const savedExitPointerLock = document.exitPointerLock;
let altUnlockCalls = 0;
document.exitPointerLock = () => { altUnlockCalls++; };
for (const altCode of ['AltLeft', 'AltRight']) {
  vacMouse = true;
  dragging = true;
  const altYaw = player.yaw;
  pressKey(altCode);
  ok(cursorReleased && !paused, altCode + ' 显示鼠标且不暂停');
  ok(!vacMouse && !dragging, '停止鼠标吸入与拖拽');
  fireDoc('mousemove', {movementX: 100, movementY: 0});
  ok(player.yaw === altYaw, '等待解锁时也不会转动视角');
  document.pointerLockElement = null;
  fireDoc('pointerlockchange', {});
  releaseKey(altCode);
  ok(!locked && !paused && cursorReleased, '解锁及松开 Alt 后保持鼠标可见，不弹暂停菜单');
  fire('app', 'mousedown');
  ok(!vacMouse && !dragging, '恢复点击不会误触吸入或拖拽');
  const lockCallsBefore = globalThis.__lockCalls;
  fire('app', 'click');
  ok(!cursorReleased && globalThis.__lockCalls === lockCallsBefore + 1, '点击画面重新请求指针锁');
  document.pointerLockElement = el('app');
  fireDoc('pointerlockchange', {});
  ok(locked && !paused, '恢复视角控制');
}
ok(altUnlockCalls === 2, '左右 Alt 均主动调用退出指针锁');
document.exitPointerLock = savedExitPointerLock;
dragLook = savedDragLook;
document.pointerLockElement = null;
fireDoc('pointerlockchange', {});
ok(!locked && paused, 'Esc 退出指针锁仍然暂停');
${DRIVER_FOOTER}
`);
