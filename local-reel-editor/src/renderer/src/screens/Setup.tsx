import { useState, type DragEvent } from 'react';
import { ArrowLeft, Mic, Film, Upload, X, Sparkles, Pencil } from 'lucide-react';
import type { EditingStyle } from '@core/model/types';
import { renameClip, removeClip } from '@core/edit/ops';
import { formatTime } from '@core/util/math';
import { api, newJobId } from '../api';
import { useStore } from '../state/store';
import { useJob } from '../state/useJobs';
import { runGenerate, useGenerate } from '../state/actions';
import { LocalBadge, ProgressBar, Segmented, Spinner, Waveform } from '../components/ui';
import { DependencyPanel } from '../components/DependencyPanel';

const AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

export const STYLE_OPTIONS: { value: EditingStyle; label: string; hint: string }[] = [
  { value: 'minimal', label: 'Minimal', hint: 'Спокойный монтаж, длинные планы' },
  { value: 'dynamic', label: 'Dynamic', hint: 'Смена кадра каждые 1–3 с — рекомендуется' },
  { value: 'fast', label: 'Fast', hint: 'Быстрый ритм' },
];

function DropZone({ accept, onFiles, children, className = '' }: { accept: RegExp; onFiles: (paths: string[]) => void; children: React.ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => api.pathForFile(f))
      .filter((p) => accept.test(p));
    if (paths.length) onFiles(paths);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`rounded-2xl border-2 border-dashed transition-colors ${over ? 'border-accent bg-accent-soft' : 'border-line'} ${className}`}
    >
      {children}
    </div>
  );
}

