/**
 * Project model — the single source of truth for a Reel.
 *
 * The UI edits this model, the preview reads it, and the FFmpeg renderer
 * compiles it into commands. Nothing here knows about FFmpeg strings.
 * All times are in seconds on the master (voice-over) timeline unless a
 * field name says `source*`, in which case it is a time inside a clip file.
 */

export const PROJECT_FORMAT_VERSION = 1;

export type EditingStyle = 'minimal' | 'dynamic' | 'fast';
export type CaptionPosition = 'center' | 'lower-center' | 'upper-center';
export type TransitionKind = 'cut' | 'dissolve' | 'slide-left' | 'slide-up' | 'zoom';
export type SfxCategory = 'click' | 'pop' | 'whoosh' | 'impact';
export type FitMode = 'cover' | 'blur-fit';
/** Easing of a segment's camera move. Chained moves use in → linear → out so speed never jumps. */
export type Ease = 'inOut' | 'in' | 'out' | 'linear';
export type ExportQuality = 'fast' | 'high';
export type WhisperModelSize = 'fast' | 'balanced' | 'accurate';

/** Normalised focus point inside the 9:16 frame, 0..1 on each axis. */
export interface Point {
  x: number;
  y: number;
}

export interface MediaProbe {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** Per-clip motion analysis used to pick cut points, zoom focus and SFX. */
export interface ClipActivity {
  /** Sample rate of the arrays below (samples per second of source). */
  sampleRate: number;
  /** Frame-difference energy 0..1 per sample. */
  energy: number[];
  /** Centroid of change per sample (normalised in source frame), null when nothing moved. */
  centroid: (Point | null)[];
  /** Source times (sec) where the screen changes a lot (screen transitions). */
  sceneChanges: number[];
  /** Source times (sec) of short, localised changes (taps, toggles, popups). */
  uiEvents: number[];
}

export interface VoiceTrack {
  path: string;
  name: string;
  probe: MediaProbe;
  /** Normalised peaks for waveform display (~100 per second). */
  peaks?: number[];
  peaksPerSecond?: number;
  /** Peak level in dBFS, from analysis. */
  peakDb?: number;
  meanDb?: number;
}

export interface ClipAsset {
  id: string;
  path: string;
  /** Original file name without extension. */
  fileLabel: string;
  /** Semantic label used for matching; user-editable, defaults to fileLabel. */
  label: string;
  probe: MediaProbe;
  thumbnail?: string;
  proxy?: string;
  activity?: ClipActivity;
  fitMode: FitMode;
}

export interface Word {
  text: string;
  start: number;
  end: number;
  probability?: number;
}

export interface Transcript {
  language: string;
  text: string;
  words: Word[];
  model: string;
  createdAt: string;
}

export interface Transition {
  kind: TransitionKind;
  /** Duration in seconds; ignored for 'cut'. */
  duration: number;
}

export interface SfxEvent {
  id: string;
  category: SfxCategory;
  /** Path relative to the SFX library root, e.g. "whoosh/whoosh_soft_01.wav". */
  file: string;
  time: number;
  /** Gain relative to the voice track, in dB (negative). */
  gainDb: number;
  muted: boolean;
  reason: string;
}

export interface MatchCandidate {
  clipId: string;
  score: number;
}

export interface Segment {
  id: string;
  startTime: number;
  endTime: number;
  transcript: string;
  sourceClip: string;
  sourceStart: number;
  sourceEnd: number;
  scaleStart: number;
  scaleEnd: number;
  positionStart: Point;
  positionEnd: Point;
  transitionIn: Transition;
  transitionOut: Transition;
  /** IDs of SfxEvents that belong to this segment (informational). */
  sfx: string[];
  confidence: number;
  /** Story section this shot belongs to (one section ≈ one matched clip topic). */
  sectionId: string;
  /** Ranked clip suggestions for the section, used by the "Which clip?" prompt. */
  candidates: MatchCandidate[];
  /** True once the user resolved/confirmed a low-confidence match. */
  userConfirmed?: boolean;
  /** Playback speed of the source (1 = real time). Planner only slows long holds slightly. */
  speed: number;
  /** Easing of the zoom/pan move (default 'inOut'). */
  ease?: Ease;
}

export interface CaptionEvent {
  id: string;
  text: string;
  start: number;
  end: number;
  wordIndex: number;
  /** Font size after auto-fit for long words (px at 1080×1920). */
  fontSize?: number;
}

export interface CaptionStyle {
  position: CaptionPosition;
  fontSize: number;
  uppercase: boolean;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  shadow: number;
  animationMs: number;
}

export interface Section {
  id: string;
  start: number;
  end: number;
  text: string;
  clipId: string;
  confidence: number;
  candidates: MatchCandidate[];
  needsReview: boolean;
  /** Indices of transcript phrases covered by this section. */
  phraseIndices: number[];
}

export interface Timeline {
  duration: number;
  sections: Section[];
  segments: Segment[];
  captions: CaptionEvent[];
  sfx: SfxEvent[];
  generatedWith: { seed: number; variation: number; style: EditingStyle; plannerVersion: number };
}

export interface RenderSettings {
  width: 1080;
  height: 1920;
  fps: 30 | 60;
  quality: ExportQuality;
  hardwareAcceleration: boolean;
  sfxEnabled: boolean;
}

export interface QaIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  time?: number;
  autoFixed?: boolean;
}

export interface Project {
  format: 'local-reel-editor';
  version: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  voice?: VoiceTrack;
  clips: ClipAsset[];
  transcript?: Transcript;
  timeline?: Timeline;
  editingStyle: EditingStyle;
  variation: number;
  captionStyle: CaptionStyle;
  render: RenderSettings;
  qa: QaIssue[];
  /** User answers to "Which clip matches this section?" keyed by phrase index. */
  phraseOverrides: Record<string, string>;
  lastExport?: { path: string; at: string };
}
