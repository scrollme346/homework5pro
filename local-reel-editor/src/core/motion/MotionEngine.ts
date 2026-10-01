import type { ClipActivity, FitMode, MediaProbe, Point, Segment } from '../model/types';
import { clamp, ease, lerp } from '../util/math';

export const FRAME_W = 1080;
export const FRAME_H = 1920;

/** Visible window of the composed 9:16 frame, all values normalised 0..1. */
export interface Viewport {
  scale: number;
  x: number;
  y: number;
}

export function defaultFitMode(probe: Pick<MediaProbe, 'width' | 'height'>): FitMode {
  if (!probe.width || !probe.height) return 'cover';
  const ar = probe.width / probe.height;
  // Portrait recordings (phones, 9:16 … 9:21) fill the frame; anything wider is fitted on a blurred fill.
  return ar >= 0.4 && ar <= 0.72 ? 'cover' : 'blur-fit';
}

/** Where the source picture lands inside the 9:16 frame (normalised). */
export function sourceRect(fit: FitMode, sw: number, sh: number): { x: number; y: number; w: number; h: number } {
  const scale = fit === 'cover' ? Math.max(FRAME_W / sw, FRAME_H / sh) : Math.min(FRAME_W / sw, FRAME_H / sh);
  const w = (sw * scale) / FRAME_W;
  const h = (sh * scale) / FRAME_H;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Maps a normalised point in the source video into normalised frame coordinates. */
export function sourcePointToFrame(p: Point, fit: FitMode, sw: number, sh: number): Point {
  const r = sourceRect(fit, sw, sh);
  return { x: clamp(r.x + p.x * r.w, 0, 1), y: clamp(r.y + p.y * r.h, 0, 1) };
}

export function viewportFor(scale: number, focus: Point): Viewport {
  const s = Math.max(1, scale);
  const w = 1 / s;
  return { scale: s, x: clamp(focus.x - w / 2, 0, 1 - w), y: clamp(focus.y - w / 2, 0, 1 - w) };
}

/** Viewport of a segment at timeline time `t`. Shared by preview and renderer. */
export function viewportAt(
  seg: Pick<Segment, 'startTime' | 'endTime' | 'scaleStart' | 'scaleEnd' | 'positionStart' | 'positionEnd' | 'ease'>,
  t: number,
): Viewport {
  const dur = Math.max(1e-6, seg.endTime - seg.startTime);
  const p = ease(seg.ease ?? 'inOut', (t - seg.startTime) / dur);
  return viewportFor(lerp(seg.scaleStart, seg.scaleEnd, p), {
    x: lerp(seg.positionStart.x, seg.positionEnd.x, p),
    y: lerp(seg.positionStart.y, seg.positionEnd.y, p),
  });
}

/**
 * Where on screen the interesting UI is during a source window: the
 * energy-weighted centroid of pixel changes. Falls back to a slightly-high
 * centre, where most app content lives.
 */
export function activityFocus(activity: ClipActivity | undefined, from: number, to: number): Point | null {
  if (!activity || !activity.energy.length) return null;
  const a = Math.max(0, Math.floor(from * activity.sampleRate));
  const b = Math.min(activity.energy.length, Math.ceil(to * activity.sampleRate));
  let wx = 0;
  let wy = 0;
  let ws = 0;
  for (let i = a; i < b; i++) {
    const c = activity.centroid[i];
    const e = activity.energy[i];
    if (!c || e < 0.004) continue;
    wx += c.x * e;
    wy += c.y * e;
    ws += e;
  }
  if (ws <= 0) return null;
  return { x: wx / ws, y: wy / ws };
}

/** Mean activity energy in a source window. */
export function activityLevel(activity: ClipActivity | undefined, from: number, to: number): number {
  if (!activity || !activity.energy.length) return 0;
  const a = Math.max(0, Math.floor(from * activity.sampleRate));
  const b = Math.min(activity.energy.length, Math.ceil(to * activity.sampleRate));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += activity.energy[i];
  return s / (b - a);
}

/** True when two consecutive segments look identical at the cut (same source, continuous, same framing). */
export function isSeamless(a: Segment, b: Segment): boolean {
  return (
    a.sourceClip === b.sourceClip &&
    Math.abs(a.sourceEnd - b.sourceStart) < 0.05 &&
    Math.abs(a.scaleEnd - b.scaleStart) < 0.005 &&
    Math.abs(a.positionEnd.x - b.positionStart.x) < 0.01 &&
    Math.abs(a.positionEnd.y - b.positionStart.y) < 0.01
  );
}
