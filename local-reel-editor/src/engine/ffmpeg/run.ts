import { spawn } from 'node:child_process';
import { CancelledError, UserFacingError } from '../errors';

export interface RunOptions {
  cwd?: string;
  signal?: AbortSignal;
  /** Expected output duration; enables progress callbacks 0..1. */
  durationSec?: number;
  onProgress?: (fraction: number) => void;
  /** Collect stdout as a Buffer (for raw pipes). */
  captureStdout?: boolean;
  onStdoutChunk?: (chunk: Buffer) => void;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

/** Last lines of stderr, enough for "Show details" without flooding the UI. */
const tail = (s: string, lines = 30): string =>
  s
    .split(/\r?\n/)
    .filter((l) => l && !/^[a-z_]+=\S*$/.test(l))
    .slice(-lines)
    .join('\n');

/** Runs an FFmpeg-family process asynchronously (never blocks the UI), with progress and cancellation. */
export function runProcess(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError());
    const wantsProgress = !!(opts.onProgress && opts.durationSec);
    const finalArgs = wantsProgress ? ['-progress', 'pipe:2', '-stats_period', '0.25', ...args] : args;
    const child = spawn(bin, finalArgs, { cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    let errLen = 0;

    const onAbort = () => {
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (c: Buffer) => {
      if (opts.onStdoutChunk) opts.onStdoutChunk(c);
      else if (opts.captureStdout !== false) out.push(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      const s = c.toString();
      // Keep stderr bounded.
      err += s;
      errLen += s.length;
      if (errLen > 200_000) {
        err = err.slice(-100_000);
        errLen = err.length;
      }
      if (wantsProgress) {
        const m = /out_time_us=(\d+)/g;
        let last: RegExpExecArray | null = null;
        let x: RegExpExecArray | null;
        while ((x = m.exec(s))) last = x;
        if (last) opts.onProgress!(Math.min(1, Number(last[1]) / 1e6 / opts.durationSec!));
      }
    });
    child.on('error', (e) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new UserFacingError('Не удалось запустить FFmpeg. Проверьте установку в настройках.', String(e)));
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return reject(new CancelledError());
      if (code === 0) {
        if (wantsProgress) opts.onProgress!(1);
        resolve({ stdout: Buffer.concat(out), stderr: err });
      } else {
        const e = new UserFacingError('Процесс обработки видео завершился с ошибкой.', `${bin} ${args.join(' ')}\n\n${tail(err)}`);
        reject(e);
      }
    });
  });
}
