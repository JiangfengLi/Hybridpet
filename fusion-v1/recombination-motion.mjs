export const FILM_DRAWN_AT = 1;
export const FILM_FORMED_AT = 3.35;
export const FILM_SEPARATE_AT = 3.65;
export const FILM_BIRTH_AT = 4.3;
export const FILM_SETTLED_AT = 5.3;
export const STRAND_LENGTH = 10;
export const STRAND_RADIUS = .19;
export const FILM_SPIN_SPEED = .24;

export function sampleRecombinationRotation(time, angularVelocity = FILM_SPIN_SPEED) {
  const t = Math.max(0, Number.isFinite(time) ? time : 0), settle = 1.5;
  const elapsed = Math.max(0, t - FILM_DRAWN_AT);
  const u = Math.min(1, elapsed / settle);
  // Keep the incoming velocity throughout drawing, then ease into the DNA turn.
  const transition = angularVelocity * settle * u +
    (FILM_SPIN_SPEED - angularVelocity) * settle * (u ** 3 - .5 * u ** 4);
  return angularVelocity * Math.min(t, FILM_DRAWN_AT) +
    transition + FILM_SPIN_SPEED * Math.max(0, elapsed - settle);
}

export function smoothRange(start, end, value) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function sampleRecombination(time) {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  return {
    phase: t < .08 ? "entry" : t < FILM_DRAWN_AT ? "drawing" : t < 2.5 ? "weaving" :
      t < FILM_FORMED_AT ? "coiling" : t < FILM_SEPARATE_AT ? "sphere" :
        t < FILM_BIRTH_AT ? "separating" : t < FILM_SETTLED_AT ? "birth" : "result",
    draw: smoothRange(.08, FILM_DRAWN_AT, t),
    weave: smoothRange(FILM_DRAWN_AT, 2.5, t),
    coil: smoothRange(2.5, FILM_FORMED_AT, t),
    separate: smoothRange(FILM_SEPARATE_AT, 4.05, t),
    escape: Math.max(0, Math.min(1, (t - 4) / .28)) ** 2,
    reveal: smoothRange(FILM_BIRTH_AT, FILM_SETTLED_AT, t),
  };
}

// Opposing soft curves carry into the double helix without a rigid straight hold.
export function sampleStrand(u, side, time, target = {}, pose = sampleRecombination(time)) {
  const phase = side * Math.PI + (u - .5) * Math.PI * 4.5 * pose.weave;
  const direction = side ? -1 : 1;
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  const arch = Math.sin(Math.PI * u);
  const bend = arch * (.9 + .12 * Math.sin(t * 2.4) + .3 * Math.sin(u * Math.PI * 2 - t * 1.8));
  const curvedX = direction * (1.65 + bend);
  const curvedZ = direction * .55 * arch * Math.sin(u * Math.PI * 2 - t * 1.2);
  const amplitude = 1.16;
  target.x = curvedX * (1 - pose.weave) + Math.cos(phase) * amplitude * pose.weave;
  target.y = 2 + (u - .5) * STRAND_LENGTH;
  target.z = curvedZ * (1 - pose.weave) + Math.sin(phase) * amplitude * pose.weave;
  const latitude = (u - .5) * Math.PI;
  const longitude = u * Math.PI * 8 + side * Math.PI;
  const ring = Math.cos(latitude) * .97;
  target.x += (Math.cos(longitude) * ring - target.x) * pose.coil;
  target.y += (2 + Math.sin(latitude) * .97 - target.y) * pose.coil;
  target.z += (Math.sin(longitude) * ring - target.z) * pose.coil;
  return target;
}

export function sampleHybridBirth(time) {
  const age = Math.max(0, time - FILM_BIRTH_AT);
  const u = Math.min(1, age / (FILM_SETTLED_AT - FILM_BIRTH_AT));
  const c = 1.45;
  const scale = u === 0 ? 0 : 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
  return {
    visible: time >= FILM_BIRTH_AT,
    scale,
    lift: Math.sin(Math.PI * u) * .8,
    firework: time >= FILM_BIRTH_AT && age < 1.15 ? age : -1,
  };
}
