import { runProcess } from '../ffmpeg/run';

export interface AudioAnalysis {
  peaks: number[];
  peaksPerSecond: number;
  peakDb: number;
  meanDb: number;
}

const RATE = 8000;

/** Decodes the voice to mono PCM once and computes waveform peaks and levels. */
export async function analyzeAudio(ffmpeg: string, path: string, signal?: AbortSignal, peaksPerSecond = 100): Promise<AudioAnalysis> {
  const chunks: Buffer[] = [];
  await runProcess(ffmpeg, ['-v', 'error', '-nostdin', '-i', path, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], {
    signal,
    onStdoutChunk: (c) => chunks.push(c),
  });
  const buf = Buffer.concat(chunks);
  const n = Math.floor(buf.length / 2);
  const per = Math.max(1, Math.floor(RATE / peaksPerSecond));
  const peaks: number[] = [];
  let maxAll = 0;
  let sumSq = 0;
  let voiced = 0;
  let voicedSq = 0;
  for (let i = 0; i < n; i += per) {
    let m = 0;
    const end = Math.min(n, i + per);
    for (let j = i; j < end; j++) {
      const v = Math.abs(buf.readInt16LE(j * 2)) / 32768;
      if (v > m) m = v;
      sumSq += v * v;
    }
    if (m > 0.02) {
      for (let j = i; j < end; j++) {
        const v = buf.readInt16LE(j * 2) / 32768;
        voicedSq += v * v;
      }
      voiced += end - i;
    }
    if (m > maxAll) maxAll = m;
    peaks.push(Math.round(m * 1000) / 1000);
  }
  const toDb = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -120);
  const rms = voiced ? Math.sqrt(voicedSq / voiced) : Math.sqrt(sumSq / Math.max(1, n));
  return { peaks, peaksPerSecond, peakDb: toDb(maxAll), meanDb: toDb(rms) };
}
