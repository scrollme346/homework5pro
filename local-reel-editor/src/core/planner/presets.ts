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
  /** Max zoom used for punch-ins. */
  zoomMax: number;
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
    zoomMax: 1.08,
    transitionChance: 0.3,
    transitionMinGap: 6,
    clickChance: 0.25,
    popChance: 0.15,
    sfxMinGap: 4,
    jumpFactor: 1.25,
    allowImpact: false,
  },
  dynamic: {
    shotMin: 1.1,
    shotTarget: 2.1,
    shotMax: 3.2,
    maxStatic: 3.5,
    motionChance: 0.55,
    zoomMax: 1.12,
    transitionChance: 0.25,
    transitionMinGap: 4.5,
    clickChance: 0.45,
    popChance: 0.3,
    sfxMinGap: 2.4,
    jumpFactor: 1.8,
    allowImpact: true,
  },
  fast: {
    shotMin: 0.8,
    shotTarget: 1.4,
    shotMax: 2.2,
    maxStatic: 2.5,
    motionChance: 0.65,
    zoomMax: 1.15,
    transitionChance: 0.3,
    transitionMinGap: 3.5,
    clickChance: 0.55,
    popChance: 0.35,
    sfxMinGap: 1.8,
    jumpFactor: 2.4,
    allowImpact: true,
  },
};

export const PLANNER_VERSION = 1;
/** Sections with lower confidence are flagged for the "Which clip?" prompt. */
export const REVIEW_THRESHOLD = 0.45;
/** Cut lands slightly before the first word of the next phrase. */
export const CUT_LEAD = 0.08;
