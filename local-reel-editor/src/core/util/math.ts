export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Sine easings. Same curves are used by preview and FFmpeg renderer.
 * 'in' ends and 'out' starts with slope π/2, so a chain in → linear → out
 * can be velocity-matched (see planner/motionChain).
 */
export function ease(kind: 'inOut' | 'in' | 'out' | 'linear', t: number): number {
  const x = clamp(t, 0, 1);
  switch (kind) {
    case 'linear':
      return x;
    case 'in':
      return 1 - Math.cos((Math.PI * x) / 2);
    case 'out':
      return Math.sin((Math.PI * x) / 2);
    default:
      return (1 - Math.cos(Math.PI * x)) / 2;
  }
}

export const easeInOut = (t: number): number => ease('inOut', t);

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
