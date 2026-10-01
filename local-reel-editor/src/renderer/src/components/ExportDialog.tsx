import { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, Play, AlertTriangle } from 'lucide-react';
import { checkAudio } from '@core/qa/QualityChecker';
import { api, newJobId } from '../api';
import { useStore } from '../state/store';
import { useJob } from '../state/useJobs';
import { Modal, ProgressBar, Segmented } from './ui';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { project, dir, edit, load, showError } = useStore();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const [done, setDone] = useState<string | null>(null);
  const [hw, setHw] = useState<string[]>([]);
  useEffect(() => {
    void api.dependencies().then((d) => setHw(d.hwEncoders)).catch(() => undefined);
  }, []);
  if (!project || !dir) return null;

  const audioIssues = checkAudio(project);
  const errors = project.qa.filter((q) => q.severity === 'error');
  const highFps = project.clips.some((c) => (c.probe.fps ?? 30) >= 50);

  const start = async () => {
    const safeName = project.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'reel';
    const path = await api.pickExportPath(`${safeName}.mp4`);
    if (!path) return;
    const id = newJobId('export');
    setJobId(id);
    try {
      const saved = await api.exportReel(id, dir, useStore.getState().project!, path);
      load(saved);
      setDone(path);
    } catch (e) {
      showError(e, 'Экспорт не удался');
    } finally {
      setJobId(null);
    }
  };

  if (done) {
    return (
      <Modal title="Reel готов" onClose={onClose}>
        <div className="flex items-center gap-3 rounded-xl bg-accent-soft p-4 text-sm">
          <CheckCircle2 className="shrink-0 text-accent" />
          <span className="break-all">{done}</span>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-outline" onClick={() => api.showInFolder(done)}>
            <FolderOpen size={16} /> Показать в папке
          </button>
          <button className="btn-primary" onClick={() => api.openPath(done)}>
            <Play size={16} /> Открыть
          </button>
        </div>
      </Modal>
    );
  }

  if (jobId) {
    const pct = Math.round((job?.fraction ?? 0) * 100);
    return (
      <Modal title="Rendering Reel">
        <div className="text-5xl font-extrabold tabular-nums tracking-tight">{pct}%</div>
        <div className="mt-2 text-sm text-ink-muted">{job?.stage ?? 'Подготовка…'}</div>
        <ProgressBar value={job?.fraction ?? 0} className="mt-5" />
        <div className="mt-6 flex justify-end">
          <button className="btn-ghost" onClick={() => api.cancelJob(jobId)}>
            Отменить
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Export Reel" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">Формат</span>
          <span className="text-sm font-semibold">1080 × 1920 · H.264 · AAC</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">Качество</span>
          <Segmented
            value={project.render.quality}
            onChange={(quality) => edit((p) => ({ ...p, render: { ...p.render, quality } }))}
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'high', label: 'High Quality' },
            ]}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">FPS</span>
          <Segmented
            value={String(project.render.fps) as '30' | '60'}
            onChange={(v) => edit((p) => ({ ...p, render: { ...p.render, fps: Number(v) as 30 | 60 } }))}
            options={[{ value: '30', label: '30' }, ...(highFps || project.render.fps === 60 ? [{ value: '60' as const, label: '60' }] : [])]}
          />
        </div>
        {hw.length > 0 && (
          <label className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Аппаратное ускорение ({hw[0]})</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#3BE37F]"
              checked={project.render.hardwareAcceleration}
              onChange={(e) => edit((p) => ({ ...p, render: { ...p.render, hardwareAcceleration: e.target.checked } }))}
            />
          </label>
        )}
        {[...audioIssues, ...errors].map((q, i) => (
          <div key={i} className={`flex gap-2 rounded-lg p-3 text-xs ${q.severity === 'error' ? 'bg-danger/10 text-danger' : 'bg-warn/10 text-warn'}`}>
            <AlertTriangle size={14} className="shrink-0" /> {q.message}
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button className="btn-primary" onClick={start} disabled={errors.length > 0}>
          Export Reel
        </button>
      </div>
    </Modal>
  );
}
