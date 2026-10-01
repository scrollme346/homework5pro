import { describe, expect, it } from 'vitest';
import { planMontage } from '../src/core/planner/MontagePlanner';
import { createProject, DEFAULT_CAPTION_STYLE } from '../src/core/model/defaults';
import { chooseSectionClip, moveCut, removeClip, renameClip, replaceClip, setSfxMuted, setTransition, setZoom, slipSource, swapSegments } from '../src/core/edit/ops';
import { segmentsCoverDuration } from '../src/core/qa/QualityChecker';
import { parseProject, serializeProject } from '../src/core/model/serialize';
import { DEMO_CLIPS, DEMO_TEXT, SFX_LIB, wordsFrom } from './fixtures';

function project() {
  const words = wordsFrom(DEMO_TEXT);
  const duration = words[words.length - 1].end + 0.5;
  const p = createProject('t');
  p.voice = { path: '/v.wav', name: 'v.wav', probe: { durationSec: duration, hasAudio: true, hasVideo: false } };
  p.clips = DEMO_CLIPS;
  p.transcript = { language: 'ru', text: DEMO_TEXT, words, model: 't', createdAt: '' };
  p.timeline = planMontage({ transcript: p.transcript, clips: p.clips, duration, style: 'dynamic', variation: 0, captionStyle: DEFAULT_CAPTION_STYLE, sfxLibrary: SFX_LIB }).timeline;
  return p;
}

describe('editor operations', () => {
  it('moveCut keeps coverage and does not mutate the original', () => {
    const p = project();
    const before = JSON.stringify(p);
    const s0 = p.timeline!.segments[0];
    const q = moveCut(p, s0.id, s0.endTime + 0.3);
    expect(JSON.stringify(p)).toBe(before);
    expect(q.timeline!.segments[0].endTime).toBeCloseTo(s0.endTime + 0.3, 3);
    expect(segmentsCoverDuration(q.timeline!.segments, p.timeline!.duration)).toBe(true);
  });

  it('moveCut clamps so no segment collapses', () => {
    const p = project();
    const s0 = p.timeline!.segments[0];
    const q = moveCut(p, s0.id, 999);
    const s1 = q.timeline!.segments[1];
    expect(s1.endTime - s1.startTime).toBeGreaterThanOrEqual(0.25 - 1e-6);
  });

  it('slip and replace keep the source inside the clip', () => {
    const p = project();
    const seg = p.timeline!.segments[1];
    const q = slipSource(p, seg.id, 1000);
    const s = q.timeline!.segments[1];
    const D = p.clips.find((c) => c.id === s.sourceClip)!.probe.durationSec;
    expect(s.sourceEnd).toBeLessThanOrEqual(D + 1e-6);
    const r = replaceClip(p, seg.id, 'c_prof');
    expect(r.timeline!.segments[1].sourceClip).toBe('c_prof');
    expect(r.timeline!.segments[1].userConfirmed).toBe(true);
  });

  it('swap moves content but keeps cut points', () => {
    const p = project();
    const [a, , c] = p.timeline!.segments;
    const q = swapSegments(p, a.id, c.id);
    expect(q.timeline!.segments[0].sourceClip).toBe(c.sourceClip);
    expect(q.timeline!.segments[0].startTime).toBe(a.startTime);
    expect(q.timeline!.segments[2].sourceClip).toBe(a.sourceClip);
  });

  it('transitions, zoom and sfx edits', () => {
    const p = project();
    const s = p.timeline!.segments[3];
    const q = setTransition(p, s.id, 'dissolve');
    expect(q.timeline!.segments[3].transitionOut.kind).toBe('dissolve');
    expect(q.timeline!.segments[4].transitionIn.kind).toBe('dissolve');
    const z = setZoom(p, s.id, 0.5, 3);
    expect(z.timeline!.segments[3].scaleStart).toBe(1);
    expect(z.timeline!.segments[3].scaleEnd).toBe(1.15);
    const e = p.timeline!.sfx[0];
    expect(setSfxMuted(p, e.id, true).timeline!.sfx[0].muted).toBe(true);
  });

  it('choosing a clip for a section is remembered for regeneration', () => {
    const p = project();
    const sec = p.timeline!.sections[0];
    const q = chooseSectionClip(p, sec.id, 'c_cal');
    for (const pi of sec.phraseIndices) expect(q.phraseOverrides[String(pi)]).toBe('c_cal');
    const re = planMontage({ transcript: q.transcript!, clips: q.clips, duration: q.timeline!.duration, style: 'dynamic', variation: 0, captionStyle: DEFAULT_CAPTION_STYLE, sfxLibrary: SFX_LIB, phraseOverrides: q.phraseOverrides });
    expect(re.timeline.sections[0].clipId).toBe('c_cal');
  });

  it('rename keeps the file label; remove drops dependent plan', () => {
    const p = project();
    expect(renameClip(p, 'c_home', 'Dashboard').clips[0].label).toBe('Dashboard');
    expect(renameClip(p, 'c_home', '  ').clips[0].label).toBe('главный экран');
    expect(removeClip(p, 'c_home').timeline).toBeUndefined();
  });

  it('project JSON round-trips without re-transcription', () => {
    const p = project();
    const back = parseProject(serializeProject(p));
    expect(back.transcript!.words.length).toBe(p.transcript!.words.length);
    expect(back.timeline!.segments.length).toBe(p.timeline!.segments.length);
    expect(() => parseProject('{"format":"other"}')).toThrow();
  });
});
