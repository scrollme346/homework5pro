/**
 * Headless CLI over the same engine the desktop app uses.
 *
 *   reel deps
 *   reel install-engine
 *   reel download-model [fast|balanced|accurate]
 *   reel make --voice voice.wav --clips <dir|files...> --out reel.mp4
 *             [--transcript whisper.json] [--style minimal|dynamic|fast]
 *             [--quality fast|high] [--projects <dir>] [--name "My reel"]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Studio } from '@engine/Studio';
import { parseSidecarResult } from '@engine/transcription/TranscriptionEngine';
import { VIDEO_EXTENSIONS } from '@engine/media/importer';
import { UserFacingError } from '@engine/errors';
import type { EditingStyle, WhisperModelSize } from '@core/model/types';

const root = resolve(__dirname, '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function argList(name: string): string[] {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return [];
  const out: string[] = [];
  for (let k = i + 1; k < process.argv.length && !process.argv[k].startsWith('--'); k++) out.push(process.argv[k]);
  return out;
}

function bar(f: number, label: string) {
  const w = 30;
  const n = Math.round(f * w);
  process.stdout.write(`\r${label.padEnd(30)} [${'#'.repeat(n)}${'.'.repeat(w - n)}] ${(f * 100).toFixed(0).padStart(3)}%`);
}

async function main() {
  const cmd = process.argv[2];
  const dataDir = process.env.REEL_DATA_DIR ?? join(homedir(), '.local-reel-editor');
  const studio = new Studio({
    dataDir,
    projectsDir: arg('projects') ?? join(dataDir, 'Projects'),
    assetsDir: join(root, 'assets'),
    transcribeScript: join(root, 'python', 'transcribe.py'),
  });
  await studio.loadSettings();

  if (cmd === 'deps') {
    console.log(JSON.stringify(await studio.dependencies(), null, 2));
    return;
  }
  if (cmd === 'install-engine') {
    await studio.speech.installEngine((line, f) => bar(f, line.slice(0, 30)));
    console.log('\nSpeech engine installed.');
    return;
  }
  if (cmd === 'download-model') {
    const size = (process.argv[3] ?? studio.settings.whisperModel) as WhisperModelSize;
    await studio.speech.downloadModel(size, (f) => bar(f, `Downloading ${size}`));
    console.log('\nModel ready.');
    return;
  }
  if (cmd !== 'make') {
    console.log('Usage: reel deps | install-engine | download-model [size] | make --voice f --clips ... --out f');
    process.exitCode = 1;
    return;
  }

  const voice = arg('voice');
  const out = arg('out');
  let clips = argList('clips');
  if (!voice || !out || !clips.length) throw new UserFacingError('Нужны --voice, --clips и --out.');
  if (clips.length === 1 && statSync(clips[0]).isDirectory()) {
    const d = clips[0];
    clips = readdirSync(d)
      .filter((f) => VIDEO_EXTENSIONS.some((e) => f.toLowerCase().endsWith(e)))
      .sort()
      .map((f) => join(d, f));
  }

  const t0 = Date.now();
  let { project, dir } = await studio.projects.create(arg('name') ?? 'CLI Reel');
  project = { ...project, editingStyle: (arg('style') as EditingStyle) ?? 'dynamic' };
  if (arg('quality')) project.render = { ...project.render, quality: arg('quality') as 'fast' | 'high' };
  console.log(`Project: ${dir}`);

  project = await studio.setVoice(dir, project, resolve(voice));
  console.log(`Voice: ${project.voice!.probe.durationSec.toFixed(2)} s, peak ${project.voice!.peakDb} dBFS`);

  const added = await studio.addClips(dir, project, clips.map((c) => resolve(c)), undefined, (d, n) => bar(d / n, 'Importing clips'));
  project = added.project;
  console.log(`\nClips: ${project.clips.map((c) => `${c.label} (${c.probe.durationSec.toFixed(1)}s, ${c.fitMode}, ${c.activity?.uiEvents.length ?? 0} ui events)`).join(', ')}`);
  for (const e of added.errors) console.log(`  ! ${e.file}: ${e.error.message}`);

  const fixture = arg('transcript');
  if (fixture) {
    project = await studio.setTranscript(dir, project, parseSidecarResult(JSON.parse(readFileSync(fixture, 'utf8')), 'fixture'));
    console.log(`Transcript: from ${fixture} (${project.transcript!.words.length} words)`);
  } else {
    project = await studio.transcribe(dir, project, (f) => bar(f, 'Transcribing voice'));
    console.log(`\nTranscript: ${project.transcript!.words.length} words, language ${project.transcript!.language}`);
  }

  const gen = await studio.generate(dir, project);
  project = gen.project;
  const tl = project.timeline!;
  console.log(`\nPlan: ${tl.sections.length} sections, ${tl.segments.length} shots, ${tl.captions.length} captions, ${tl.sfx.length} sfx`);
  for (const s of tl.sections) {
    const clip = project.clips.find((c) => c.id === s.clipId)!;
    console.log(`  ${s.start.toFixed(2).padStart(6)}–${s.end.toFixed(2).padEnd(6)} ${clip.label.padEnd(18)} conf ${s.confidence.toFixed(2)}${s.needsReview ? '  ← review' : ''}  "${s.text.slice(0, 50)}"`);
  }
  for (const q of gen.qa) console.log(`  QA ${q.severity}: ${q.message}${q.time !== undefined ? ` @${q.time.toFixed(2)}` : ''}`);

  project = await studio.export(dir, project, resolve(out), (p) => bar(p.fraction, p.stage));
  console.log(`\nExported ${resolve(out)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  const u = e instanceof UserFacingError ? e : new UserFacingError(String(e?.message ?? e), e?.stack);
  console.error(`\nError: ${u.message}`);
  if (u.details) console.error(`Details:\n${u.details}`);
  process.exitCode = 1;
});
