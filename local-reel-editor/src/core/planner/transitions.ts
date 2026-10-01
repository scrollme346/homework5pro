import type { EditingStyle, Segment, Transition, TransitionKind } from '../model/types';
import type { StylePreset } from './presets';
import type { Rng } from '../util/rng';

export const TRANSITION_DURATION: Record<TransitionKind, number> = {
  cut: 0,
  dissolve: 0.45,
  'slide-left': 0.5,
  'slide-up': 0.5,
  zoom: 0.45,
};

export function makeTransition(kind: TransitionKind, duration?: number): Transition {
  return { kind, duration: kind === 'cut' ? 0 : (duration ?? TRANSITION_DURATION[kind]) };
}

const fits = (a: Segment, b: Segment, d: number): boolean => a.endTime - a.startTime >= d * 1.5 && b.endTime - b.startTime >= d * 1.5;

/**
 * Smooth transitions:
 *  - every topic change gets a soft transition (mostly dissolves, some eased
 *    slides / zoom-throughs in Dynamic and Fast);
 *  - a jump inside a topic (cut to a later moment of the same recording)
 *    gets a short dissolve so it never reads as a glitch;
 *  - continuous footage between shots stays seamless (no transition needed).
 */
export function planTransitions(segments: Segment[], style: EditingStyle, preset: StylePreset, rng: Rng): void {
  let lastBig = -Infinity;
  let lastKind: TransitionKind = 'cut';
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i];
    const b = segments[i + 1];
    let tr: Transition | null = null;
    if (a.sectionId !== b.sectionId) {
      let kind: TransitionKind = 'dissolve';
      if (style !== 'minimal' && a.endTime - lastBig >= preset.transitionMinGap * 2) {
        const options: TransitionKind[] = ['slide-left', 'slide-left', 'zoom', 'slide-up'].filter((k) => k !== lastKind) as TransitionKind[];
        if (rng.chance(style === 'fast' ? 0.6 : 0.45)) kind = rng.pick(options);
      }
      tr = makeTransition(kind);
      if (!fits(a, b, tr.duration)) tr = makeTransition('dissolve', Math.min(0.3, (Math.min(a.endTime - a.startTime, b.endTime - b.startTime)) / 1.6));
      if (kind !== 'dissolve') {
        lastBig = a.endTime;
        lastKind = kind;
      }
    } else {
      const jump = a.sourceClip !== b.sourceClip || Math.abs(a.sourceEnd - b.sourceStart) > 0.05;
      if (jump && preset.softCut > 0) tr = makeTransition('dissolve', preset.softCut);
    }
    if (tr && tr.duration >= 0.1 && fits(a, b, tr.duration)) {
      a.transitionOut = tr;
      b.transitionIn = tr;
    }
  }
}
