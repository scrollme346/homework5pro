import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import type { Project } from '@core/model/types';
import { buildRenderPlan, type FfmpegJob } from '@core/render/RenderPlan';
import { runProcess } from '../ffmpeg/run';
import { CancelledError } from '../errors';

export interface ExportProgress {
  fraction: number;
  stage: string;
}

export interface ExportOptions {
  ffmpeg: string;
  outputPath: string;
  workRoot: string;
  sfxRoot: string;
  fontsSource: string;
  hwEncoder?: string;
  useProxies?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

/**
 * Renders the project model to MP4. Each shot is its own FFmpeg process,
 * so progress is granular, cancel is immediate and a failure never touches
 * the project. The final file is written to a temp name and renamed.
 */
export async function exportReel(project: Project, opts: ExportOptions): Promise<string> {
  const work = join(opts.workRoot, `.render-${Date.now().toString(36)}`);
  await mkdir(join(work, 'fonts'), { recursive: true });
  for (const f of await readdir(opts.fontsSource)) {
    if (/\.(ttf|otf)$/i.test(f)) await copyFile(join(opts.fontsSource, f), join(work, 'fonts', f));
  }
  await mkdir(dirname(opts.outputPath), { recursive: true });
  const tmpOut = opts.outputPath.replace(/(\.mp4)?$/i, '.partial.mp4');
  // Internal controller: one failed shot stops the others immediately.
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const signal = ctrl.signal;
  const jobs = buildRenderPlan(project, {
    outputPath: tmpOut,
    sfxRoot: opts.sfxRoot,
    fontsDir: 'fonts',
    hwEncoder: project.render.hardwareAcceleration ? opts.hwEncoder : undefined,
    useProxies: opts.useProxies,
  });
  const totalWeight = jobs.reduce((a, j) => a + j.weight, 0);
  const done = new Map<string, number>();
  const report = (stage: string) => {
    let w = 0;
    for (const j of jobs) w += (done.get(j.id) ?? 0) * j.weight;
    opts.onProgress?.({ fraction: Math.min(0.999, w / totalWeight), stage });
  };

  const run = async (job: FfmpegJob) => {
    for (const [name, content] of Object.entries(job.files)) await writeFile(join(work, name), content, 'utf8');
    await runProcess(opts.ffmpeg, job.args, {
      cwd: work,
      signal,
      durationSec: job.durationSec,
      onProgress: (f) => {
        done.set(job.id, f);
        report(job.stage);
      },
    });
    done.set(job.id, 1);
    report(job.stage);
  };

  try {
    const segmentJobs = jobs.filter((j) => j.id !== 'final');
    const finalJob = jobs.find((j) => j.id === 'final')!;
    const parallel = Math.max(1, Math.min(3, Math.floor(availableParallelism() / 3)));
    let next = 0;
    const workers = Array.from({ length: parallel }, async () => {
      while (next < segmentJobs.length) {
        if (signal.aborted) throw new CancelledError();
        const job = segmentJobs[next++];
        await run(job);
      }
    });
    await Promise.all(workers.map((w) => w.catch((e) => { ctrl.abort(); throw e; })));
    await run(finalJob);
    await rename(tmpOut, opts.outputPath);
    opts.onProgress?.({ fraction: 1, stage: 'Done' });
    return opts.outputPath;
  } catch (e) {
    ctrl.abort();
    await rm(tmpOut, { force: true });
    throw opts.signal?.aborted ? new CancelledError() : e;
  } finally {
    opts.signal?.removeEventListener('abort', onOuterAbort);
    await rm(work, { recursive: true, force: true });
  }
}
