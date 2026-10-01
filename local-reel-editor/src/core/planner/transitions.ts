import type { EditingStyle, Segment, Transition, TransitionKind } from '../model/types';
import type { StylePreset } from './presets';
import type { Rng } from '../util/rng';

export const TRANSITION_DURATION: Record<TransitionKind, number> = {
  cut: 0,
  dissolve: 0.3,
  'slide-left': 0.28,
  'slide-up': 0.28,
  zoom: 0.3,
};

export function makeTransition(kind: TransitionKind): Transition {
  return { kind, duration: TRANSITION_DURATION[kind] };
}

/**
 * Picks transitions. Default is a hard cut; only some topic changes get a
 * light dissolve/slide, spaced apart so transitions never feel busy.
 */
export function planTransitions(segments: Segment[], style: EditingStyle, preset: StylePreset, rng: Rng): void {
  let lastAt = -Infinity;
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i];
    const b = segments[i + 1];
    if (a.sectionId === b.sectionId) continue; // inside a topic: always cut
    const t = a.endTime;
    if (t - lastAt < preset.transitionMinGap) continue;
    if (!rng.chance(preset.transitionChance)) continue;
    const kind: TransitionKind =
      style === 'minimal'
        ? 'dissolve'
        : rng.pick<TransitionKind>(['dissolve', 'dissolve', 'slide-left', 'slide-left', 'slide-up', 'zoom']);
    const tr = makeTransition(kind);
    // Transition must fit comfortably inside both shots.
    if (a.endTime - a.startTime < tr.duration * 2.5 || b.endTime - b.startTime < tr.duration * 2.5) continue;
    a.transitionOut = tr;
    b.transitionIn = tr;
    lastAt = t;
  }
}
