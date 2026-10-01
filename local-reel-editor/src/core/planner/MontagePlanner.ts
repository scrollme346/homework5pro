import type { ClipAsset, EditingStyle, Project, QaIssue, Timeline, Transcript } from '../model/types';
import { PLANNER_VERSION, PRESETS } from './presets';
import { assignClips, buildSections } from './sections';
import { planSectionShots } from './shots';
import { planTransitions } from './transitions';
import { splitPhrases } from '../transcript/phrases';
import { attachSfxToSegments, planSfx, type SfxLibrary } from '../sfx/SfxPlanner';
import { buildCaptions, type MeasureText } from '../captions/CaptionEngine';
import { checkTimeline } from '../qa/QualityChecker';
import { Rng, hashString } from '../util/rng';
import type { CaptionStyle } from '../model/types';

export interface PlannerInput {
  transcript: Transcript;
  clips: ClipAsset[];
  duration: number;
  style: EditingStyle;
  variation: number;
  captionStyle: CaptionStyle;
  sfxLibrary: SfxLibrary;
  phraseOverrides?: Record<string, string>;
  measure?: MeasureText;
  /** Called as the planner moves through its steps (for the Generate screen). */
  onStage?: (stage: 'understanding' | 'story' | 'captions' | 'motion' | 'sound') => void;
}

export interface PlannerOutput {
  timeline: Timeline;
  qa: QaIssue[];
}

/** Seed depends only on inputs: same inputs → same edit. "Variation" changes it on purpose. */
export function plannerSeed(input: Pick<PlannerInput, 'transcript' | 'clips' | 'style' | 'variation' | 'duration'>): number {
  const key = [
    input.transcript.text,
    input.duration.toFixed(2),
    input.style,
    input.variation,
    // Labels + durations (not random ids) so re-importing the same files gives the same edit.
    ...input.clips.map((c) => `${c.label}:${c.probe.durationSec.toFixed(2)}`),
  ].join('|');
  return hashString(key);
}

/**
 * MontagePlanner: transcript + clips → timeline plan. Does not render.
 * Decides which clip plays when, which source range, zoom/motion,
 * transitions and SFX, then runs QA over the result.
 */
export function planMontage(input: PlannerInput): PlannerOutput {
  const preset = PRESETS[input.style];
  const seed = plannerSeed(input);
  const rng = new Rng(seed);
  const words = input.transcript.words;
  const clipMap = new Map(input.clips.map((c) => [c.id, c]));

  input.onStage?.('understanding');
  const phrases = splitPhrases(words);
  const assignments = assignClips(phrases, input.clips, input.phraseOverrides);
  let sections = buildSections(phrases, assignments, input.duration, seed);
  if (!sections.length && input.clips.length) {
    // Voice without recognised words: still produce a full-length edit.
    sections = [
      {
        id: 'sec_0',
        start: 0,
        end: input.duration,
        text: '',
        clipId: input.clips[0].id,
        confidence: 0,
        candidates: input.clips.map((c) => ({ clipId: c.id, score: 0 })),
        needsReview: true,
        phraseIndices: [],
      },
    ];
  }

  input.onStage?.('story');
  const cursors = new Map<string, number>();
  const segments = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const clip = clipMap.get(sec.clipId)!;
    const { segments: segs, cursor } = planSectionShots(sec, i, clip, words, cursors.get(clip.id) ?? 0, preset, rng, seed, segments.length);
    cursors.set(clip.id, cursor);
    segments.push(...segs);
  }

  input.onStage?.('motion');
  planTransitions(segments, input.style, preset, rng);
  input.onStage?.('sound');
  const sfx = planSfx(segments, sections, clipMap, input.sfxLibrary, preset, rng, seed, input.duration);
  attachSfxToSegments(segments, sfx);
  input.onStage?.('captions');
  const captions = buildCaptions(words, input.captionStyle, seed, input.measure);

  const timeline: Timeline = {
    duration: input.duration,
    sections,
    segments,
    captions,
    sfx,
    generatedWith: { seed, variation: input.variation, style: input.style, plannerVersion: PLANNER_VERSION },
  };
  const qa = checkTimeline(timeline, words, clipMap, input.duration, preset, input.captionStyle.position, input.measure);
  return { timeline, qa };
}

export function planProject(
  project: Project,
  sfxLibrary: SfxLibrary,
  measure?: MeasureText,
  onStage?: PlannerInput['onStage'],
): PlannerOutput {
  if (!project.voice) throw new Error('Сначала добавьте voice-over.');
  if (!project.transcript) throw new Error('Сначала нужна транскрипция голоса.');
  if (!project.clips.length) throw new Error('Добавьте хотя бы один видеоклип.');
  return planMontage({
    transcript: project.transcript,
    clips: project.clips,
    duration: project.voice.probe.durationSec,
    style: project.editingStyle,
    variation: project.variation,
    captionStyle: project.captionStyle,
    sfxLibrary,
    phraseOverrides: project.phraseOverrides,
    measure,
    onStage,
  });
}
