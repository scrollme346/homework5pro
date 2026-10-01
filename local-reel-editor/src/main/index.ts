import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { Project, WhisperModelSize } from '@core/model/types';
import { PROJECT_FILE_NAME } from '@core/model/serialize';
import { Studio } from '@engine/Studio';
import { toUserFacing } from '@engine/errors';
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from '@engine/media/importer';
import type { AppSettings, IpcResult, JobProgress } from '@shared/api';

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

let win: BrowserWindow | null = null;
let studio: Studio;
const jobs = new Map<string, AbortController>();

function resourcesDir(): string {
  // In development assets/python live in the repo; when packaged they are in resources/.
  return app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..');
}

function sendProgress(p: JobProgress) {
  win?.webContents.send('job:progress', p);
}

/** Wraps every handler so the UI always receives a readable error, never "Unknown error". */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R>, fallback: string) {
  ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<IpcResult<R>> => {
    try {
      return { ok: true, value: await fn(...(args as A)) };
    } catch (err) {
      const u = toUserFacing(err, fallback);
      return { ok: false, error: { message: u.message, details: u.details, code: u.code } };
    }
  });
}

function startJob(jobId: string): AbortSignal {
  const ctrl = new AbortController();
  jobs.set(jobId, ctrl);
  return ctrl.signal;
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
};

/** media://local/<encoded absolute path> with HTTP Range support, so proxy videos seek instantly. */
function registerMediaProtocol() {
  protocol.handle('media', (request) => {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!existsSync(path)) return new Response('Not found', { status: 404 });
    const size = statSync(path).size;
    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
    const range = request.headers.get('range');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
      return new Response(stream, {
        status: 206,
        headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) },
      });
    }
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new Response(stream, { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  });
}

