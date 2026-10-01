import type { ClipAsset, Ease, Project, Segment, TransitionKind } from '../model/types';
import { FRAME_H, FRAME_W } from '../motion/MotionEngine';
import { captionsToAss } from '../captions/CaptionEngine';

/**
 * Compiles the project model into FFmpeg jobs. Pure: it returns argument
 * arrays and file contents; the engine decides where and how to run them.
 * Paths of intermediate files are relative to the job's working directory.
 */

export interface FfmpegJob {
  id: string;
  /** Human-readable stage, shown in the UI instead of the command. */
  stage: string;
  args: string[];
  /** Files to write into the working directory before running. */
  files: Record<string, string>;
  /** Output duration in seconds, used to compute progress. */
  durationSec: number;
  /** Relative weight of this job in overall progress. */
  weight: number;
  output: string;
}

export interface RenderPlanOptions {
  /** Absolute path of the final MP4. */
  outputPath: string;
  /** Absolute path of the SFX library root. */
  sfxRoot: string;
  /** Use clip proxies instead of originals (draft renders). */
  useProxies?: boolean;
  /** Hardware H.264 encoder name, if enabled and verified (e.g. h264_videotoolbox). */
  hwEncoder?: string;
  /** Relative path (from the working dir) of the fonts directory. */
  fontsDir: string;
}

/** Eased transition progress 0→1 (xfade's P runs 1→0). Matches TRANSITION_EASE in the preview. */
const XE = '((1-cos(PI*(1-P)))/2)';

/** Samples plane-correct pixel of input `src` ('a' or 'b') at (x, y). */
const samp = (src: 'a' | 'b', x: string, y: string): string =>
  `if(eq(PLANE,0),${src}0(${x},${y}),if(eq(PLANE,1),${src}1(${x},${y}),${src}2(${x},${y})))`;

/**
 * xfade parameters per transition. Dissolve uses the fast built-in fade;
 * slides and the zoom-through use custom expressions with sine easing so
 * they start and land softly instead of moving at constant speed.
 */
export function xfadeTransition(kind: Exclude<TransitionKind, 'cut'>): string {
  switch (kind) {
    case 'slide-left':
      return `custom:expr='st(1,W*(1-${XE}));if(gte(X,ld(1)),${samp('b', 'X-ld(1)', 'Y')},${samp('a', 'X+W-ld(1)', 'Y')})'`;
    case 'slide-up':
      return `custom:expr='st(1,H*(1-${XE}));if(gte(Y,ld(1)),${samp('b', 'X', 'Y-ld(1)')},${samp('a', 'X', 'Y+H-ld(1)')})'`;
    case 'zoom':
      // A pushes in and fades out while B settles from 112% to 100%.
      return (
        `custom:expr='st(0,${XE});st(1,1+0.3*ld(0));st(2,1.12-0.12*ld(0));` +
        `${samp('a', 'W/2+(X-W/2)/ld(1)', 'H/2+(Y-H/2)/ld(1)')}*(1-ld(0))+${samp('b', 'W/2+(X-W/2)/ld(2)', 'H/2+(Y-H/2)/ld(2)')}*ld(0)'`
      );
    default:
      return 'fade';
  }
}

/** User SFX are stored as absolute paths; built-in ones relative to the library root. */
export const isAbsolutePath = (p: string): boolean => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');

const n4 = (v: number): string => (Math.round(v * 10000) / 10000).toString();

/** Global-frame-aligned frame range of a segment, so stitched durations add up exactly. */
export function segmentFrames(seg: Pick<Segment, 'startTime' | 'endTime'>, fps: number): { start: number; count: number } {
  const start = Math.round(seg.startTime * fps);
  const end = Math.round(seg.endTime * fps);
  return { start, count: Math.max(1, end - start) };
}

/** Same sine easings as the preview (util/math ease), as FFmpeg expressions of `p`. */
function easeExpr(kind: Ease, p: string): string {
  switch (kind) {
    case 'linear':
      return `(${p})`;
    case 'in':
      return `(1-cos(PI*(${p})/2))`;
    case 'out':
      return `sin(PI*(${p})/2)`;
    default:
      return `((1-cos(PI*(${p})))/2)`;
  }
}

function composeFilter(clip: ClipAsset): string {
  const cover = `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${FRAME_W}:${FRAME_H}`;
  if (clip.fitMode === 'cover') return cover;
  return (
    `split=2[bgsrc][fgsrc];` +
    `[bgsrc]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=14,eq=brightness=-0.06:saturation=1.1,scale=${FRAME_W}:${FRAME_H}[bg];` +
    `[fgsrc]scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2`
  );
}

