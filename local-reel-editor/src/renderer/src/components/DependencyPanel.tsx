import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Download, FolderOpen, ExternalLink } from 'lucide-react';
import type { DependencyStatus } from '@shared/api';
import type { WhisperModelSize } from '@core/model/types';
import { api, newJobId } from '../api';
import { useStore } from '../state/store';
import { useJob } from '../state/useJobs';
import { Modal, ProgressBar, Segmented, Spinner } from './ui';

const MODEL_LABELS: Record<WhisperModelSize, { label: string; hint: string; size: string }> = {
  fast: { label: 'Fast', hint: 'Быстро, чуть менее точно', size: '≈145 MB' },
  balanced: { label: 'Balanced', hint: 'Рекомендуется', size: '≈485 MB' },
  accurate: { label: 'Accurate', hint: 'Максимальная точность, медленнее', size: '≈1.6 GB' },
};

function Row({ ok, title, detail, children }: { ok: boolean; title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-4">
      {ok ? <CheckCircle2 className="mt-0.5 shrink-0 text-accent" size={18} /> : <AlertTriangle className="mt-0.5 shrink-0 text-warn" size={18} />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 break-words text-xs leading-relaxed text-ink-muted">{detail}</div>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  );
}

export function useDependencies() {
  const [deps, setDeps] = useState<DependencyStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      setDeps(await api.dependencies());
    } catch {
      setDeps(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { deps, refresh };
}

export function depsReady(d: DependencyStatus | null, needSpeech: boolean): boolean {
  if (!d) return false;
  if (!d.ffmpeg.found || !d.ffprobe.found) return false;
  if (!needSpeech) return true;
  return d.speechEngine.installed && d.models[d.selectedModel];
}

/** First-run check of FFmpeg / speech engine / model, with one-click fixes. */
export function DependencyPanel({ onClose, reason }: { onClose: () => void; reason?: string }) {
  const { deps, refresh } = useDependencies();
  const showError = useStore((s) => s.showError);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);

  const run = async (kind: 'engine' | 'model') => {
    const id = newJobId(kind);
    setJobId(id);
    try {
      if (kind === 'engine') await api.installSpeechEngine(id);
      else await api.downloadModel(id, deps!.selectedModel);
    } catch (e) {
      showError(e, kind === 'engine' ? 'Установка не удалась' : 'Скачивание не удалось');
    } finally {
      setJobId(null);
      await refresh();
    }
  };

  const pickBinary = async (key: 'ffmpegPath' | 'pythonPath') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      await api.saveSettings({ [key]: api.pathForFile(f) });
      if (key === 'ffmpegPath') await api.saveSettings({ ffprobePath: api.pathForFile(f).replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')) });
      await refresh();
    };
    input.click();
  };

  const setModel = async (m: WhisperModelSize) => {
    await api.saveSettings({ whisperModel: m });
    await refresh();
  };

  return (
    <Modal title="Компоненты" onClose={jobId ? undefined : onClose} wide>
      {reason && <p className="mb-4 text-sm text-ink-muted">{reason}</p>}
      {!deps ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Проверяем компоненты…
        </div>
      ) : (
        <div className="space-y-3">
          <Row
            ok={deps.ffmpeg.found && deps.ffprobe.found}
            title="FFmpeg — обработка видео"
            detail={deps.ffmpeg.found ? `Найден: ${deps.ffmpeg.path} (v${deps.ffmpeg.version})` : 'FFmpeg не найден. Он нужен для нарезки, превью и экспорта. Скачайте сборку FFmpeg и укажите файл ffmpeg — ffprobe должен лежать рядом.'}
          >
            {!deps.ffmpeg.found && (
              <div className="flex gap-2">
                <a className="btn-outline h-8 text-xs" href="https://ffmpeg.org/download.html" target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Скачать FFmpeg
                </a>
                <button className="btn-outline h-8 text-xs" onClick={() => pickBinary('ffmpegPath')}>
                  <FolderOpen size={14} /> Указать ffmpeg…
                </button>
              </div>
            )}
          </Row>

          <Row
            ok={deps.speechEngine.installed}
            title="Распознавание речи (Whisper, локально)"
            detail={
              deps.speechEngine.installed
                ? `faster-whisper ${deps.speechEngine.version} установлен в отдельное окружение приложения.`
                : deps.python.found
                  ? `Будет установлен faster-whisper в отдельное окружение (Python ${deps.python.version}). Нужен интернет один раз.`
                  : 'Для локального Whisper нужен Python 3.9+. Установите его с python.org (галочка «Add to PATH» на Windows) и нажмите «Проверить снова».'
            }
          >
            {!deps.speechEngine.installed && (
              <div className="flex flex-wrap gap-2">
                {deps.python.found ? (
                  <button className="btn-primary h-8 text-xs" disabled={!!jobId} onClick={() => run('engine')}>
                    <Download size={14} /> Установить
                  </button>
                ) : (
                  <>
                    <a className="btn-outline h-8 text-xs" href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">
                      <ExternalLink size={14} /> Скачать Python
                    </a>
                    <button className="btn-outline h-8 text-xs" onClick={() => pickBinary('pythonPath')}>
                      <FolderOpen size={14} /> Указать python…
                    </button>
                    <button className="btn-ghost h-8 text-xs" onClick={refresh}>
                      Проверить снова
                    </button>
                  </>
                )}
              </div>
            )}
          </Row>

          <Row
            ok={deps.models[deps.selectedModel]}
            title="Модель речи"
            detail={
              deps.models[deps.selectedModel]
                ? `Модель ${MODEL_LABELS[deps.selectedModel].label} готова. Аудио распознаётся только на этом компьютере.`
                : `Модель скачивается один раз (${MODEL_LABELS[deps.selectedModel].size}). После этого всё работает офлайн.`
            }
          >
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                value={deps.selectedModel}
                onChange={setModel}
                options={(Object.keys(MODEL_LABELS) as WhisperModelSize[]).map((k) => ({
                  value: k,
                  label: `${MODEL_LABELS[k].label}${deps.models[k] ? ' ✓' : ''}`,
                  hint: `${MODEL_LABELS[k].hint}, ${MODEL_LABELS[k].size}`,
                }))}
              />
              {!deps.models[deps.selectedModel] && (
                <button className="btn-primary h-8 text-xs" disabled={!!jobId || !deps.speechEngine.installed} onClick={() => run('model')}>
                  <Download size={14} /> Скачать модель
                </button>
              )}
            </div>
          </Row>

          {deps.hwEncoders.length > 0 && (
            <Row ok title="Аппаратное ускорение экспорта" detail={`Доступно: ${deps.hwEncoders.join(', ')}. Включается в настройках экспорта.`} />
          )}

          {jobId && (
            <div className="rounded-xl border border-line p-4">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold">{job?.stage ?? 'Подготовка…'}</span>
                <span className="text-ink-muted">{Math.round((job?.fraction ?? 0) * 100)}%</span>
              </div>
              <ProgressBar value={job?.fraction ?? 0} />
              {job?.message && <div className="mt-2 truncate text-[11px] text-ink-faint">{job.message}</div>}
              <div className="mt-3 flex justify-end">
                <button className="btn-ghost h-8 text-xs" onClick={() => api.cancelJob(jobId)}>
                  Отменить
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="mt-6 flex justify-end">
        <button className="btn-outline" disabled={!!jobId} onClick={onClose}>
          Готово
        </button>
      </div>
    </Modal>
  );
}
