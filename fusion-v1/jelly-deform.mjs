import { HOME, clamp, sampleWave, waveSections } from "./wave-motion.mjs";

const rest = waveSections(sampleWave(0).points);
const restHeight = rest.at(-1).y;
const restFront = Math.max(...rest.map((s) => s.center + s.radius));
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
export const CONTACT_OVERLAP = .22;

// A height-based deformation cage preserves mesh topology and UVs.
// Source positions must be in local +Y-up space with the feet at y=0.
export function createJellyDeformer(source) {
  const base = Float32Array.from(source);
  let height = 0;
  for (let i = 1; i < base.length; i += 3) height = Math.max(height, base[i]);
  if (!(height > 0)) throw new Error("Jelly asset must have positive height");
  const rows = new Float32Array(base.length / 3);
  const weights = new Float32Array(rows.length);
  const heads = new Float32Array(rows.length);
  for (let v = 0; v < rows.length; v++) {
    const h = clamp(base[v * 3 + 1] / height);
    // Above the shoulders, use one broad cage band instead of a slime's point.
    rows[v] = Math.asin(Math.min(h, .8)) / (Math.PI / 2) * (rest.length - 1);
    weights[v] = smooth((h - .06) / .42);
    heads[v] = smooth((h - .4) / .6);
  }
  return function deform(sections, output) {
    const verticalScale = mix(1, sections.at(-1).y / restHeight, .72);
    const front = Math.max(...sections.map((s) => s.center + s.radius));
    const reach = smooth((front - restFront) / (HOME - restFront));
    const contact = smooth((front - (HOME - .32)) / .315);
    const pivot = HOME - .35;
    const span = HOME + CONTACT_OVERLAP * contact - pivot;
    for (let v = 0; v < rows.length; v++) {
      const i = v * 3, a = Math.min(rest.length - 2, Math.floor(rows[v]));
      const t = rows[v] - a, b = a + 1;
      const radius = mix(sections[a].radius, sections[b].radius, t);
      const originalRadius = mix(rest[a].radius, rest[b].radius, t);
      const scaleX = clamp(radius / originalRadius, .85, 1.4);
      const sx = mix(scaleX, 1, heads[v] * .65) * (1 + .65 * reach * weights[v]);
      const shift = mix(sections[a].center - rest[a].center, sections[b].center - rest[b].center, t);
      // Bring the entire shoulder/head band forward, independently of ears or other tips.
      const bend = mix(shift + reach * (HOME - restFront), HOME - .2, contact) * weights[v];
      const x = base[i] * sx + bend;
      output[i] = x > pivot ? pivot + span * Math.tanh((x - pivot) / span) : x;
      // Tilt the torso cross-section so a strong lean does not shear it into a thin ribbon.
      const tilt = .5 * reach * 4 * weights[v] * (1 - weights[v]);
      output[i + 1] = base[i + 1] * (1 + (verticalScale - 1) * (1 - .2 * heads[v])) - base[i] * sx * tilt;
      const depth = mix(clamp(1 / Math.sqrt(verticalScale * sx), .82, 1.18), 1.15, reach);
      output[i + 2] = base[i + 2] * depth;
    }
  };
}
