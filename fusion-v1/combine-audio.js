export function createCombineAudio(url, onStatus = () => {}, { music = false } = {}) {
  let context, gain, musicGain, buffer, loading, muted = false, enabled = false, disposed = false, volume = .48;
  let musicVolume = .16;
  let musicTimer, nextBeat = 0, musicStep = 0;
  const voices = new Set();
  const musicVoices = new Set();
  const pattern = [261.63, 311.13, 392, 466.16, 392, 311.13, 233.08, 311.13];
  const bytes = fetch(url).then((response) => {
    if (!response.ok) throw new Error("Audio request failed");
    return response.arrayBuffer();
  });
  // Fetch failure is reported on activation, without an unhandled rejection.
  bytes.catch(() => {});
  const stop = () => {
    enabled = false;
    clearInterval(musicTimer);
    musicTimer = undefined;
    for (const source of [...voices, ...musicVoices]) {
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    voices.clear();
    musicVoices.clear();
  };
  const tone = (frequency, start, duration, type, level, destination, detune = 0) => {
    const oscillator = context.createOscillator(), envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.detune.setValueAtTime(detune, start);
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(level, start + .012);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(envelope).connect(destination);
    const set = destination === musicGain ? musicVoices : voices;
    set.add(oscillator);
    oscillator.onended = () => {
      set.delete(oscillator); oscillator.disconnect(); envelope.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration + .04);
  };
  const scheduleMusic = () => {
    if (!enabled || disposed || !music) return;
    // Do not queue a burst of missed notes after the browser stalls.
    nextBeat = Math.max(nextBeat, context.currentTime);
    while (nextBeat < context.currentTime + .3) {
      const step = musicStep++, root = pattern[step % pattern.length];
      tone(root, nextBeat, .13, "square", .075, musicGain);
      tone(root / 2, nextBeat, .17, "triangle", .045, musicGain, -7);
      if (step % 4 === 0) {
        tone(96, nextBeat, .16, "sine", .17, musicGain);
        tone(1800, nextBeat + .105, .025, "square", .025, musicGain);
      }
      nextBeat += .205;
    }
  };
  const syncGain = () => {
    if (!gain) return;
    gain.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
    musicGain.gain.setValueAtTime(muted ? 0 : musicVolume, context.currentTime);
  };
  return {
    get muted() { return muted; },
    get ready() { return Boolean(buffer); },
    get activeVoices() { return voices.size; },
    get musicPlaying() { return musicTimer !== undefined; },
    async activate() {
      if (disposed) return;
      enabled = true;
      try {
        if (!context) {
          context = new AudioContext();
          gain = context.createGain();
          musicGain = context.createGain();
          syncGain();
          gain.connect(context.destination);
          musicGain.connect(context.destination);
        }
        await context.resume();
        if (!enabled || disposed) return;
        if (music && musicTimer === undefined) {
          nextBeat = context.currentTime + .04; musicStep = 0;
          scheduleMusic();
          musicTimer = setInterval(scheduleMusic, 70);
        }
        loading ||= bytes.then((data) => context.decodeAudioData(data.slice(0)));
        buffer = await loading;
        if (!disposed) onStatus("ready");
      } catch {
        if (!disposed) onStatus("unavailable");
      }
    },
    impact(speed = 1) {
      if (!enabled || muted || !buffer || context?.state !== "running" || disposed) return false;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = Math.max(1, Math.min(6, speed));
      source.connect(gain);
      source.onended = () => { voices.delete(source); source.disconnect(); };
      voices.add(source);
      source.start();
      return true;
    },
    press(speed = 1) {
      if (!enabled || muted || context?.state !== "running" || disposed) return false;
      const now = context.currentTime, pitch = 130 + Math.min(6, Math.max(1, speed)) * 18;
      tone(pitch, now, .075, "square", .12, gain);
      tone(pitch * 1.5, now, .045, "triangle", .05, gain, 12);
      return true;
    },
    setMuted(value) {
      muted = Boolean(value);
      syncGain();
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      const next = Math.max(0, Math.min(1, value));
      if (next === volume) return;
      volume = next;
      syncGain();
    },
    setMusicVolume(value) {
      if (!Number.isFinite(value)) return;
      musicVolume = Math.max(0, Math.min(1, value));
      syncGain();
    },
    stop,
    dispose() { disposed = true; stop(); context?.close(); },
  };
}