/**
 * Zoom/pan for a segment. Static framing uses an exact crop; animated
 * framing uses zoompan on a 2× supersampled frame to avoid sub-pixel jitter.
 */
function motionFilter(seg: Segment, frames: number): string {
  const s0 = seg.scaleStart;
  const s1 = seg.scaleEnd;
  const p0 = seg.positionStart;
  const p1 = seg.positionEnd;
  const still = Math.abs(s1 - s0) < 1e-3 && Math.abs(p1.x - p0.x) < 1e-3 && Math.abs(p1.y - p0.y) < 1e-3;
  if (still) {
    if (s0 <= 1.0005) return '';
    const w = 1 / s0;
    const x = Math.min(Math.max(p0.x - w / 2, 0), 1 - w);
    const y = Math.min(Math.max(p0.y - w / 2, 0), 1 - w);
    return `,crop=w=iw*${n4(w)}:h=ih*${n4(w)}:x=iw*${n4(x)}:y=ih*${n4(y)},scale=${FRAME_W}:${FRAME_H}:flags=lanczos`;
  }
  const denom = Math.max(1, frames - 1);
  const p = `min(1,on/${denom})`;
  const e = easeExpr(seg.ease ?? 'inOut', p);
  const z = `${n4(s0)}+(${n4(s1 - s0)})*${e}`;
  const fx = `(${n4(p0.x)}+(${n4(p1.x - p0.x)})*${e})`;
  const fy = `(${n4(p0.y)}+(${n4(p1.y - p0.y)})*${e})`;
  const x = `iw*max(0,min(1-1/zoom,${fx}-0.5/zoom))`;
  const y = `ih*max(0,min(1-1/zoom,${fy}-0.5/zoom))`;
  return `,scale=${FRAME_W * 2}:${FRAME_H * 2}:flags=bicubic,zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${FRAME_W}x${FRAME_H}`;
}

function x264Args(quality: 'fast' | 'high' | 'intermediate', hwEncoder?: string): string[] {
  if (quality === 'intermediate') return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-g', '30', '-pix_fmt', 'yuv420p'];
  if (hwEncoder) {
    const common = ['-c:v', hwEncoder, '-pix_fmt', hwEncoder === 'h264_vaapi' ? 'vaapi' : 'yuv420p'];
    return [...common, '-b:v', quality === 'high' ? '16M' : '8M', '-maxrate', quality === 'high' ? '24M' : '12M', '-bufsize', '32M'];
  }
  return quality === 'high'
    ? ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
}

export function segmentFileName(index: number): string {
  return `seg_${String(index).padStart(4, '0')}.mp4`;
}

/** One job per segment: trim, retime, compose to 9:16, apply motion. */
export function buildSegmentJob(project: Project, seg: Segment, index: number, opts: RenderPlanOptions): FfmpegJob {
  const fps = project.render.fps;
  const clip = project.clips.find((c) => c.id === seg.sourceClip);
  if (!clip) throw new Error(`Клип для фрагмента ${index + 1} не найден.`);
  const { count } = segmentFrames(seg, fps);
  const tail = seg.transitionOut.kind === 'cut' ? 0 : Math.round(seg.transitionOut.duration * fps);
  const total = count + tail;
  const outDur = total / fps;
  const speed = seg.speed > 0 ? seg.speed : 1;
  const srcDur = Math.min(outDur * speed + 0.5, Math.max(0.05, clip.probe.durationSec - seg.sourceStart));
  const input = opts.useProxies && clip.proxy ? clip.proxy : clip.path;

  const filter =
    `[0:v]setpts=(PTS-STARTPTS)/${n4(speed)},fps=${fps},` +
    composeFilter(clip) +
    motionFilter(seg, count) +
    // Hold the last frame if the source runs out (never show black).
    `,tpad=stop_mode=clone:stop_duration=${n4(outDur + 1)},trim=end_frame=${total},setsar=1,format=yuv420p[v]`;

  const output = segmentFileName(index);
  return {
    id: `segment-${index}`,
    stage: 'Rendering shots',
    args: [
      '-hide_banner', '-y', '-nostdin',
      '-ss', n4(Math.max(0, seg.sourceStart)), '-t', n4(srcDur), '-i', input,
      '-filter_complex', filter, '-map', '[v]', '-an',
      '-frames:v', String(total), '-r', String(fps),
      ...x264Args('intermediate'),
      output,
    ],
    files: {},
    durationSec: outDur,
    weight: outDur * (seg.scaleStart !== seg.scaleEnd ? 2 : 1),
    output,
  };
}

