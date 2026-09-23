export const INTRO = 0.8;
export const CYCLE = 2.8;
export const ROUNDS = 5;
export const DURATION = INTRO + CYCLE * ROUNDS + 0.6;
export const HOME = 2.6;
export function crossedWaveContacts(previous, current) {
  return Array.from({ length: ROUNDS }, (_, round) => ({ round: round + 1, time: INTRO + round * CYCLE + .91 }))
    .filter((event) => previous < event.time && current >= event.time);
}
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (x) => x * x * (3 - 2 * x);
const snap = (x) => 1 - (1 - x) ** 3;

function dome(cx, width, height, lean = 0) {
  return [[1, 0], [1.02, -.3], [.8, -.72], [.42, -.955], [0, -1],
    [-.42, -.955], [-.8, -.72], [-1.02, -.3], [-1, 0], [-.75, .012],
    [-.5, .012], [-.25, .012], [0, .012], [.25, .012], [.5, .012], [.75, .012]]
    .map(([x, y]) => [cx + x * width + lean * -y, 600 + y * height]);
}
const rest = dome(432, 123, 172);
const wave = [[538,600],[521,506],[537,409],[606,370],[612,323],[557,276],[457,291],[347,423],
  [309,600],[341,602],[372,602],[402,602],[432,602],[462,602],[492,602],[516,602]];
const contact = [[559,600],[551,511],[582,421],[640,380],[640,332],[594,277],[485,290],[378,422],
  [342,600],[370,602],[398,602],[426,602],[454,602],[482,602],[510,602],[539,602]];
const compressed = [[577,600],[579,501],[619,415],[640,382],[640,291],[595,251],[505,296],[391,450],
  [342,600],[371,602],[400,602],[429,602],[458,602],[487,602],[516,602],[547,602]];
const recoil = wave.map(([x, y]) => [432 + (x - 432) * .84 - 21, 600 + (y - 600) * .84]);
const track = [
  [0, rest], [.24, dome(418, 145, 142, -19)], [.67, wave, snap],
  [.91, contact, (x) => x * x], [1.04, compressed, snap], [1.32, recoil, snap],
  [1.6, dome(412, 151, 139, -26)], [1.91, dome(432, 112, 196, 8)],
  [2.19, dome(432, 128, 165)], [2.48, rest], [CYCLE, rest],
];

export function sampleWave(time) {
  const active = time >= INTRO && time < INTRO + CYCLE * ROUNDS;
  const u = active ? (time - INTRO) % CYCLE : 0;
  let points = rest;
  for (let i = 1; i < track.length; i++) {
    if (u <= track[i][0]) {
      const [end, next, easing = smooth] = track[i];
      const [start, previous] = track[i - 1];
      const alpha = easing(clamp((u - start) / (end - start)));
      points = previous.map((p, j) => [mix(p[0], next[j][0], alpha), mix(p[1], next[j][1], alpha)]);
      break;
    }
  }
  return {
    points,
    round: active ? Math.floor((time - INTRO) / CYCLE) + 1 : time < INTRO ? 0 : ROUNDS,
    phase: !active ? time < INTRO ? "就位" : "完成" :
      u < .24 ? "蓄力" : u < .91 ? "起浪" : u < 1.09 ? "对撞" : u < 2.48 ? "回弹" : "就位",
  };
}

// Sample the original V4 Bezier silhouette, then lift its horizontal sections into 3D.
export function sampleOutline(points, steps = 12) {
  const outline = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[(i + n - 1) % n], b = points[i], c = points[(i + 1) % n], d = points[(i + 2) % n];
    const p = [b[0] + (c[0] - a[0]) * .13, b[1] + (c[1] - a[1]) * .13];
    const q = [c[0] - (d[0] - b[0]) * .13, c[1] - (d[1] - b[1]) * .13];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, s = 1 - t;
      outline.push([
        s ** 3 * b[0] + 3 * s * s * t * p[0] + 3 * s * t * t * q[0] + t ** 3 * c[0],
        s ** 3 * b[1] + 3 * s * s * t * p[1] + 3 * s * t * t * q[1] + t ** 3 * c[1],
      ]);
    }
  }
  return outline;
}

export function waveSections(points, count = 48) {
  const outline = sampleOutline(points);
  const top = Math.min(...outline.map((p) => p[1]));
  const height = (600 - top) / 80;
  const sections = [];
  for (let row = 0; row <= count; row++) {
    const h = Math.sin(row / count * Math.PI / 2);
    const y = mix(599.99, top + .001, h);
    const xs = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(mix(a[0], b[0], (y - a[1]) / (b[1] - a[1])));
      }
    }
    const left = Math.min(...xs), right = Math.min(639.6, Math.max(...xs));
    sections.push({
      center: ((left + right) / 2 - 432) / 80,
      radius: Math.max(.001, (right - left) / 160),
      y: row === 0 ? 0 : height * h,
      depth: row === count ? .001 : Math.max(.015, 1.12 * Math.sqrt(1 - h * h)),
    });
  }
  return sections;
}