function registerIpc() {
  handle('app:info', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    projectsDir: studio.paths.projectsDir,
    userSfxDir: studio.userSfxRoot,
    sfxRoot: studio.sfxRoot,
    fontsDir: studio.fontsDir,
  }), 'Не удалось получить информацию о приложении.');
  handle('app:dependencies', () => studio.dependencies(), 'Не удалось проверить компоненты.');
  handle('app:getSettings', async () => studio.settings, 'Не удалось прочитать настройки.');
  handle('app:saveSettings', (patch: Partial<AppSettings>) => studio.saveSettings(patch), 'Не удалось сохранить настройки.');
  handle('app:installSpeechEngine', async (jobId: string) => {
    const signal = startJob(jobId);
    try {
      await studio.speech.installEngine((line, fraction) => sendProgress({ jobId, fraction, stage: 'Installing speech engine', message: line }), signal);
    } finally {
      jobs.delete(jobId);
    }
  }, 'Не удалось установить движок распознавания речи.');
  handle('app:downloadModel', async (jobId: string, size: WhisperModelSize) => {
    const signal = startJob(jobId);
    try {
      await studio.speech.downloadModel(size, (fraction) => sendProgress({ jobId, fraction, stage: 'Downloading speech model' }), signal);
    } finally {
      jobs.delete(jobId);
    }
  }, 'Не удалось скачать модель.');

  handle('projects:list', () => studio.projects.list(), 'Не удалось загрузить список проектов.');
  handle('projects:create', (name: string) => studio.projects.create(name), 'Не удалось создать проект.');
  handle('projects:open', async (dir: string) => ({ dir, project: await studio.projects.load(dir) }), 'Не удалось открыть проект.');
  handle('projects:openFile', async () => {
    const r = await dialog.showOpenDialog(win!, { filters: [{ name: 'Reel project', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0].replace(new RegExp(`[\\\\/]${PROJECT_FILE_NAME.replace('.', '\\.')}$`), '');
    return { dir, project: await studio.projects.load(dir) };
  }, 'Не удалось открыть проект.');
  handle('projects:save', (dir: string, project: Project) => studio.projects.save(dir, project), 'Не удалось сохранить проект.');
  handle('projects:delete', (dir: string) => studio.projects.remove(dir), 'Не удалось удалить проект.');

  handle('media:setVoice', async (jobId: string, dir: string, project: Project, path: string) => {
    const signal = startJob(jobId);
    sendProgress({ jobId, fraction: 0.1, stage: 'Analyzing voice' });
    try {
      return await studio.setVoice(dir, project, path, signal);
    } finally {
      jobs.delete(jobId);
    }
  }, 'Не удалось добавить аудио.');
  handle('media:addClips', async (jobId: string, dir: string, project: Project, paths: string[]) => {
    const signal = startJob(jobId);
    try {
      const r = await studio.addClips(dir, project, paths, signal, (done, total, file) =>
        sendProgress({ jobId, fraction: total ? done / total : 1, stage: 'Importing clips', message: file }),
      );
      return { project: r.project, errors: r.errors.map((e) => ({ file: e.file, error: { message: e.error.message, details: e.error.details, code: e.error.code } })) };
    } finally {
      jobs.delete(jobId);
    }
  }, 'Не удалось добавить клипы.');

  handle('pipeline:generate', async (jobId: string, dir: string, project: Project, opts: { variation?: boolean; retranscribe?: boolean }) => {
    const signal = startJob(jobId);
    try {
      let p = project;
      if (!p.transcript || opts.retranscribe) {
        sendProgress({ jobId, fraction: 0, stage: 'transcribing' });
        p = await studio.transcribe(dir, p, (f) => sendProgress({ jobId, fraction: f, stage: 'transcribing' }), signal);
      }
      const r = await studio.generate(dir, p, { variation: opts.variation, onStage: (stage) => sendProgress({ jobId, fraction: 1, stage }) });
      sendProgress({ jobId, fraction: 0, stage: 'preview' });
      const ready = await studio.ensureProxies(dir, r.project, signal);
      sendProgress({ jobId, fraction: 1, stage: 'preview' });
      return { dir, project: ready, qa: r.qa };
    } finally {
      jobs.delete(jobId);
    }
  }, 'Не удалось собрать ролик.');

  handle('export:start', async (jobId: string, dir: string, project: Project, outputPath: string) => {
    const signal = startJob(jobId);
    try {
      return await studio.export(dir, project, outputPath, (p) => sendProgress({ jobId, fraction: p.fraction, stage: p.stage }), signal);
    } finally {
      jobs.delete(jobId);
    }
  }, 'Экспорт не удался. Проект не изменён — можно попробовать ещё раз.');
  handle('job:cancel', async (jobId: string) => {
    jobs.get(jobId)?.abort();
  }, 'Не удалось отменить операцию.');
  handle('sfx:library', () => studio.sfxLibrary(), 'Не удалось прочитать библиотеку SFX.');

  handle('dialog:pickFiles', async (kind: 'audio' | 'video') => {
    const exts = (kind === 'audio' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS).map((e) => e.slice(1));
    const r = await dialog.showOpenDialog(win!, {
      properties: kind === 'audio' ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [{ name: kind === 'audio' ? 'Audio' : 'Video', extensions: exts }],
    });
    return r.canceled ? [] : r.filePaths;
  }, 'Не удалось открыть диалог выбора файлов.');
  handle('dialog:pickExportPath', async (defaultName: string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('videos'), defaultName), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    return r.canceled || !r.filePath ? null : r.filePath.endsWith('.mp4') ? r.filePath : `${r.filePath}.mp4`;
  }, 'Не удалось открыть диалог сохранения.');
  handle('shell:showInFolder', async (path: string) => shell.showItemInFolder(path), 'Не удалось открыть папку.');
  handle('shell:openPath', async (path: string) => {
    await shell.openPath(path);
  }, 'Не удалось открыть файл.');
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0B0B0C',
    title: 'Local Reel Editor',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // External links open in the system browser; the app never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  const res = resourcesDir();
  // Overridable for automated tests and portable setups.
  const dataDir = process.env.REEL_DATA_DIR ?? app.getPath('userData');
  studio = new Studio({
    dataDir,
    projectsDir: process.env.REEL_PROJECTS_DIR ?? join(app.getPath('documents'), 'Local Reel Editor'),
    assetsDir: join(res, 'assets'),
    transcribeScript: join(res, 'python', 'transcribe.py'),
    bundledBinDir: join(res, 'bin'),
  });
  await studio.loadSettings();
  await studio.ensureUserSfxFolders().catch(() => undefined);
  registerMediaProtocol();
  registerIpc();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const c of jobs.values()) c.abort();
  if (process.platform !== 'darwin') app.quit();
});