export function Setup() {
  const { dir, project, goHome, load, edit, showError } = useStore();
  const [voiceJob, setVoiceJob] = useState<string | null>(null);
  const [clipJob, setClipJob] = useState<string | null>(null);
  const clipProgress = useJob(clipJob);
  const [editing, setEditing] = useState<string | null>(null);
  const needsDeps = useGenerate((s) => s.needsDeps);

  if (!project || !dir) return null;

  const addVoice = async (paths: string[]) => {
    const id = newJobId('voice');
    setVoiceJob(id);
    try {
      load(await api.setVoice(id, dir, useStore.getState().project!, paths[0]));
    } catch (e) {
      showError(e, 'Аудио не добавлено');
    } finally {
      setVoiceJob(null);
    }
  };

  const addClips = async (paths: string[]) => {
    const id = newJobId('clips');
    setClipJob(id);
    try {
      const r = await api.addClips(id, dir, useStore.getState().project!, paths);
      load(r.project);
      if (r.errors.length) {
        const first = r.errors[0];
        showError(
          { message: `${first.error.message}${r.errors.length > 1 ? ` (и ещё ${r.errors.length - 1})` : ''}`, details: r.errors.map((e) => `${e.file}\n${e.error.details ?? ''}`).join('\n\n') },
          'Некоторые клипы не добавлены',
        );
      }
    } catch (e) {
      showError(e, 'Клипы не добавлены');
    } finally {
      setClipJob(null);
    }
  };

  const setStyle = (editingStyle: EditingStyle) => edit((p) => ({ ...p, editingStyle }));
  const canGenerate = !!project.voice && project.clips.length > 0 && !voiceJob && !clipJob;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-line/60 px-6">
        <div className="flex items-center gap-3">
          <button className="btn-ghost h-9 w-9 px-0" onClick={goHome} aria-label="Назад">
            <ArrowLeft size={18} />
          </button>
          <input
            className="w-72 bg-transparent text-base font-bold outline-none"
            value={project.name}
            onChange={(e) => edit((p) => ({ ...p, name: e.target.value }))}
          />
        </div>
        <LocalBadge />
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 p-8">
          {/* VOICE OVER */}
          <section className="panel p-6">
            <div className="label mb-4 flex items-center gap-2">
              <Mic size={13} /> Voice Over
            </div>
            <DropZone accept={AUDIO} onFiles={addVoice} className="p-6">
              {voiceJob ? (
                <div className="flex h-40 flex-col items-center justify-center gap-3 text-sm text-ink-muted">
                  <Spinner size={22} /> Анализируем голос…
                </div>
              ) : project.voice ? (
                <div>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{project.voice.name}</div>
                      <div className="mt-1 text-xs text-ink-muted">
                        {formatTime(project.voice.probe.durationSec)} · {project.voice.probe.sampleRate ? `${Math.round(project.voice.probe.sampleRate / 1000)} kHz` : ''}
                        {project.transcript ? ' · текст распознан' : ''}
                      </div>
                    </div>
                    <button className="btn-ghost h-8 text-xs" onClick={() => api.pickFiles('audio').then((f) => { if (f.length) void addVoice(f); })}>
                      Заменить
                    </button>
                  </div>
                  <Waveform peaks={project.voice.peaks ?? []} height={88} className="mt-5 w-full" />
                  <div className="mt-2 text-[11px] text-ink-faint">Голос — главная дорожка: он не сокращается и не ускоряется.</div>
                </div>
              ) : (
                <button className="flex h-40 w-full flex-col items-center justify-center gap-3 text-ink-muted hover:text-ink" onClick={() => api.pickFiles('audio').then((f) => { if (f.length) void addVoice(f); })}>
                  <Upload size={26} />
                  <div className="text-sm font-semibold">Drag & Drop Audio</div>
                  <div className="text-xs text-ink-faint">WAV · MP3 · M4A</div>
                </button>
              )}
            </DropZone>
          </section>

          {/* VIDEO CLIPS */}
          <section className="panel p-6">
            <div className="label mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Film size={13} /> Video Clips
              </span>
              {project.clips.length > 0 && <span className="normal-case tracking-normal text-ink-faint">{project.clips.length} клип(ов)</span>}
            </div>
            <DropZone accept={VIDEO} onFiles={addClips} className="p-4">
              <div className="grid grid-cols-3 gap-3">
                {project.clips.map((c) => (
                  <div key={c.id} className="group overflow-hidden rounded-xl bg-surface-2">
                    <div className="relative aspect-[9/12] bg-black">
                      {c.thumbnail && <img src={api.mediaUrl(c.thumbnail)} className="h-full w-full object-cover" />}
                      <span className="chip absolute bottom-2 right-2 bg-black/70 text-ink">{formatTime(c.probe.durationSec)}</span>
                      <button
                        className="absolute right-2 top-2 hidden rounded-lg bg-black/70 p-1.5 text-ink-muted hover:text-danger group-hover:block"
                        onClick={() => edit((p) => removeClip(p, c.id))}
                        aria-label="Убрать клип из проекта"
                        title="Убрать из проекта (файл не удаляется)"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 p-2.5">
                      {editing === c.id ? (
                        <input
                          autoFocus
                          className="input h-7 w-full text-xs"
                          defaultValue={c.label}
                          onBlur={(e) => {
                            edit((p) => renameClip(p, c.id, e.target.value));
                            setEditing(null);
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        />
                      ) : (
                        <>
                          <span className="truncate text-xs font-semibold" title={`Файл: ${c.fileLabel}`}>
                            {c.label}
                          </span>
                          <button className="ml-auto hidden text-ink-faint hover:text-ink group-hover:block" onClick={() => setEditing(c.id)} aria-label="Переименовать">
                            <Pencil size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  className="flex aspect-[9/12] flex-col items-center justify-center gap-2 rounded-xl border border-line/60 text-ink-muted hover:border-accent/50 hover:text-ink"
                  onClick={() => api.pickFiles('video').then((f) => { if (f.length) void addClips(f); })}
                  disabled={!!clipJob}
                >
                  {clipJob ? <Spinner size={20} /> : <Upload size={22} />}
                  <span className="px-2 text-center text-xs font-semibold">{clipJob ? `Импорт ${Math.min(Math.round((clipProgress?.fraction ?? 0) * 100), 99)}%` : 'Drag & Drop Clips'}</span>
                  {clipJob && <ProgressBar value={clipProgress?.fraction ?? 0} className="mx-auto w-2/3" />}
                </button>
              </div>
              <div className="mt-3 text-[11px] text-ink-faint">Название клипа описывает его содержание («создание задачи», «статистика») — по нему клип сопоставляется с голосом. Оригиналы не изменяются.</div>
            </DropZone>
          </section>
        </div>
      </div>

      <footer className="flex h-24 shrink-0 items-center justify-between border-t border-line/60 px-8">
        <div className="flex items-center gap-4">
          <span className="label">Editing style</span>
          <Segmented value={project.editingStyle} onChange={setStyle} options={STYLE_OPTIONS} />
        </div>
        <button className="btn-primary h-14 rounded-2xl px-10 text-base" disabled={!canGenerate} onClick={() => runGenerate()}>
          <Sparkles size={18} /> Generate Reel
        </button>
      </footer>

      {needsDeps && <DependencyPanel reason={needsDeps} onClose={() => useGenerate.getState().set({ needsDeps: null })} />}
    </div>
  );
}
