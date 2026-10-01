import type { ClipActivity, Point } from '@core/model/types';
import { runProcess } from '../ffmpeg/run';

const SAMPLE_FPS = 10;
const GRID_W = 36;

/**
 * Motion analysis of a screen recording: where and when the picture
 * changes. Taps/toggles show up as short, localised changes; screen
 * transitions as large ones. Used for cut points, zoom focus and clicks.
 */
export async function analyzeActivity(ffmpeg: string, path: string, width: number, height: number, signal?: AbortSignal): Promise<ClipActivity> {
  const gw = GRID_W;
  const gh = Math.max(16, Math.min(96, Math.round((GRID_W * height) / Math.max(1, width) / 2) * 2));
  const frameSize = gw * gh;
  const chunks: Buffer[] = [];
  await runProcess(
    ffmpeg,
    ['-v', 'error', '-nostdin', '-i', path, '-an', '-vf', `fps=${SAMPLE_FPS},scale=${gw}:${gh}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'],
    { signal, onStdoutChunk: (c) => chunks.push(c) },
  );
  const buf = Buffer.concat(chunks);
  const frames = Math.floor(buf.length / frameSize);
  const energy: number[] = [];
  const centroid: (Point | null)[] = [];
  const changedFrac: number[] = [];
  for (let f = 0; f < frames; f++) {
    if (f === 0) {
      energy.push(0);
      centroid.push(null);
      changedFrac.push(0);
      continue;
    }
    const a = (f - 1) * frameSize;
    const b = f * frameSize;
    let sum = 0;
    let cx = 0;
    let cy = 0;
    let cw = 0;
    let changed = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const d = Math.abs(buf[b + i] - buf[a + i]);
        sum += d;
        if (d > 10) {
          changed++;
          cx += (x + 0.5) * d;
          cy += (y + 0.5) * d;
          cw += d;
        }
      }
    }
    energy.push(Math.round((sum / frameSize / 255) * 10000) / 10000);
    centroid.push(cw > 0 ? { x: Math.round((cx / cw / gw) * 1000) / 1000, y: Math.round((cy / cw / gh) * 1000) / 1000 } : null);
    changedFrac.push(changed / frameSize);
  }

  const sceneChanges: number[] = [];
  const uiEvents: number[] = [];
  let lastEvent = -Infinity;
  for (let f = 1; f < frames; f++) {
    const t = f / SAMPLE_FPS;
    if (changedFrac[f] > 0.4 && energy[f] > 0.05) {
      if (t - (sceneChanges[sceneChanges.length - 1] ?? -Infinity) > 0.5) sceneChanges.push(Math.round(t * 100) / 100);
      continue;
    }
    // Rising edge of a localised change after a calm moment = UI action.
    const calmBefore = [1, 2, 3].every((k) => f - k < 0 || changedFrac[f - k] < 0.004);
    if (calmBefore && changedFrac[f] >= 0.006 && changedFrac[f] <= 0.4 && t - lastEvent > 0.6) {
      uiEvents.push(Math.round(t * 100) / 100);
      lastEvent = t;
    }
  }
  return { sampleRate: SAMPLE_FPS, energy, centroid, sceneChanges, uiEvents };
}
