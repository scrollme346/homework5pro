/**
 * End-to-end UI run of the real Electron app (no mocks of FFmpeg).
 * Native file dialogs are answered from the main process; the transcript is
 * taken from the espeak fixture because no Whisper model can be downloaded
 * in CI. Run: xvfb-run -a npx tsx tests/e2e/app.e2e.ts
 */
import { _electron as electron, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const tmp = join(root, 'tests', '.tmp');
const media = join(tmp, 'media');
const shots = join(tmp, 'screens');
const dataDir = join(tmp, 'e2e-data');
const projectsDir = join(tmp, 'e2e-projects');
const outFile = join(tmp, 'out', 'e2e-reel.mp4');

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(shots, `${name}.png`) });
  console.log('screenshot', name);
}

let failPage: Page | null = null;

async function main() {
  if (!existsSync(join(media, 'voice.wav'))) execFileSync('npx', ['tsx', 'scripts/make-test-media.ts', media], { cwd: root, stdio: 'inherit' });
  rmSync(projectsDir, { recursive: true, force: true });
  rmSync(outFile, { force: true });
  mkdirSync(shots, { recursive: true });
  // Reuse the speech engine installed by the CLI test, if present.
  mkdirSync(dataDir, { recursive: true });

  const app = await electron.launch({
    args: [join(root, 'out', 'main', 'index.js'), '--no-sandbox'],
    env: { ...process.env, REEL_DATA_DIR: dataDir, REEL_PROJECTS_DIR: projectsDir },
  });
  const page = await app.firstWindow();
  failPage = page;
  page.on('console', (m) => m.type() === 'error' && console.log('[renderer]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector('text=New Reel');
  await page.waitForTimeout(800);
  await shot(page, '01-home');

  // New project
  await page.click('text=New Reel');
  await page.fill('input[placeholder="Название ролика"]', 'Demo Reel');
  await page.click('button:has-text("Создать")');
  await page.waitForSelector('text=Drag & Drop Audio');
  await shot(page, '02-setup-empty');

  // Voice-over (answer the native dialog from the main process)
  const answer = async (paths: string[]) =>
    app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: p })) as typeof dialog.showOpenDialog;
    }, paths);
  await answer([join(media, 'voice.wav')]);
  await page.click('text=Drag & Drop Audio');
  await page.waitForSelector('text=voice.wav', { timeout: 60_000 });

  // Clips
  const clips = readdirSync(join(media, 'clips')).map((f) => join(media, 'clips', f));
  await answer(clips);
  await page.click('text=Drag & Drop Clips');
  await page.waitForFunction((n) => (globalThis as unknown as { document: { querySelectorAll(s: string): { length: number } } }).document.querySelectorAll('section img').length >= n, clips.length, { timeout: 300_000 });
  await page.waitForTimeout(1500);
  await shot(page, '03-setup-ready');

  // Inject the fixture transcript (stand-in for Whisper output) and reopen the project from Recent Projects.
  const projDir = join(projectsDir, readdirSync(projectsDir)[0]);
  const file = join(projDir, 'project.reel.json');
  await page.waitForTimeout(1200); // let autosave settle
  const proj = JSON.parse(readFileSync(file, 'utf8'));
  const fx = JSON.parse(readFileSync(join(media, 'transcript.json'), 'utf8'));
  proj.transcript = { language: fx.language, text: fx.text, words: fx.words, model: 'fixture', createdAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(proj, null, 2));
  await page.click('button[aria-label="Назад"]');
  await page.waitForSelector('text=Recent Projects');
  await page.click('text=Demo Reel');
  await page.waitForSelector('text=текст распознан');

  // Generate
  await page.click('text=Generate Reel');
  await page.waitForSelector('text=Export Reel', { timeout: 180_000 });
  await page.waitForTimeout(2500);
  await shot(page, '04-editor');

  // Play preview for a moment
  await page.click('button[aria-label="Играть"]');
  await page.waitForTimeout(2500);
  await shot(page, '05-preview-playing');
  await page.click('button[aria-label="Пауза"]');

  // Select a segment, change transition, undo
  const segs = page.locator('div[title*="·"].cursor-grab');
  const n = await segs.count();
  console.log('segments on timeline:', n);
  await segs.nth(2).click();
  await page.waitForSelector('text=Zoom / Motion');
  await page.click('button:has-text("Dissolve")');
  await page.waitForTimeout(400);
  await shot(page, '06-segment-props');
  await page.click('button[title^="Undo"]');
  await page.waitForTimeout(300);

  // Export
  await app.evaluate(({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
  }, outFile);
  await page.click('button:has-text("Export Reel")');
  await page.waitForSelector('text=High Quality');
  await page.locator('.panel button:has-text("Fast")').click();
  await shot(page, '07-export-dialog');
  await page.locator('.panel button:has-text("Export Reel")').click();
  await page.waitForSelector('text=Rendering Reel');
  await page.waitForTimeout(4000);
  await shot(page, '08-rendering');
  await page.waitForSelector('text=Reel готов', { timeout: 600_000 });
  await shot(page, '09-done');
  await app.close();

  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-show_entries', 'format=duration', '-of', 'compact', outFile]).toString();
  console.log(probe);
  if (!/width=1080\|height=1920/.test(probe)) throw new Error('export is not 1080x1920');
  console.log('E2E OK');
}

main().catch(async (e) => {
  console.error(e);
  if (failPage) await failPage.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined);
  process.exit(1);
});
