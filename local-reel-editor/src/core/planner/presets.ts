import type { EditingStyle } from '../model/types';

export interface StylePreset {
  /** Target shot length range on the timeline, seconds. */
  shotMin: number;
  shotTarget: number;
  shotMax: number;
  /** Longest a frame may stay without any cut or motion. */
  maxStatic: number;
  /** Probability that a shot gets a punch-in / motion move. */
  motionChance: number;
  /** Range of the slow continuous zoom over a topic (e.g. 1.05 → 100–105%). */
  zoomMin: number;
  zoomMax: number;
  /** Duration of the soft dissolve used for jump cuts inside a topic (0 = hard cut). */
  softCut: number;
  /** Probability of a non-cut transition at a section (topic) change. */
  transitionChance: number;
  /** Minimum seconds between two non-cut transitions. */
  transitionMinGap: number;
  /** Probability of a click SFX on a detected UI action. */
  clickChance: number;
  /** Probability of a pop SFX on a section change without a transition. */
  popChance: number;
  /** Minimum seconds between any two SFX. */
  sfxMinGap: number;
  /** How much faster than real time the source may advance across jump cuts. */
  jumpFactor: number;
  allowImpact: boolean;
}

export const PRESETS: Record<EditingStyle, StylePreset> = {
  minimal: {
    shotMin: 2.2,
    shotTarget: 3.6,
    shotMax: 5.5,
    maxStatic: 5,
    motionChance: 0.35,
    zoomMin: 1.03,
    zoomMax: 1.05,
    softCut: 0.3,
    transitionChance: 1,
    transitionMinGap: 3,
    clickChance: 0.25,
    popChance: 0.15,
    sfxMinGap: 4,
    jumpFactor: 1.25,
    allowImpact: false,
  },
  dynamic: {
    shotMin: 1.8,
    shotTarget: 3.2,
    shotMax: 5,
    maxStatic: 3.5,
    motionChance: 0.55,
    zoomMin: 1.05,
    zoomMax: 1.09,
    softCut: 0.25,
    transitionChance: 1,
    transitionMinGap: 2.5,
    clickChance: 0.35,
    popChance: 0.15,
    sfxMinGap: 3,
    jumpFactor: 1.4,
    allowImpact: true,
  },
  fast: {
    shotMin: 1.1,
    shotTarget: 2,
    shotMax: 3,
    maxStatic: 2.5,
    motionChance: 0.65,
    zoomMin: 1.07,
    zoomMax: 1.12,
    softCut: 0.15,
    transitionChance: 1,
    transitionMinGap: 2,
    clickChance: 0.55,
    popChance: 0.35,
    sfxMinGap: 1.8,
    jumpFactor: 2.4,
    allowImpact: true,
  },
};

export const PLANNER_VERSION = 2;
/** Sections with lower confidence are flagged for the "Which clip?" prompt. */
export const REVIEW_THRESHOLD = 0.45;
/** Cut lands slightly before the first word of the next phrase. */
export const CUT_LEAD = 0.08;
