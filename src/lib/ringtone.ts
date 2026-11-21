"use client";

/** Synthesised ringtones (Web Audio). No audio files, works offline. */
export type Ringtone = "classic" | "marimba" | "pulse";

export function playRingtone(kind: Ringtone): () => void {
  const ctx = new AudioContext();
  let stopped = false;
  const tone = (freq: number, start: number, dur: number, type: OscillatorType = "sine", vol = 0.25) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime + start);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.05);
  };
  const patterns: Record<Ringtone, () => void> = {
    classic: () => { for (let i = 0; i < 10; i++) { tone(440, i * 0.1, 0.09, "square", 0.08); tone(480, i * 0.1, 0.09, "square", 0.08); } },
    marimba: () => [659, 784, 988, 784, 659, 523].forEach((f, i) => tone(f, i * 0.18, 0.35, "sine", 0.3)),
    pulse: () => { tone(880, 0, 0.25, "triangle"); tone(880, 0.4, 0.25, "triangle"); },
  };
  const loop = () => { if (stopped) return; patterns[kind](); setTimeout(loop, 2200); };
  loop();
  return () => { stopped = true; ctx.close().catch(() => {}); };
}
