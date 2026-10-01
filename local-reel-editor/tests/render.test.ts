import { describe, expect, it } from 'vitest';
import { planMontage } from '../src/core/planner/MontagePlanner';
import { buildRenderPlan, segmentFrames } from '../src/core/render/RenderPlan';
import { createProject, DEFAULT_CAPTION_STYLE } from '../src/core/model/defaults';
import { viewportAt } from '../src/core/motion/MotionEngine';
import { DEMO_CLIPS, DEMO_TEXT, SFX_LIB, wordsFrom } from './fixtures';

function project() {
  const words = wordsFrom(DEMO_TEXT);
  const duration = words[words.length - 1].end + 0.5;
  const p = createProject('t');
  p.voice = { path: '/v.wav', name: 'v.wav', probe: { durationSec: duration, hasAudio: true, hasVideo: false, channels: 1 } };
  p.clips = DEMO_CLIPS;
  p.transcript = { language: 'ru', text: DEMO_TEXT, words, model: 't', createdAt: '' };
  p.timeline = planMontage({ transcript: p.transcript, clips: p.clips, duration, style: 'dynamic', variation: 0, captionStyle: DEFAULT_CAPTION_STYLE, sfxLibrary: SFX_LIB }).timeline;
  return p;
}

describe('RenderPlan', () => {
  it('frame ranges tile the timeline exactly', () => {
    const p = project();
    const fps = 30;
    let expected = 0;
    for (const s of p.timeline!.segments) {
      const f = segmentFrames(s, fps);
      expect(f.start).toBe(expected);
      expected += f.count;
    }
    expect(expected).toBe(Math.round(p.timeline!.duration * fps));
  });

  it('builds one job per shot plus the final mix, never touching originals', () => {
    const p = project();
    const jobs = buildRenderPlan(p, { outputPath: '/out/reel.mp4', sfxRoot: '/sfx', fontsDir: 'fonts' });
    expect(jobs.length).toBe(p.timeline!.segments.length + 1);
    for (const j of jobs.slice(0, -1)) expect(j.output).toMatch(/^seg_\d+\.mp4$/);
    const final = jobs[jobs.length - 1];
    expect(final.args).toContain('/out/reel.mp4');
    expect(final.files['graph.txt']).toContain('ass=captions.ass');
    expect(final.files['graph.txt']).toContain('pan=stereo|c0=c0|c1=c0');
    expect(final.args.join(' ')).toContain('-c:a aac');
    for (const c of DEMO_CLIPS) expect(jobs.every((j) => j.output !== c.path)).toBe(true);
  });

  it('viewport stays inside the frame', () => {
    for (const s of project().timeline!.segments) {
      for (const t of [s.startTime, (s.startTime + s.endTime) / 2, s.endTime]) {
        const v = viewportAt(s, t);
        expect(v.x).toBeGreaterThanOrEqual(0);
        expect(v.y).toBeGreaterThanOrEqual(0);
        expect(v.x + 1 / v.scale).toBeLessThanOrEqual(1 + 1e-9);
        expect(v.y + 1 / v.scale).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
