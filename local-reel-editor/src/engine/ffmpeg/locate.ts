import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface ToolInfo {
  path: string;
  version: string;
}

export interface FfmpegTools {
  ffmpeg: ToolInfo;
  ffprobe: ToolInfo;
}

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

function candidates(name: string, extraDirs: string[]): string[] {
  const dirs = [
    ...extraDirs,
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    'C:\\ffmpeg\\bin',
    'C:\\Program Files\\ffmpeg\\bin',
  ];
  return [...new Set(dirs.filter(Boolean).map((d) => join(d, exe(name))))];
}

export function toolVersion(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(path, ['-version'], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /version\s+(\S+)/.exec(stdout);
      resolve(m ? m[1] : 'unknown');
    });
  });
}

async function findTool(name: string, explicit: string | undefined, extraDirs: string[]): Promise<ToolInfo | null> {
  const list = explicit ? [explicit, ...candidates(name, extraDirs)] : candidates(name, extraDirs);
  for (const p of list) {
    if (!existsSync(p)) continue;
    const v = await toolVersion(p);
    if (v) return { path: p, version: v };
  }
  return null;
}

/** Finds ffmpeg/ffprobe: user setting → bundled dir → PATH → common install locations. */
export async function locateFfmpeg(opts: { ffmpegPath?: string; ffprobePath?: string; bundledDir?: string } = {}): Promise<{
  ffmpeg: ToolInfo | null;
  ffprobe: ToolInfo | null;
}> {
  const extra = opts.bundledDir ? [opts.bundledDir] : [];
  const [ffmpeg, ffprobe] = await Promise.all([
    findTool('ffmpeg', opts.ffmpegPath, extra),
    findTool('ffprobe', opts.ffprobePath, extra),
  ]);
  return { ffmpeg, ffprobe };
}

/** Lists hardware H.264 encoders that actually work on this machine (tiny test encode). */
export async function detectHwEncoders(ffmpeg: string): Promise<string[]> {
  const listed: string = await new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 10_000, windowsHide: true }, (_e, out) => resolve(out ?? ''));
  });
  const wanted = ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf'].filter((n) => listed.includes(n));
  const working: string[] = [];
  for (const enc of wanted) {
    const ok: boolean = await new Promise((resolve) => {
      execFile(
        ffmpeg,
        ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', '-c:v', enc, '-f', 'null', '-'],
        { timeout: 15_000, windowsHide: true },
        (err) => resolve(!err),
      );
    });
    if (ok) working.push(enc);
  }
  return working;
}
