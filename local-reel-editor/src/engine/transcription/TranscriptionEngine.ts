import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Transcript, WhisperModelSize, Word } from '@core/model/types';
import { CancelledError, UserFacingError } from '../errors';

/** UI size names → faster-whisper model ids. Balanced is the recommended default. */
export const WHISPER_MODELS: Record<WhisperModelSize, { id: string; label: string; approxMb: number }> = {
  fast: { id: 'base', label: 'Fast', approxMb: 145 },
  balanced: { id: 'small', label: 'Balanced (recommended)', approxMb: 485 },
  accurate: { id: 'large-v3-turbo', label: 'Accurate', approxMb: 1620 },
};

export const FASTER_WHISPER_VERSION = '1.2.1';

export interface SpeechEngineStatus {
  python: string | null;
  pythonVersion: string | null;
  engineInstalled: boolean;
  engineVersion: string | null;
  models: Record<WhisperModelSize, boolean>;
}

export interface TranscriptionPaths {
  /** Folder where the app keeps its private Python env and models. */
  baseDir: string;
  /** The sidecar script. */
  script: string;
  /** Optional explicit python executable (settings). */
  pythonPath?: string;
}

function execText(bin: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` }));
  });
}

/**
 * Runs faster-whisper locally through a small Python sidecar in a private
 * virtualenv. No audio is sent anywhere; the only network access is the
 * one-time, user-approved engine install and model download.
 */
export class TranscriptionEngine {
  constructor(private paths: TranscriptionPaths) {}

  get venvDir(): string {
    return join(this.paths.baseDir, 'python-env');
  }

  get modelsDir(): string {
    return join(this.paths.baseDir, 'models');
  }

  private get venvPython(): string {
    return process.platform === 'win32' ? join(this.venvDir, 'Scripts', 'python.exe') : join(this.venvDir, 'bin', 'python');
  }

  /** Finds a system Python ≥ 3.9 to create the private environment from. */
  async findSystemPython(): Promise<{ path: string; version: string } | null> {
    const list = [
      this.paths.pythonPath,
      ...(process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']),
    ].filter(Boolean) as string[];
    for (const p of list) {
      const args = p === 'py' ? ['-3', '--version'] : ['--version'];
      const r = await execText(p, args);
      const m = /Python (\d+)\.(\d+)\.(\d+)/.exec(r.out);
      if (r.ok && m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 9))) return { path: p, version: `${m[1]}.${m[2]}.${m[3]}` };
    }
    return null;
  }

  modelPath(size: WhisperModelSize): string {
    return join(this.modelsDir, WHISPER_MODELS[size].id);
  }

  hasModel(size: WhisperModelSize): boolean {
    const dir = this.modelPath(size);
    return existsSync(join(dir, 'model.bin')) && existsSync(join(dir, 'config.json'));
  }

  async status(): Promise<SpeechEngineStatus> {
    const sys = await this.findSystemPython();
    let engineVersion: string | null = null;
    if (existsSync(this.venvPython)) {
      const r = await execText(this.venvPython, [this.paths.script, 'check'], 60_000);
      const m = /"faster_whisper":\s*"([^"]+)"/.exec(r.out);
      engineVersion = r.ok && m ? m[1] : null;
    }
    return {
      python: sys?.path ?? null,
      pythonVersion: sys?.version ?? null,
      engineInstalled: !!engineVersion,
      engineVersion,
      models: { fast: this.hasModel('fast'), balanced: this.hasModel('balanced'), accurate: this.hasModel('accurate') },
    };
  }

  /** Creates the private venv and installs faster-whisper from PyPI. */
  async installEngine(onLog: (line: string, fraction: number) => void, signal?: AbortSignal): Promise<void> {
    const sys = await this.findSystemPython();
    if (!sys) {
      throw new UserFacingError(
        'Для локального распознавания речи нужен Python 3.9 или новее. Установите Python с python.org и перезапустите приложение.',
        undefined,
        'python-missing',
      );
    }
    await mkdir(this.paths.baseDir, { recursive: true });
    const pre = sys.path === 'py' ? ['-3'] : [];
    onLog('Creating private Python environment…', 0.05);
    await this.runLogged(sys.path, [...pre, '-m', 'venv', this.venvDir], onLog, 0.05, 0.15, signal);
    onLog('Installing speech engine (faster-whisper)…', 0.15);
    await this.runLogged(this.venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'pip'], onLog, 0.15, 0.25, signal);
    await this.runLogged(this.venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', `faster-whisper==${FASTER_WHISPER_VERSION}`], onLog, 0.25, 1, signal);
    const st = await this.status();
    if (!st.engineInstalled) throw new UserFacingError('Не удалось установить движок распознавания речи.', 'faster-whisper import failed after install', 'engine-install-failed');
  }

  private runLogged(bin: string, args: string[], onLog: (l: string, f: number) => void, from: number, to: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { windowsHide: true });
      let n = 0;
      let errText = '';
      const onAbort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', onAbort, { once: true });
      const handle = (c: Buffer) => {
        for (const line of c.toString().split(/\r?\n/).filter(Boolean)) {
          n++;
          errText = (errText + '\n' + line).slice(-4000);
          onLog(line, from + (to - from) * Math.min(0.95, n / (n + 25)));
        }
      };
      child.stdout.on('data', handle);
      child.stderr.on('data', handle);
      child.on('error', (e) => reject(new UserFacingError('Не удалось запустить Python.', String(e), 'python-spawn')));
      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new CancelledError());
        if (code === 0) resolve();
        else reject(new UserFacingError('Установка не удалась. Проверьте подключение к интернету и попробуйте снова.', errText, 'install-failed'));
      });
    });
  }

  private async dirSize(dir: string): Promise<number> {
    let total = 0;
    try {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        total += e.isDirectory() ? await this.dirSize(p) : (await stat(p)).size;
      }
    } catch {
      /* not created yet */
    }
    return total;
  }

  /** Downloads a Whisper model once. Progress is estimated from bytes on disk. */
  async downloadModel(size: WhisperModelSize, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
    const spec = WHISPER_MODELS[size];
    const target = this.modelPath(size);
    const timer = setInterval(async () => {
      const bytes = await this.dirSize(this.modelsDir);
      onProgress(Math.min(0.99, bytes / (spec.approxMb * 1024 * 1024)));
    }, 500);
    try {
      const events = await this.runSidecar(['download', '--model', spec.id, '--models-dir', this.modelsDir], () => undefined, signal);
      const err = events.find((e) => e.type === 'error');
      if (err) {
        throw new UserFacingError(
          'Не удалось скачать модель распознавания речи. Проверьте подключение к интернету и попробуйте снова.',
          String(err.details ?? err.message),
          'model-download-failed',
        );
      }
      if (!this.hasModel(size)) throw new UserFacingError('Модель скачалась не полностью. Попробуйте ещё раз.', target, 'model-incomplete');
      onProgress(1);
    } finally {
      clearInterval(timer);
    }
  }

  /** Transcribes the voice-over with word-level timestamps. */
  async transcribe(
    audioPath: string,
    size: WhisperModelSize,
    language: 'auto' | 'ru' | 'en',
    onProgress: (fraction: number) => void,
    signal?: AbortSignal,
  ): Promise<Transcript> {
    if (!existsSync(this.venvPython)) {
      throw new UserFacingError('Движок распознавания речи ещё не установлен. Откройте «Компоненты» и нажмите «Установить».', undefined, 'engine-missing');
    }
    if (!this.hasModel(size)) {
      throw new UserFacingError('Модель распознавания речи ещё не скачана. Откройте «Компоненты» и скачайте её (один раз).', undefined, 'model-missing');
    }
    const events = await this.runSidecar(
      ['transcribe', '--audio', audioPath, '--model', WHISPER_MODELS[size].id, '--models-dir', this.modelsDir, '--language', language],
      (e) => {
        if (e.type === 'progress') onProgress(Number(e.value));
      },
      signal,
    );
    const err = events.find((e) => e.type === 'error');
    if (err) throw new UserFacingError('Не удалось распознать речь в этом аудио.', String(err.details ?? err.message), String(err.code));
    const res = events.find((e) => e.type === 'result');
    if (!res) throw new UserFacingError('Распознавание речи завершилось без результата.', JSON.stringify(events.slice(-3)), 'no-result');
    return parseSidecarResult(res, WHISPER_MODELS[size].id);
  }

  private runSidecar(args: string[], onEvent: (e: Record<string, unknown>) => void, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.venvPython, [this.paths.script, ...args], {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_TELEMETRY: '1' },
      });
      const events: Record<string, unknown>[] = [];
      let buf = '';
      let stderr = '';
      const onAbort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (c: Buffer) => {
        buf += c.toString('utf8');
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('{')) continue;
          try {
            const e = JSON.parse(line);
            events.push(e);
            onEvent(e);
          } catch {
            /* ignore non-JSON noise */
          }
        }
      });
      child.stderr.on('data', (c: Buffer) => {
        stderr = (stderr + c.toString()).slice(-8000);
      });
      child.on('error', (e) => reject(new UserFacingError('Не удалось запустить движок распознавания речи.', String(e), 'sidecar-spawn')));
      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new CancelledError());
        if (code !== 0 && !events.some((e) => e.type === 'error')) {
          events.push({ type: 'error', code: 'crash', message: `exit ${code}`, details: stderr });
        }
        resolve(events);
      });
    });
  }
}

export function parseSidecarResult(res: Record<string, unknown>, model: string): Transcript {
  const words = ((res.words as Word[]) ?? [])
    .filter((w) => typeof w.text === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ ...w, end: Math.max(w.end, w.start) }));
  return {
    language: String(res.language ?? 'unknown'),
    text: String(res.text ?? words.map((w) => w.text).join(' ')),
    words,
    model,
    createdAt: new Date().toISOString(),
  };
}
