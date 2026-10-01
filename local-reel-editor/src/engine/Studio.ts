import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project, QaIssue, Transcript, WhisperModelSize } from '@core/model/types';
import { planProject } from '@core/planner/MontagePlanner';
import { checkAudio } from '@core/qa/QualityChecker';
import { ProjectManager } from './project/ProjectManager';
import { importClip, importVoice, type Tools } from './media/importer';
import { locateFfmpeg, detectHwEncoders } from './ffmpeg/locate';
import { TranscriptionEngine } from './transcription/TranscriptionEngine';
import { SFX_CATEGORIES, scanSfxLibrary } from './sfx/library';
import { exportReel, type ExportProgress } from './export/ExportManager';
import { UserFacingError } from './errors';
import type { SfxLibrary } from '@core/sfx/SfxPlanner';

export interface AppSettings {
  ffmpegPath?: string;
  ffprobePath?: string;
  pythonPath?: string;
  whisperModel: WhisperModelSize;
  language: 'auto' | 'ru' | 'en';
}

export const DEFAULT_SETTINGS: AppSettings = { whisperModel: 'balanced', language: 'auto' };

export interface StudioPaths {
  /** App data dir (settings, speech engine, models). */
  dataDir: string;
  projectsDir: string;
  /** Bundled assets dir containing sfx/ and fonts/. */
  assetsDir: string;
  /** Sidecar script path. */
  transcribeScript: string;
  /** Directory with bundled ffmpeg binaries, if shipped. */
  bundledBinDir?: string;
}

export interface DependencyStatus {
  ffmpeg: { found: boolean; path?: string; version?: string };
  ffprobe: { found: boolean; path?: string; version?: string };
  python: { found: boolean; path?: string; version?: string };
  speechEngine: { installed: boolean; version?: string };
  models: Record<WhisperModelSize, boolean>;
  selectedModel: WhisperModelSize;
  hwEncoders: string[];
}

/**
 * Application façade over the engine modules. Electron's main process and
 * the CLI both drive the app through this class; it holds no UI state.
 */
export class Studio {
  readonly projects: ProjectManager;
  speech: TranscriptionEngine;
  settings: AppSettings = { ...DEFAULT_SETTINGS };
  private tools: Tools | null = null;
  private hwEncoders: string[] | null = null;

  constructor(readonly paths: StudioPaths) {
    this.projects = new ProjectManager(paths.projectsDir);
    this.speech = new TranscriptionEngine({ baseDir: join(paths.dataDir, 'speech'), script: paths.transcribeScript });
  }

  private get settingsFile(): string {
    return join(this.paths.dataDir, 'settings.json');
  }

