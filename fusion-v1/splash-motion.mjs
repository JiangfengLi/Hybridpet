export const SPLASH_COUNT = 24;
export const SPLASH_LIFETIME = .9;

function random(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(1664525, value) + 1013904223) >>> 0; return value / 4294967296; };
}

export function createSplashDrops(seed = 1, count = SPLASH_COUNT) {
  const rand = random(seed);
  return Array.from({ length: count }, (_, index) => {
    const side = index % 2, sign = side ? 1 : -1;
    return {
      side,
      radius: .04 + rand() * .065,
      vx: sign * (.9 + rand() * 2.8),
      vy: .8 + rand() * 2.8,
      vz: .55 + rand() * 1.25,
      life: .55 + rand() * (SPLASH_LIFETIME - .55),
      phase: rand() * Math.PI * 2,
      filament: index < 6,
    };
  });
}

// Closed-form art-directed flight; no frame-rate-dependent accumulation.
export function sampleSplashDrop(drop, age, size = 1) {
  if (age < 0 || age >= drop.life) return null;
  const u = age / drop.life, damping = (1 - Math.exp(-2 * age)) / 2;
  const envelope = Math.min(1, age / .035) * Math.min(1, (1 - u) / .3);
  const wobble = Math.sin(age * 28 + drop.phase) * .15 * (1 - u);
  const stretch = (drop.filament ? 3.8 : 1.9) * Math.exp(-age * 5) + .9;
  return {
    x: drop.vx * damping * size,
    y: (drop.vy * damping - 2.7 * age * age) * size,
    z: drop.vz * damping * size,
    vx: drop.vx * Math.exp(-2 * age),
    vy: drop.vy * Math.exp(-2 * age) - 5.4 * age,
    vz: drop.vz * Math.exp(-2 * age),
    width: drop.radius * size * envelope * (1 + wobble) / Math.sqrt(stretch),
    length: drop.radius * size * envelope * stretch,
  };
}
