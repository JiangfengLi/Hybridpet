export function createCombineAudio(url, onStatus = () => {}) {
  let context, gain, buffer, loading, muted = false, enabled = false, disposed = false, volume = .48;
  const voices = new Set();
  const bytes = fetch(url).then((response) => {
    if (!response.ok) throw new Error("Audio request failed");
    return response.arrayBuffer();
  });
  // Fetch failure is reported on activation, without an unhandled rejection.
  bytes.catch(() => {});
  const stop = () => {
    enabled = false;
    for (const source of voices) {
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    voices.clear();
  };
  return {
    get muted() { return muted; },
    get ready() { return Boolean(buffer); },
    get activeVoices() { return voices.size; },
    async activate() {
      if (disposed) return;
      enabled = true;
      try {
        if (!context) {
          context = new AudioContext();
          gain = context.createGain();
          gain.gain.value = muted ? 0 : volume;
          gain.connect(context.destination);
        }
        await context.resume();
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
    setMuted(value) {
      muted = Boolean(value);
      if (gain) gain.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      const next = Math.max(0, Math.min(1, value));
      if (next === volume) return;
      volume = next;
      if (gain) gain.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
    },
    stop,
    dispose() { disposed = true; stop(); context?.close(); },
  };
}