  async loadSettings(): Promise<AppSettings> {
    try {
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(this.settingsFile, 'utf8')) };
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    this.speech = new TranscriptionEngine({ baseDir: join(this.paths.dataDir, 'speech'), script: this.paths.transcribeScript, pythonPath: this.settings.pythonPath });
    return this.settings;
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...patch };
    await mkdir(this.paths.dataDir, { recursive: true });
    await writeFile(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf8');
    if ('ffmpegPath' in patch || 'ffprobePath' in patch) this.tools = null;
    if ('pythonPath' in patch) {
      this.speech = new TranscriptionEngine({ baseDir: join(this.paths.dataDir, 'speech'), script: this.paths.transcribeScript, pythonPath: this.settings.pythonPath });
    }
    return this.settings;
  }

  async getTools(): Promise<Tools> {
    if (this.tools) return this.tools;
    const found = await locateFfmpeg({ ffmpegPath: this.settings.ffmpegPath, ffprobePath: this.settings.ffprobePath, bundledDir: this.paths.bundledBinDir });
    if (!found.ffmpeg || !found.ffprobe) {
      throw new UserFacingError(
        'FFmpeg не найден. Он нужен для обработки видео. Откройте «Компоненты», чтобы узнать, как его установить, или укажите путь вручную.',
        undefined,
        'ffmpeg-missing',
      );
    }
    this.tools = { ffmpeg: found.ffmpeg.path, ffprobe: found.ffprobe.path };
    return this.tools;
  }

  async dependencies(): Promise<DependencyStatus> {
    const found = await locateFfmpeg({ ffmpegPath: this.settings.ffmpegPath, ffprobePath: this.settings.ffprobePath, bundledDir: this.paths.bundledBinDir });
    const speech = await this.speech.status();
    if (found.ffmpeg && this.hwEncoders === null) this.hwEncoders = await detectHwEncoders(found.ffmpeg.path);
    return {
      ffmpeg: { found: !!found.ffmpeg, path: found.ffmpeg?.path, version: found.ffmpeg?.version },
      ffprobe: { found: !!found.ffprobe, path: found.ffprobe?.path, version: found.ffprobe?.version },
      python: { found: !!speech.python, path: speech.python ?? undefined, version: speech.pythonVersion ?? undefined },
      speechEngine: { installed: speech.engineInstalled, version: speech.engineVersion ?? undefined },
      models: speech.models,
      selectedModel: this.settings.whisperModel,
      hwEncoders: this.hwEncoders ?? [],
    };
  }

  /** Folder where users drop their own .wav/.mp3 into click/ pop/ whoosh/ impact/. */
  get userSfxRoot(): string {
    return join(this.paths.dataDir, 'sfx');
  }

  async ensureUserSfxFolders(): Promise<void> {
    for (const c of SFX_CATEGORIES) await mkdir(join(this.userSfxRoot, c), { recursive: true });
  }

  /** Built-in sounds (relative paths) plus the user's own sounds (absolute paths). */
  async sfxLibrary(): Promise<SfxLibrary> {
    const builtIn = await scanSfxLibrary(this.sfxRoot);
    if (!existsSync(this.userSfxRoot)) return builtIn;
    const user = await scanSfxLibrary(this.userSfxRoot);
    for (const c of SFX_CATEGORIES) builtIn[c].push(...user[c].map((f) => join(this.userSfxRoot, f)));
    return builtIn;
  }

  get sfxRoot(): string {
    return join(this.paths.assetsDir, 'sfx');
  }

  get fontsDir(): string {
    return join(this.paths.assetsDir, 'fonts');
  }

  async setVoice(dir: string, project: Project, path: string, signal?: AbortSignal): Promise<Project> {
    const tools = await this.getTools();
    const voice = await importVoice(tools, path, signal);
    // A new voice invalidates the transcript and the edit.
    const next: Project = { ...project, voice, transcript: undefined, timeline: undefined, phraseOverrides: {}, qa: checkAudio({ ...project, voice }) };
    return this.projects.save(dir, next);
  }

  async addClips(
    dir: string,
    project: Project,
    paths: string[],
    signal?: AbortSignal,
    onProgress?: (done: number, total: number, file: string) => void,
  ): Promise<{ project: Project; errors: { file: string; error: UserFacingError }[] }> {
    const tools = await this.getTools();
    const clips = [...project.clips];
    const errors: { file: string; error: UserFacingError }[] = [];
    for (let i = 0; i < paths.length; i++) {
      onProgress?.(i, paths.length, paths[i]);
      if (clips.some((c) => c.path === paths[i])) continue;
      try {
        clips.push(await importClip(tools, paths[i], this.projects.cacheDir(dir), signal));
      } catch (e) {
        if (signal?.aborted) throw e;
        errors.push({ file: paths[i], error: e instanceof UserFacingError ? e : new UserFacingError('Не удалось импортировать клип.', String(e)) });
      }
    }
    onProgress?.(paths.length, paths.length, '');
    const saved = await this.projects.save(dir, { ...project, clips });
    return { project: saved, errors };
  }

  async transcribe(dir: string, project: Project, onProgress: (f: number) => void, signal?: AbortSignal): Promise<Project> {
    if (!project.voice) throw new UserFacingError('Сначала добавьте voice-over.');
    const transcript = await this.speech.transcribe(project.voice.path, this.settings.whisperModel, this.settings.language, onProgress, signal);
    if (!transcript.words.length) {
      throw new UserFacingError('В аудио не удалось распознать ни одного слова. Проверьте, что это запись голоса.', undefined, 'no-words');
    }
    return this.projects.save(dir, { ...project, transcript });
  }

  /** Stores a transcript coming from an external file (e.g. a previous session or a test fixture). */
  async setTranscript(dir: string, project: Project, transcript: Transcript): Promise<Project> {
    return this.projects.save(dir, { ...project, transcript });
  }

  async generate(
    dir: string,
    project: Project,
    opts: { variation?: boolean; onStage?: Parameters<typeof planProject>[3] } = {},
  ): Promise<{ project: Project; qa: QaIssue[] }> {
    const p = opts.variation ? { ...project, variation: project.variation + 1 } : project;
    const { timeline, qa } = planProject(p, await this.sfxLibrary(), undefined, opts.onStage);
    const all = [...checkAudio(p), ...qa];
    const saved = await this.projects.save(dir, { ...p, timeline, qa: all });
    return { project: saved, qa: all };
  }

  async export(
    dir: string,
    project: Project,
    outputPath: string,
    onProgress: (p: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Project> {
    const tools = await this.getTools();
    if (!project.timeline) throw new UserFacingError('Сначала нажмите Generate Reel.');
    const audioIssues = checkAudio(project).filter((i) => i.severity === 'error');
    if (audioIssues.length) throw new UserFacingError(audioIssues[0].message);
    if (project.render.hardwareAcceleration && this.hwEncoders === null) this.hwEncoders = await detectHwEncoders(tools.ffmpeg);
    await exportReel(project, {
      ffmpeg: tools.ffmpeg,
      outputPath,
      workRoot: join(dir, 'renders'),
      sfxRoot: this.sfxRoot,
      fontsSource: this.fontsDir,
      hwEncoder: this.hwEncoders?.[0],
      signal,
      onProgress,
    });
    return this.projects.save(dir, { ...project, lastExport: { path: outputPath, at: new Date().toISOString() } });
  }

  /** Re-creates proxies/thumbnails that are missing (e.g. cache deleted) so preview stays fast. */
  async ensureProxies(dir: string, project: Project, signal?: AbortSignal): Promise<Project> {
    const tools = await this.getTools();
    let changed = false;
    const clips = [];
    for (const c of project.clips) {
      if (c.proxy && existsSync(c.proxy) && c.thumbnail && existsSync(c.thumbnail)) {
        clips.push(c);
        continue;
      }
      if (!existsSync(c.path)) {
        throw new UserFacingError(`Исходный клип «${c.label}» не найден. Возможно, файл был перемещён.`, c.path, 'clip-missing');
      }
      const fresh = await importClip(tools, c.path, this.projects.cacheDir(dir), signal);
      clips.push({ ...c, proxy: fresh.proxy, thumbnail: fresh.thumbnail, activity: c.activity ?? fresh.activity });
      changed = true;
    }
    return changed ? this.projects.save(dir, { ...project, clips }) : project;
  }
}
