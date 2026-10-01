import { mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { ClipAsset, VoiceTrack } from '@core/model/types';
import { labelFromFileName } from '@core/text/normalize';
import { defaultFitMode } from '@core/motion/MotionEngine';
import { newId } from '@core/util/id';
import { probeMedia } from './probe';
import { analyzeAudio } from './audioAnalysis';
import { analyzeActivity } from './activity';
import { runProcess } from '../ffmpeg/run';
import { UserFacingError } from '../errors';

export const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg'];
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];

export interface Tools {
  ffmpeg: string;
  ffprobe: string;
}

export async function importVoice(tools: Tools, path: string, signal?: AbortSignal): Promise<VoiceTrack> {
  const ext = extname(path).toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(ext) && !VIDEO_EXTENSIONS.includes(ext)) {
    throw new UserFacingError('Этот формат аудио не поддерживается. Используйте WAV, MP3 или M4A.', path, 'bad-audio-format');
  }
  const probe = await probeMedia(tools.ffprobe, path);
  if (!probe.hasAudio) throw new UserFacingError('В этом файле нет звуковой дорожки.', path, 'no-audio');
  if (probe.durationSec < 1) throw new UserFacingError('Аудио слишком короткое (меньше секунды).', path, 'audio-too-short');
  if (probe.durationSec > 15 * 60) throw new UserFacingError('Аудио длиннее 15 минут. Для Reels используйте короткий voice-over.', path, 'audio-too-long');
  const a = await analyzeAudio(tools.ffmpeg, path, signal);
  return {
    path,
    name: basename(path),
    probe,
    peaks: a.peaks,
    peaksPerSecond: a.peaksPerSecond,
    peakDb: a.peakDb,
    meanDb: a.meanDb,
  };
}

/** Imports a clip non-destructively: the original is only read, never modified. */
export async function importClip(tools: Tools, path: string, cacheDir: string, signal?: AbortSignal, onStage?: (s: string) => void): Promise<ClipAsset> {
  const ext = extname(path).toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    throw new UserFacingError('Этот формат видео не поддерживается. Используйте MP4 или MOV.', path, 'bad-video-format');
  }
  const probe = await probeMedia(tools.ffprobe, path);
  if (!probe.hasVideo || !probe.width || !probe.height) {
    throw new UserFacingError('Этот видеофайл не удалось прочитать. Попробуйте экспортировать его в H.264.', path, 'no-video');
  }
  if (probe.durationSec < 0.3) throw new UserFacingError('Клип слишком короткий.', path, 'clip-too-short');

  const id = newId('clip');
  const dir = join(cacheDir, id);
  await mkdir(dir, { recursive: true });
  const thumbnail = join(dir, 'thumb.jpg');
  const proxy = join(dir, 'proxy.mp4');

  onStage?.('thumbnail');
  try {
    await runProcess(tools.ffmpeg, ['-v', 'error', '-y', '-nostdin', '-ss', String(Math.min(probe.durationSec * 0.3, 2)), '-i', path, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', thumbnail], { signal });
  } catch (e) {
    throw new UserFacingError('Этот видеофайл не удалось прочитать. Попробуйте экспортировать его в H.264.', (e as UserFacingError).details, 'decode-failed');
  }

  onStage?.('proxy');
  const portrait = probe.height >= probe.width;
  const scale = portrait ? "scale=-2:'min(960,ih)'" : "scale='min(960,iw)':-2";
  await runProcess(
    tools.ffmpeg,
    ['-v', 'error', '-y', '-nostdin', '-i', path, '-an', '-vf', `${scale},fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '10', '-keyint_min', '10', '-movflags', '+faststart', proxy],
    { signal, durationSec: probe.durationSec },
  );

  onStage?.('analysis');
  const activity = await analyzeActivity(tools.ffmpeg, proxy, probe.width, probe.height, signal);
  const fileLabel = labelFromFileName(basename(path));
  return { id, path, fileLabel, label: fileLabel, probe, thumbnail, proxy, activity, fitMode: defaultFitMode(probe) };
}
