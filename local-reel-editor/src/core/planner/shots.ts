import type { ClipAsset, Point, Section, Segment, Word } from '../model/types';
import type { StylePreset } from './presets';
import { CUT_LEAD } from './presets';
import { activityFocus, activityLevel, sourcePointToFrame } from '../motion/MotionEngine';
import { clamp, round3 } from '../util/math';
import { seededId } from '../util/id';
import type { Rng } from '../util/rng';

const DEFAULT_FOCUS: Point = { x: 0.5, y: 0.46 };
const CUT: Segment['transitionIn'] = { kind: 'cut', duration: 0 };

/** Candidate cut times inside a section: just before words, preferring pauses. */
function cutCandidates(words: Word[], from: number, to: number): { t: number; weight: number }[] {
  const out: { t: number; weight: number }[] = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w.start <= from + 0.3 || w.start >= to - 0.3) continue;
    const gap = w.start - words[i - 1].end;
    out.push({ t: Math.max(words[i - 1].end, w.start - CUT_LEAD), weight: 1 + Math.min(gap, 0.6) * 4 });
  }
  return out;
}

/** Splits a section into shot boundaries close to the preset rhythm, snapped to speech. */
export function shotBoundaries(section: Section, words: Word[], preset: StylePreset, rng: Rng): number[] {
  const L = section.end - section.start;
  const maxN = Math.max(1, Math.floor(L / preset.shotMin));
  const minN = Math.max(1, Math.ceil(L / preset.shotMax));
  const jitter = rng.range(0.85, 1.15);
  const n = clamp(Math.round(L / (preset.shotTarget * jitter)), minN, maxN);
  const candidates = cutCandidates(words, section.start, section.end);
  const bounds = [section.start];
  for (let k = 1; k < n; k++) {
    const ideal = section.start + (L * k) / n;
    const prev = bounds[bounds.length - 1];
    let best = ideal;
    let bestCost = Infinity;
    for (const c of candidates) {
      if (c.t - prev < preset.shotMin * 0.8 || section.end - c.t < preset.shotMin * 0.8) continue;
      const cost = Math.abs(c.t - ideal) / c.weight;
      if (cost < bestCost && Math.abs(c.t - ideal) < 0.8) {
        bestCost = cost;
        best = c.t;
      }
    }
    if (best - prev >= preset.shotMin * 0.8 && section.end - best >= preset.shotMin * 0.8) bounds.push(best);
  }
  bounds.push(section.end);
  return bounds;
}

interface SourcePlan {
  starts: number[];
  speed: number;
  jumps: boolean[];
  consumedTo: number;
}

/**
 * Decides which part of the source each shot plays. Long clips are shown
 * with forward jump cuts (aligned to detected UI actions); short clips are
 * played continuously, slightly slowed, and held on the last frame if needed.
 */
export function planSource(clip: ClipAsset, cursor: number, durations: number[], preset: StylePreset): SourcePlan {
  const D = Math.max(0.1, clip.probe.durationSec);
  const L = durations.reduce((a, b) => a + b, 0);
  let c = cursor;
  if (D - c < Math.min(L * 0.8, D * 0.5)) c = 0; // not enough left: start over
  const A = D - c;
  const n = durations.length;

  if (A >= L * 1.3 && n > 1) {
    const S = Math.min(A, L * preset.jumpFactor);
    const gap = (S - L) / (n - 1);
    const starts: number[] = [];
    let pos = c;
    for (let k = 0; k < n; k++) {
      let s = pos;
      if (k > 0) {
        // Snap the jump so a UI action happens ~0.35 s into the shot.
        const events = clip.activity?.uiEvents ?? [];
        const ev = events.find((e) => e - 0.35 >= s - gap * 0.6 && e - 0.35 <= s + gap * 0.4);
        if (ev !== undefined) s = Math.max(starts[k - 1] + durations[k - 1], ev - 0.35);
      }
      s = Math.min(s, D - durations[k]);
      starts.push(round3(Math.max(0, s)));
      pos = s + durations[k] + gap;
    }
    return { starts, speed: 1, jumps: starts.map((_, k) => k > 0), consumedTo: Math.min(D, pos - gap) };
  }

  // Continuous playback. Slow down a little (never below 0.8×) if the clip is short.
  const speed = A >= L ? 1 : clamp(A / L, 0.8, 1);
  const starts: number[] = [];
  let pos = c;
  for (const d of durations) {
    starts.push(round3(Math.min(pos, D)));
    pos += d * speed;
  }
  return { starts, speed, jumps: starts.map(() => false), consumedTo: Math.min(D, pos) };
}

