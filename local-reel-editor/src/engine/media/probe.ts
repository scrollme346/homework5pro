import type { MediaProbe } from '@core/model/types';
import { runProcess } from '../ffmpeg/run';
import { UserFacingError } from '../errors';

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

function parseRate(r?: string): number | undefined {
  if (!r) return undefined;
  const [a, b] = r.split('/').map(Number);
  if (!a || !b) return undefined;
  return Math.round((a / b) * 100) / 100;
}

export async function probeMedia(ffprobe: string, path: string): Promise<MediaProbe> {
  let json: { streams?: FfprobeStream[]; format?: { duration?: string } };
  try {
    const { stdout } = await runProcess(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path]);
    json = JSON.parse(stdout.toString());
  } catch (e) {
    throw new UserFacingError(
      'Этот файл не удалось прочитать. Возможно, он повреждён или в неподдерживаемом формате. Попробуйте экспортировать его в MP4 (H.264).',
      (e as UserFacingError).details ?? String(e),
      'probe-failed',
    );
  }
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png');
  const a = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(json.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  let width = v?.width;
  let height = v?.height;
  // Phones store portrait video as landscape + rotation metadata.
  const rot = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    width,
    height,
    fps: parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate),
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    sampleRate: a?.sample_rate ? Number(a.sample_rate) : undefined,
    channels: a?.channels,
    hasAudio: !!a,
    hasVideo: !!v,
  };
}
