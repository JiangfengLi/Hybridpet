import { INTRO, CYCLE, sampleWave } from "./wave-motion.mjs";
import { sampleRecombination } from "./recombination-motion.mjs";

export const QTE_LIMIT = 10;
export const MAX_SPEED = 3;
export const SURGE_ROUNDS = 4;
export const MAX_SURGE_SPEED = 6;
export const ROTATION_SPEED = Math.PI / 3;

export function sampleCombinationRotation(time) {
  const elapsed = Math.max(0, time - INTRO), ramp = .35;
  // Integral of smoothstep: start gently, then turn once per six animation seconds.
  if (elapsed < ramp) {
    const u = elapsed / ramp;
    return ROTATION_SPEED * ramp * (u ** 3 - .5 * u ** 4);
  }
  return ROTATION_SPEED * (elapsed - ramp / 2);
}

export function sampleCombination(time) {
  const local = time < INTRO ? time : INTRO + (time - INTRO) % CYCLE;
  return { ...sampleWave(local), round: time < INTRO ? 0 : Math.floor((time - INTRO) / CYCLE) + 1 };
}

function nextContactIndex(time) {
  const first = INTRO + .91;
  let index = Math.max(0, Math.floor((time - first) / CYCLE));
  // Compare actual markers so a rounded division never repeats a boundary hit.
  while (first + index * CYCLE <= time) index++;
  return index;
}

export function combinationContacts(previous, current) {
  const first = INTRO + .91;
  const events = [];
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current <= previous) return events;
  for (let index = nextContactIndex(previous); first + index * CYCLE <= current; index++) {
    events.push({ round: index + 1, time: first + index * CYCLE });
  }
  return events;
}

export const FUSION_TARGET_PRESSES = 52;
export const FUSION_PRESS_VALUE = .04;
export const FUSION_EARLY_DAMPING = .2;
export const FUSION_LATE_DAMPING = .6;
export const FUSION_DAMPING_START = .7;
export const FUSION_DECAY_PER_SECOND = .012;
export const FUSION_RESISTANCE_POWER = 2.35;
export const FUSION_MAX_RESISTANCE = 2.2;

export function fusionDecayRate(progress) {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return FUSION_DECAY_PER_SECOND * (1 + FUSION_MAX_RESISTANCE * p ** FUSION_RESISTANCE_POWER);
}

export function fusionDampingRatio(progress) {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (p <= FUSION_DAMPING_START) return FUSION_EARLY_DAMPING * p / FUSION_DAMPING_START;
  return FUSION_EARLY_DAMPING
    + (FUSION_LATE_DAMPING - FUSION_EARLY_DAMPING)
    * (p - FUSION_DAMPING_START) / (1 - FUSION_DAMPING_START);
}

export function fusionPressGain(progress) {
  return FUSION_PRESS_VALUE * (1 - fusionDampingRatio(progress));
}

export function createCombineSession({ progressive = false } = {}) {
  let state = "setup", presses = 0, time = 0, cinematicTime = 0;
  let progress = 0, completed = false;
  let completedAt = -1;
  let surgeStart = 0, surgeEnd = 0, surgeRound = 0;
  let pendingContacts = [];
  return {
    get state() { return state; },
    get presses() { return presses; },
    get progress() { return progressive ? progress : 0; },
    get targetPresses() { return progressive ? FUSION_TARGET_PRESSES : QTE_LIMIT; },
    get completed() { return progressive ? completed : false; },
    get speed() {
      if (progressive) return 1 + progress * 5.2;
      if (state === "cinematic") return MAX_SURGE_SPEED;
      if (state === "surge") {
        const progress = Math.max(0, Math.min(1, (time - surgeStart) / (surgeEnd - surgeStart)));
        return MAX_SPEED + (MAX_SURGE_SPEED - MAX_SPEED) * progress * progress * (3 - 2 * progress);
      }
      return 1 + presses / QTE_LIMIT * (MAX_SPEED - 1);
    },
    get time() { return time; },
    get rotation() { return sampleCombinationRotation(time); },
    get fullReveal() { return progressive ? state === "cinematic" : state === "surge" || state === "cinematic"; },
    get surgeRound() { return surgeRound; },
    get cinematicTime() { return cinematicTime; },
    get cinematicPhase() {
      if (state !== "cinematic") return null;
      if (!progressive) return sampleRecombination(cinematicTime).phase;
      if (completed) return cinematicTime - completedAt < .92 ? "birth" : "result";
      return progress < .18 ? "entry" : progress < .42 ? "weaving" : progress < .7 ? "coiling" : "sphere";
    },
    // Retained for host compatibility; V1 now renders original colors throughout.
    get light() { return 0; },
    start(ready) {
      if (!ready || (!progressive && state === "running")) return false;
      if (progressive) {
        state = "cinematic";
        presses = 0; time = 0; cinematicTime = 0;
        progress = 0; completed = false; completedAt = -1;
        pendingContacts = [];
        return true;
      }
      state = "running"; presses = 0; time = 0; cinematicTime = 0;
      surgeStart = 0; surgeEnd = 0; surgeRound = 0;
      pendingContacts = [];
      return true;
    },
    press({ repeat = false } = {}) {
      if (progressive) {
        if (state !== "cinematic" || repeat || completed) return false;
        const gain = fusionPressGain(progress);
        presses += 1;
        progress = Math.min(1, progress + gain);
        if (progress >= .999) {
          progress = 1;
          completed = true;
          completedAt = cinematicTime;
        }
        return true;
      }
      if (state !== "running" || repeat || presses >= QTE_LIMIT) return false;
      presses = Math.min(QTE_LIMIT, presses + 1);
      if (presses === QTE_LIMIT) {
        state = "surge"; surgeStart = time; surgeRound = 0; pendingContacts = [];
        // Finish four future contact/recovery beats without rewinding the current pose.
        surgeEnd = INTRO + (nextContactIndex(time) + SURGE_ROUNDS) * CYCLE;
      }
      return true;
    },
    // The host confirms a surface hit; crossing the animation marker alone is insufficient.
    confirmContact(event) {
      if (!["running", "surge"].includes(state) || !pendingContacts.includes(event)) return false;
      pendingContacts = pendingContacts.filter((pending) => pending !== event);
      return true;
    },
    update(delta) {
      pendingContacts = [];
      if (state === "setup" || !Number.isFinite(delta) || delta <= 0) return [];
      if (progressive) {
        cinematicTime += Math.min(delta, .05);
        if (!completed) {
          const elapsed = Math.min(delta, .05);
          progress = Math.max(0, progress - elapsed * fusionDecayRate(progress));
        }
        return [];
      }
      if (state === "cinematic") {
        cinematicTime += Math.min(delta, .05);
        return [];
      }
      const before = time;
      time += Math.min(delta, .05) * this.speed;
      if (state === "surge") time = Math.min(time, surgeEnd);
      pendingContacts = combinationContacts(before, time);
      if (state === "surge") {
        surgeRound += pendingContacts.length;
        if (time >= surgeEnd) state = "cinematic";
      }
      return [...pendingContacts];
    },
    reset() {
      state = "setup"; presses = 0; time = 0; cinematicTime = 0;
      progress = 0; completed = false; completedAt = -1;
      surgeStart = 0; surgeEnd = 0; surgeRound = 0;
      pendingContacts = [];
    },
  };
}
