import type { Project, QaIssue, WhisperModelSize } from '../core/model/types';
import type { SfxLibrary } from '../core/sfx/SfxPlanner';

/** Shapes shared by the main process, the preload bridge and the UI. */

export interface ProjectSummary {
  id: string;
  name: string;
  dir: string;
  updatedAt: string;
  duration?: number;
  clipCount: number;
  thumbnail?: string;
  hasTimeline: boolean;
}

export interface AppSettings {
  ffmpegPath?: string;
  ffprobePath?: string;
  pythonPath?: string;
  whisperModel: WhisperModelSize;
  language: 'auto' | 'ru' | 'en';
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

export interface AppInfo {
  version: string;
  platform: string;
  projectsDir: string;
  userSfxDir: string;
  sfxRoot: string;
  fontsDir: string;
}

export interface ErrorInfo {
  message: string;
  details?: string;
  code?: string;
}

export interface JobProgress {
  jobId: string;
  fraction: number;
  stage: string;
  message?: string;
}

export interface OpenedProject {
  dir: string;
  project: Project;
}

export interface GenerateResult extends OpenedProject {
  qa: QaIssue[];
}

export type GenerateStage =
  | 'transcribing'
  | 'understanding'
  | 'story'
  | 'captions'
  | 'motion'
  | 'sound'
  | 'preview';

export interface ReelApi {
  info(): Promise<AppInfo>;
  dependencies(): Promise<DependencyStatus>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  installSpeechEngine(jobId: string): Promise<void>;
  downloadModel(jobId: string, size: WhisperModelSize): Promise<void>;

  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<OpenedProject>;
  openProject(dir: string): Promise<OpenedProject>;
  openProjectFile(): Promise<OpenedProject | null>;
  saveProject(dir: string, project: Project): Promise<Project>;
  deleteProject(dir: string): Promise<void>;

  setVoice(jobId: string, dir: string, project: Project, path: string): Promise<Project>;
  addClips(jobId: string, dir: string, project: Project, paths: string[]): Promise<{ project: Project; errors: { file: string; error: ErrorInfo }[] }>;
  generate(jobId: string, dir: string, project: Project, opts: { variation?: boolean; retranscribe?: boolean }): Promise<GenerateResult>;
  exportReel(jobId: string, dir: string, project: Project, outputPath: string): Promise<Project>;
  cancelJob(jobId: string): Promise<void>;
  sfxLibrary(): Promise<SfxLibrary>;

  pickFiles(kind: 'audio' | 'video'): Promise<string[]>;
  pickExportPath(defaultName: string): Promise<string | null>;
  showInFolder(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  pathForFile(file: File): string;
  /** URL the renderer can use for local media (proxies, thumbnails, audio). */
  mediaUrl(path: string): string;
  onJobProgress(cb: (p: JobProgress) => void): () => void;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: ErrorInfo };
