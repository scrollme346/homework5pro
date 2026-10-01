/**
 * Generates the built-in SFX library (assets/sfx) procedurally, so the app
 * ships with royalty-free sounds of our own. Users can drop extra .wav/.mp3
 * files into the same category folders.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SR = 48000;

function wav(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;
  };
}

function normalize(x: Float32Array, peakDb = -3): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  const g = m > 0 ? Math.pow(10, peakDb / 20) / m : 1;
  // Short fade-in/out to avoid clicks at the edges.
  const f = Math.min(64, x.length >> 2);
  for (let i = 0; i < x.length; i++) {
    let e = 1;
    if (i < f) e = i / f;
    if (i > x.length - f) e = (x.length - i) / f;
    x[i] *= g * e;
  }
  return x;
}

/** State-variable band-pass filter with a time-varying centre. */
function bandpass(input: Float32Array, freq: (t: number) => number, q: number): Float32Array {
  const out = new Float32Array(input.length);
  let low = 0;
  let band = 0;
  for (let i = 0; i < input.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(freq(i / SR), SR / 6)) / SR);
    const high = input[i] - low - band / q;
    band += f * high;
    low += f * band;
    out[i] = band;
  }
  return out;
}

function click(seed: number, tone: number): Float32Array {
  const n = Math.round(SR * 0.045);
  const r = rng(seed);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    x[i] = (Math.sin(2 * Math.PI * tone * t) * 0.8 + r() * 0.35) * Math.exp(-t / 0.006);
  }
  return normalize(bandpass(x, () => tone, 1.4), -4);
}

function pop(seed: number, f0: number, f1: number): Float32Array {
  const n = Math.round(SR * 0.16);
  const r = rng(seed);
  const x = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.018);
    phase += (2 * Math.PI * f) / SR;
    x[i] = (Math.sin(phase) + r() * 0.03) * Math.exp(-t / 0.04) * Math.min(1, t / 0.002);
  }
  return normalize(x, -4);
}

function whoosh(seed: number, dur: number, fLow: number, fHigh: number): Float32Array {
  const n = Math.round(SR * dur);
  const r = rng(seed);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = r();
  const peakAt = dur * 0.62;
  const y = bandpass(
    noise,
    (t) => {
      const p = t / dur;
      return fLow + (fHigh - fLow) * Math.sin(Math.PI * Math.min(1, p * 1.1));
    },
    1.8,
  );
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = t < peakAt ? Math.pow(t / peakAt, 2.2) : Math.exp(-(t - peakAt) / (dur * 0.12));
    y[i] *= env;
  }
  return normalize(y, -3);
}

function impact(seed: number, f0: number): Float32Array {
  const n = Math.round(SR * 0.9);
  const r = rng(seed);
  const x = new Float32Array(n);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 * (0.6 + 0.4 * Math.exp(-t / 0.08));
    phase += (2 * Math.PI * f) / SR;
    lp += 0.08 * (r() - lp);
    x[i] = Math.sin(phase) * Math.exp(-t / 0.28) + lp * 2.2 * Math.exp(-t / 0.05);
  }
  return normalize(x, -3);
}

const out = join(__dirname, '..', 'assets', 'sfx');
const files: Record<string, Float32Array> = {
  'click/click_soft_01.wav': click(1, 2600),
  'click/click_soft_02.wav': click(2, 3200),
  'click/click_tap_03.wav': click(3, 2100),
  'pop/pop_soft_01.wav': pop(4, 1100, 420),
  'pop/pop_soft_02.wav': pop(5, 900, 360),
  'pop/pop_bubble_03.wav': pop(6, 1400, 600),
  'whoosh/whoosh_soft_01.wav': whoosh(7, 0.5, 350, 2400),
  'whoosh/whoosh_air_02.wav': whoosh(8, 0.42, 500, 3200),
  'whoosh/whoosh_low_03.wav': whoosh(9, 0.55, 250, 1600),
  'impact/impact_soft_01.wav': impact(10, 70),
  'impact/impact_deep_02.wav': impact(11, 55),
};
for (const [name, samples] of Object.entries(files)) {
  const p = join(out, name);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, wav(samples));
  console.log('wrote', name);
}
