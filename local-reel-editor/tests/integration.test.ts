/**
 * Real FFmpeg integration: import → plan → export, then measure the file.
 * Uses the espeak test set (scripts/make-test-media.ts); skipped when
 * ffmpeg or espeak-ng are not installed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Studio } from '../src/engine/Studio';
import { parseSidecarResult } from '../src/engine/transcription/TranscriptionEngine';
import { setTransition } from '../src/core/edit/ops';
import { CAPTION_Y } from '../src/core/captions/CaptionEngine';
import type { Project } from '../src/core/model/types';

const root = resolve(__dirname, '..');
const tmp = join(root, 'tests', '.tmp');
const media = join(tmp, 'media');
const has = (bin: string) => spawnSync(bin, ['-version']).status === 0 || spawnSync(bin, ['--version']).status === 0;
const enabled = has('ffmpeg') && has('ffprobe') && (existsSync(join(media, 'voice.wav')) || has('espeak-ng'));

function grayFrame(file: string, t: number): { w: number; h: number; px: Buffer } {
  const w = 270;
  const h = 480;
  const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', 'pipe:1']);
  return { w, h, px };
}

/** Fraction of near-white pixels in the caption band (captions are white with a dark stroke). */
function captionInk(file: string, t: number, y: number): number {
  const { w, h, px } = grayFrame(file, t);
  const cy = Math.round((y / 1920) * h);
  let white = 0;
  let n = 0;
  for (let yy = cy - 12; yy <= cy + 12; yy++) for (let x = 20; x < w - 20; x++) {
    n++;
    if (px[yy * w + x] > 235) white++;
  }
  return white / n;
}

function maxVolume(file: string): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  return Number(/max_volume: (-?[\d.]+) dB/.exec(r.stderr.toString())![1]);
}

describe.skipIf(!enabled)('render integration (real FFmpeg)', () => {
  const studio = new Studio({
    dataDir: join(tmp, 'it-data'),
    projectsDir: join(tmp, 'it-projects'),
    assetsDir: join(root, 'assets'),
    transcribeScript: join(root, 'python', 'transcribe.py'),
  });
  let dir = '';
  let project: Project;
  const out = join(tmp, 'out', 'it-reel.mp4');

  beforeAll(async () => {
    if (!existsSync(join(media, 'voice.wav'))) execFileSync('npx', ['tsx', 'scripts/make-test-media.ts', media], { cwd: root });
    rmSync(join(tmp, 'it-projects'), { recursive: true, force: true });
    const c = await studio.projects.create('it');
    dir = c.dir;
    project = { ...c.project, render: { ...c.project.render, quality: 'fast' } };
    project = await studio.setVoice(dir, project, join(media, 'voice.wav'));
    const clips = readdirSync(join(media, 'clips')).map((f) => join(media, 'clips', f));
    project = (await studio.addClips(dir, project, clips)).project;
    const fx = JSON.parse(readFileSync(join(media, 'transcript.json'), 'utf8'));
    project = await studio.setTranscript(dir, project, parseSidecarResult(fx, 'fixture'));
    project = (await studio.generate(dir, project)).project;
    // Force one of every transition type so all xfade paths are rendered.
    const segs = project.timeline!.segments;
    const kinds = ['dissolve', 'slide-left', 'slide-up', 'zoom'] as const;
    let k = 0;
    for (let i = 1; i < segs.length - 1 && k < kinds.length; i += 3) project = setTransition(project, segs[i].id, kinds[k++]);
  }, 300_000);

  it('cancels cleanly without leaving files', async () => {
    const ctrl = new AbortController();
    const cancelOut = join(tmp, 'out', 'cancelled.mp4');
    setTimeout(() => ctrl.abort(), 1500);
    await expect(studio.export(dir, project, cancelOut, () => undefined, ctrl.signal)).rejects.toThrow(/отменен/i);
    expect(existsSync(cancelOut)).toBe(false);
    expect(existsSync(cancelOut.replace('.mp4', '.partial.mp4'))).toBe(false);
    expect(readdirSync(join(dir, 'renders')).filter((f) => f.startsWith('.render-'))).toEqual([]);
  }, 120_000);

  it('exports a 1080×1920 H.264/AAC reel matching the voice exactly', async () => {
    const used = project.timeline!.segments.filter((s) => s.transitionOut.kind !== 'cut').map((s) => s.transitionOut.kind);
    for (const k of ['dissolve', 'slide-left', 'slide-up', 'zoom']) expect(used).toContain(k);
    let last = 0;
    await studio
      .export(dir, project, out, (p) => {
        expect(p.fraction).toBeGreaterThanOrEqual(last - 1e-9);
        last = p.fraction;
      })
      .catch((e) => {
        throw new Error(`${e.message}\n${e.details ?? ''}`);
      });
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', out]).toString());
    const v = info.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    const a = info.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
    expect([v.codec_name, v.width, v.height, v.r_frame_rate]).toEqual(['h264', 1080, 1920, '30/1']);
    expect(a.codec_name).toBe('aac');
    const voiceDur = project.voice!.probe.durationSec;
    expect(Number(v.nb_read_frames)).toBe(Math.round(voiceDur * 30));
    expect(Math.abs(Number(info.format.duration) - voiceDur)).toBeLessThan(0.05);
  }, 300_000);

  it('shows each caption when its word is spoken', () => {
    const y = CAPTION_Y[project.captionStyle.position];
    expect(captionInk(out, 0.1, y)).toBeLessThan(0.002); // before the first word
    const words = project.transcript!.words;
    for (const i of [0, 7, 20, 40]) {
      expect(captionInk(out, words[i].start + 0.2, y)).toBeGreaterThan(0.01);
    }
  });

  it('keeps the voice at its level with quiet SFX and no clipping', () => {
    const inPeak = maxVolume(join(media, 'voice.wav'));
    const outPeak = maxVolume(out);
    expect(outPeak).toBeLessThanOrEqual(0);
    expect(Math.abs(outPeak - inPeak)).toBeLessThan(1.5);
  });

  it('never modifies the original media', () => {
    const before = readdirSync(join(media, 'clips')).length;
    expect(before).toBe(6);
    for (const c of project.clips) expect(c.proxy!.startsWith(dir)).toBe(true);
  });
});