/** Final job: stitch segments (cuts + xfades), burn captions, mix voice + SFX, encode. */
export function buildFinalJob(project: Project, opts: RenderPlanOptions): FfmpegJob {
  const tl = project.timeline;
  if (!tl || !tl.segments.length) throw new Error('Нет монтажного плана.');
  if (!project.voice) throw new Error('Нет voice-over.');
  const fps = project.render.fps;
  const segs = tl.segments;
  const totalFrames = Math.round(tl.duration * fps);
  const duration = totalFrames / fps;

  const args: string[] = ['-hide_banner', '-y', '-nostdin'];
  segs.forEach((_, i) => args.push('-i', segmentFileName(i)));
  const voiceIdx = segs.length;
  args.push('-i', project.voice.path);
  const sfx = project.render.sfxEnabled ? tl.sfx.filter((e) => !e.muted) : [];
  sfx.forEach((e) => args.push('-i', isAbsolutePath(e.file) ? e.file : `${opts.sfxRoot.replace(/[\\/]+$/, '')}/${e.file}`));

  const parts: string[] = [];
  // Normalise every shot to the same frame-indexed timebase so concat/xfade line up exactly.
  segs.forEach((_, i) => parts.push(`[${i}:v]settb=1/${fps},setpts=N,setsar=1[n${i}]`));
  let prev = '[n0]';
  for (let i = 1; i < segs.length; i++) {
    const tr = segs[i - 1].transitionOut;
    const out = `[v${i}]`;
    if (tr.kind === 'cut') {
      parts.push(`${prev}[n${i}]concat=n=2:v=1:a=0,settb=1/${fps}${out}`);
    } else {
      const startFrame = segmentFrames(segs[i], fps).start;
      const d = Math.round(tr.duration * fps) / fps;
      parts.push(`${prev}[n${i}]xfade=transition=${xfadeTransition(tr.kind)}:duration=${n4(d)}:offset=${n4(startFrame / fps)},settb=1/${fps}${out}`);
    }
    prev = out;
  }
  parts.push(`${prev}ass=captions.ass:fontsdir=${opts.fontsDir},trim=end_frame=${totalFrames},setsar=1,format=yuv420p[vout]`);

  // Voice is the master track; SFX sit well below it. No compression — only a safety peak limiter.
  // Mono voice is duplicated to both channels at full level (a plain upmix would drop it by 3 dB).
  const toStereo = project.voice.probe.channels === 1 ? 'pan=stereo|c0=c0|c1=c0' : 'aformat=channel_layouts=stereo';
  parts.push(`[${voiceIdx}:a]aresample=48000,aformat=sample_fmts=fltp,${toStereo},apad=whole_dur=${n4(duration)}[voice]`);
  const mixInputs = ['[voice]'];
  sfx.forEach((e, k) => {
    const ms = Math.max(0, Math.round(e.time * 1000));
    parts.push(`[${voiceIdx + 1 + k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,pan=stereo|c0=c0|c1=c0,volume=${e.gainDb}dB,adelay=${ms}:all=1[s${k}]`);
    mixInputs.push(`[s${k}]`);
  });
  if (mixInputs.length > 1) {
    parts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0:dropout_transition=0[mix]`);
  } else {
    parts.push(`[voice]anull[mix]`);
  }
  parts.push(`[mix]alimiter=limit=0.97:attack=3:release=60:level=disabled,atrim=end=${n4(duration)}[aout]`);

  const q = project.render.quality;
  args.push(
    '-filter_complex_script', 'graph.txt',
    '-map', '[vout]', '-map', '[aout]',
    '-r', String(fps), '-frames:v', String(totalFrames),
    ...x264Args(q, opts.hwEncoder),
    '-c:a', 'aac', '-b:a', q === 'high' ? '256k' : '192k', '-ar', '48000',
    '-movflags', '+faststart',
    '-t', n4(duration),
    opts.outputPath,
  );

  return {
    id: 'final',
    stage: 'Mixing sound and captions',
    args,
    files: {
      'graph.txt': parts.join(';\n'),
      'captions.ass': captionsToAss(tl.captions, project.captionStyle),
    },
    durationSec: duration,
    weight: duration * (q === 'high' ? 2.5 : 1.2),
    output: opts.outputPath,
  };
}

export function buildRenderPlan(project: Project, opts: RenderPlanOptions): FfmpegJob[] {
  const tl = project.timeline;
  if (!tl) throw new Error('Нет монтажного плана.');
  return [...tl.segments.map((s, i) => buildSegmentJob(project, s, i, opts)), buildFinalJob(project, opts)];
}
