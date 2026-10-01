import type { ErrorInfo, ReelApi } from '@shared/api';

/** Error carrying a user-facing message plus technical details for "Show details". */
export class ApiError extends Error implements ErrorInfo {
  constructor(
    message: string,
    public details?: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = await window.reelBridge.invoke<T>(channel, ...args);
  if (r.ok) return r.value;
  throw new ApiError(r.error.message, r.error.details, r.error.code);
}

export const api: ReelApi = {
  info: () => call('app:info'),
  dependencies: () => call('app:dependencies'),
  getSettings: () => call('app:getSettings'),
  saveSettings: (patch) => call('app:saveSettings', patch),
  installSpeechEngine: (jobId) => call('app:installSpeechEngine', jobId),
  downloadModel: (jobId, size) => call('app:downloadModel', jobId, size),

  listProjects: () => call('projects:list'),
  createProject: (name) => call('projects:create', name),
  openProject: (dir) => call('projects:open', dir),
  openProjectFile: () => call('projects:openFile'),
  saveProject: (dir, project) => call('projects:save', dir, project),
  deleteProject: (dir) => call('projects:delete', dir),

  setVoice: (jobId, dir, project, path) => call('media:setVoice', jobId, dir, project, path),
  addClips: (jobId, dir, project, paths) => call('media:addClips', jobId, dir, project, paths),
  generate: (jobId, dir, project, opts) => call('pipeline:generate', jobId, dir, project, opts),
  exportReel: (jobId, dir, project, outputPath) => call('export:start', jobId, dir, project, outputPath),
  cancelJob: (jobId) => call('job:cancel', jobId),
  sfxLibrary: () => call('sfx:library'),

  pickFiles: (kind) => call('dialog:pickFiles', kind),
  pickExportPath: (name) => call('dialog:pickExportPath', name),
  showInFolder: (path) => call('shell:showInFolder', path),
  openPath: (path) => call('shell:openPath', path),
  pathForFile: (file) => window.reelBridge.pathForFile(file),
  mediaUrl: (path) => `media://local/${encodeURIComponent(path)}`,
  onJobProgress: (cb) => window.reelBridge.onJobProgress(cb),
};

export function toErrorInfo(e: unknown): ErrorInfo {
  if (e instanceof ApiError) return { message: e.message, details: e.details, code: e.code };
  const err = e as Error;
  return { message: 'Что-то пошло не так в интерфейсе. Попробуйте ещё раз.', details: err?.stack ?? String(e) };
}

let jobCounter = 0;
export const newJobId = (kind: string): string => `${kind}-${Date.now().toString(36)}-${++jobCounter}`;
