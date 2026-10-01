import { describe, expect, it } from 'vitest';
import { planMontage, type PlannerInput } from '../src/core/planner/MontagePlanner';
import { DEFAULT_CAPTION_STYLE } from '../src/core/model/defaults';
import { segmentsCoverDuration } from '../src/core/qa/QualityChecker';
import { DEMO_CLIPS, DEMO_TEXT, SFX_LIB, wordsFrom } from './fixtures';
import type { EditingStyle } from '../src/core/model/types';

function input(style: EditingStyle = 'dynamic', variation = 0): PlannerInput {
  const words = wordsFrom(DEMO_TEXT);
  const duration = words[words.length - 1].end + 0.5;
  return {
    transcript: { language: 'ru', text: DEMO_TEXT, words, model: 'test', createdAt: '' },
    clips: DEMO_CLIPS,
    duration,
    style,
    variation,
    captionStyle: DEFAULT_CAPTION_STYLE,
    sfxLibrary: SFX_LIB,
  };
}

const label = (id: string) => DEMO_CLIPS.find((c) => c.id === id)!.label;

describe('MontagePlanner', () => {
  it('maps speech topics to the right clips', () => {
    const { timeline } = planMontage(input());
    const order = timeline.sections.map((s) => label(s.clipId));
    expect(order).toEqual(['главный экран', 'создание задачи', 'статистика', 'профиль', 'настройки', 'календарь']);
  });

  it('covers the whole voice-over with no gaps', () => {
    const inp = input();
    const { timeline } = planMontage(inp);
    expect(segmentsCoverDuration(timeline.segments, inp.duration)).toBe(true);
    expect(timeline.duration).toBeCloseTo(inp.duration, 2);
  });

  it('is deterministic and supports variations', () => {
    const a = planMontage(input()).timeline;
    const b = planMontage(input()).timeline;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const v = planMontage(input('dynamic', 1)).timeline;
    expect(JSON.stringify(v.segments)).not.toBe(JSON.stringify(a.segments));
    // A variation keeps the story (same clip per topic).
    expect(v.sections.map((s) => s.clipId)).toEqual(a.sections.map((s) => s.clipId));
  });

  it('respects the editing style rhythm', () => {
    const avg = (style: EditingStyle) => {
      const t = planMontage(input(style)).timeline;
      return t.duration / t.segments.length;
    };
    expect(avg('fast')).toBeLessThan(avg('dynamic'));
    expect(avg('dynamic')).toBeLessThan(avg('minimal'));
    expect(avg('dynamic')).toBeGreaterThanOrEqual(1);
    expect(avg('dynamic')).toBeLessThanOrEqual(5);
  });

  it('keeps zoom gentle and never underfills the frame', () => {
    for (const style of ['minimal', 'dynamic', 'fast'] as const) {
      for (const s of planMontage(input(style)).timeline.segments) {
        for (const z of [s.scaleStart, s.scaleEnd]) {
          expect(z).toBeGreaterThanOrEqual(1);
          expect(z).toBeLessThanOrEqual(1.17);
        }
      }
    }
  });

  it('uses a soft transition at every topic change', () => {
    const t = planMontage(input()).timeline;
    for (let i = 0; i < t.segments.length - 1; i++) {
      const a = t.segments[i];
      const b = t.segments[i + 1];
      if (a.sectionId !== b.sectionId) {
        expect(a.transitionOut.kind).not.toBe('cut');
        expect(a.transitionOut).toEqual(b.transitionIn);
      }
    }
    // Eye-catching moves (slides / zoom) are spaced out.
    const big = t.segments.filter((s) => ['slide-left', 'slide-up', 'zoom'].includes(s.transitionOut.kind));
    for (let i = 1; i < big.length; i++) expect(big[i].endTime - big[i - 1].endTime).toBeGreaterThanOrEqual(5);
  });

  it('keeps camera motion continuous inside a topic (no zoom or speed jumps)', () => {
    const slope = (kind: string | undefined, at: 0 | 1) => {
      if (kind === 'linear') return 1;
      if (kind === 'in') return at === 1 ? Math.PI / 2 : 0;
      if (kind === 'out') return at === 0 ? Math.PI / 2 : 0;
      return 0; // inOut
    };
    for (const style of ['minimal', 'dynamic', 'fast'] as const) {
      const segs = planMontage(input(style)).timeline.segments;
      for (let i = 0; i < segs.length - 1; i++) {
        const a = segs[i];
        const b = segs[i + 1];
        if (a.sectionId !== b.sectionId) continue;
        expect(b.scaleStart).toBeCloseTo(a.scaleEnd, 3);
        expect(b.positionStart.x).toBeCloseTo(a.positionEnd.x, 3);
        const va = ((a.scaleEnd - a.scaleStart) * slope(a.ease, 1)) / (a.endTime - a.startTime);
        const vb = ((b.scaleEnd - b.scaleStart) * slope(b.ease, 0)) / (b.endTime - b.startTime);
        expect(Math.abs(va - vb)).toBeLessThan(0.002);
      }
    }
  });

  it('places sparse, quiet SFX without immediate repeats', () => {
    const t = planMontage(input()).timeline;
    expect(t.sfx.length).toBeGreaterThan(0);
    expect(t.sfx.length).toBeLessThan(t.duration / 2);
    for (let i = 0; i < t.sfx.length; i++) {
      expect(t.sfx[i].gainDb).toBeLessThanOrEqual(-14);
      expect(t.sfx[i].gainDb).toBeGreaterThanOrEqual(-22);
      if (i > 0) {
        expect(t.sfx[i].file).not.toBe(t.sfx[i - 1].file);
        expect(t.sfx[i].time - t.sfx[i - 1].time).toBeGreaterThanOrEqual(2.2);
      }
    }
  });

  it('honours user clip choices', () => {
    const inp = input();
    inp.phraseOverrides = { '0': 'c_stats' };
    const t = planMontage(inp).timeline;
    expect(t.sections[0].clipId).toBe('c_stats');
    expect(t.sections[0].needsReview).toBe(false);
  });

  it('flags weak matches for review instead of failing', () => {
    const inp = input();
    const words = wordsFrom('Привет друзья. Это очень круто. Попробуйте обязательно!');
    inp.transcript = { ...inp.transcript, text: 'x', words };
    inp.duration = words[words.length - 1].end + 0.3;
    const { timeline } = planMontage(inp);
    expect(timeline.segments.length).toBeGreaterThan(0);
    expect(timeline.sections.some((s) => s.needsReview)).toBe(true);
  });

  it('runs QA without errors on a normal project', () => {
    const { qa } = planMontage(input());
    expect(qa.filter((q) => q.severity === 'error')).toEqual([]);
  });
});