function focusFor(clip: ClipAsset, from: number, to: number): Point {
  const f = activityFocus(clip.activity, from, to);
  if (!f || !clip.probe.width || !clip.probe.height) return DEFAULT_FOCUS;
  const p = sourcePointToFrame(f, clip.fitMode, clip.probe.width, clip.probe.height);
  // Pull the focus a bit towards the centre so punch-ins stay gentle.
  return { x: round3(0.5 + (p.x - 0.5) * 0.7), y: round3(0.47 + (p.y - 0.47) * 0.7) };
}

/** Builds the shots for one section, including zoom/position motion. */
export function planSectionShots(
  section: Section,
  sectionIndex: number,
  clip: ClipAsset,
  words: Word[],
  cursor: number,
  preset: StylePreset,
  rng: Rng,
  seed: number,
  firstSegmentIndex: number,
): { segments: Segment[]; cursor: number } {
  const bounds = shotBoundaries(section, words, preset, rng);
  const durations = bounds.slice(1).map((b, i) => b - bounds[i]);
  const src = planSource(clip, cursor, durations, preset);
  const D = clip.probe.durationSec;

  const segments: Segment[] = [];
  let scale = 1;
  let focus: Point = DEFAULT_FOCUS;
  let staticFor = 0;
  for (let k = 0; k < durations.length; k++) {
    const d = durations[k];
    const sourceStart = src.starts[k];
    const sourceEnd = round3(Math.min(D, sourceStart + d * src.speed));
    const target = focusFor(clip, sourceStart, sourceEnd);
    const busy = activityLevel(clip.activity, sourceStart, sourceEnd);

    let scaleStart = scale;
    let scaleEnd = scale;
    let posStart = focus;
    let posEnd = focus;

    const punch = () => round3(clamp(rng.range(1.07, preset.zoomMax), 1.04, 1.15));
    const wantsMotion = rng.chance(preset.motionChance) || staticFor + d > preset.maxStatic;

    if (k === 0) {
      // New topic: open wide, or (sometimes) open slightly punched on the action.
      if (sectionIndex > 0 && rng.chance(0.25) && busy > 0.01) {
        scaleStart = scaleEnd = punch();
        posStart = posEnd = target;
      } else {
        scaleStart = 1;
        scaleEnd = wantsMotion ? round3(rng.range(1.03, 1.06)) : 1;
        posStart = DEFAULT_FOCUS;
        posEnd = wantsMotion ? target : DEFAULT_FOCUS;
      }
    } else if (src.jumps[k]) {
      // Jump cut: change framing at the cut so the jump reads as intentional.
      if (scale > 1.03) {
        scaleStart = 1;
        scaleEnd = wantsMotion ? round3(rng.range(1.02, 1.05)) : 1;
        posStart = posEnd = target;
      } else {
        scaleStart = punch();
        scaleEnd = wantsMotion ? round3(Math.min(preset.zoomMax + 0.02, scaleStart + 0.02)) : scaleStart;
        posStart = posEnd = target;
      }
    } else if (wantsMotion) {
      // Continuous footage: keep the screen alive with a smooth move.
      if (scale < 1.04) {
        scaleEnd = punch(); // smooth punch-in
        posEnd = target;
      } else if (rng.chance(0.5)) {
        scaleEnd = round3(Math.min(preset.zoomMax + 0.02, scale + 0.02)); // slight reposition / focus
        posEnd = target;
      } else {
        scaleEnd = 1; // ease back out
        posEnd = DEFAULT_FOCUS;
      }
    }

    const moving = Math.abs(scaleEnd - scaleStart) > 0.005 || Math.hypot(posEnd.x - posStart.x, posEnd.y - posStart.y) > 0.02;
    const changedAtCut = k === 0 || src.jumps[k] || Math.abs(scaleStart - scale) > 0.005;
    staticFor = moving ? 0 : changedAtCut ? d : staticFor + d;

    segments.push({
      id: seededId('seg', firstSegmentIndex + k, seed),
      startTime: round3(bounds[k]),
      endTime: round3(bounds[k + 1]),
      transcript: words
        .filter((w) => w.start >= bounds[k] - 0.01 && w.start < bounds[k + 1])
        .map((w) => w.text.trim())
        .join(' '),
      sourceClip: clip.id,
      sourceStart,
      sourceEnd,
      scaleStart,
      scaleEnd,
      positionStart: posStart,
      positionEnd: posEnd,
      transitionIn: CUT,
      transitionOut: CUT,
      sfx: [],
      confidence: round3(section.confidence),
      sectionId: section.id,
      candidates: section.candidates,
      speed: round3(src.speed),
    });
    scale = scaleEnd;
    focus = posEnd;
  }
  return { segments, cursor: src.consumedTo };
}
