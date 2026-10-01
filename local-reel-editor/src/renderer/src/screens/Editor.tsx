import { useState } from 'react';
import { ArrowLeft, Undo2, Redo2, Shuffle, RefreshCw, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { EditingStyle } from '@core/model/types';
import { useStore } from '../state/store';
import { runGenerate } from '../state/actions';
import { LocalBadge, Segmented } from '../components/ui';
import { PreviewPlayer } from '../components/PreviewPlayer';
import { Timeline } from '../components/Timeline';
import { Properties } from '../components/Properties';
import { MediaPanel } from '../components/MediaPanel';
import { ExportDialog } from '../components/ExportDialog';
import { STYLE_OPTIONS } from './Setup';

export function Editor() {
  const { project, past, future, undo, redo, edit, setScreen, goHome, saving } = useStore();
  const [exporting, setExporting] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  if (!project) return null;
  const warnings = project.qa.filter((q) => q.severity !== 'info' && !q.autoFixed);

  const setStyle = (editingStyle: EditingStyle) => {
    edit((p) => ({ ...p, editingStyle }));
    void runGenerate();
  };

  return (
    <div className="grid h-full grid-rows-[56px_minmax(0,1fr)_236px]">
      <header className="flex items-center justify-between gap-4 border-b border-line/60 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button className="btn-ghost h-9 w-9 px-0" onClick={goHome} aria-label="Домой">
            <ArrowLeft size={18} />
          </button>
          <button className="truncate text-sm font-bold hover:text-accent" onClick={() => setScreen('setup')} title="Вернуться к медиа проекта">
            {project.name}
          </button>
          <span className="text-[11px] text-ink-faint">{saving ? 'Сохранение…' : 'Сохранено'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="label mr-1">Editing style</span>
          <Segmented value={project.editingStyle} onChange={setStyle} options={STYLE_OPTIONS} />
          <button className="btn-ghost h-9 px-3 text-xs" onClick={() => runGenerate({ variation: true })} title="Другой вариант монтажа с теми же настройками">
            <Shuffle size={15} /> Variation
          </button>
          <button className="btn-ghost h-9 px-3 text-xs" onClick={() => runGenerate()} title="Пересобрать монтажный план">
            <RefreshCw size={15} /> Regenerate
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost h-9 w-9 px-0" onClick={undo} disabled={!past.length} title="Undo (Ctrl/Cmd+Z)">
            <Undo2 size={16} />
          </button>
          <button className="btn-ghost h-9 w-9 px-0" onClick={redo} disabled={!future.length} title="Redo (Ctrl/Cmd+Shift+Z)">
            <Redo2 size={16} />
          </button>
          <button className={`chip h-7 px-3 ${warnings.length ? 'bg-warn/15 text-warn' : 'bg-accent-soft text-accent'}`} onClick={() => setQaOpen(!qaOpen)}>
            {warnings.length ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} QA {warnings.length ? warnings.length : 'OK'}
          </button>
          <LocalBadge />
          <button className="btn-primary ml-1 h-10 px-5" onClick={() => setExporting(true)}>
            <Download size={16} /> Export Reel
          </button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 overflow-y-auto border-r border-line/60">
          <MediaPanel />
        </aside>
        <main className="relative min-h-0 p-5">
          <PreviewPlayer />
          {qaOpen && (
            <div className="panel absolute right-5 top-5 z-30 max-h-[70%] w-80 overflow-auto p-4 text-xs shadow-2xl animate-fadeUp">
              <div className="label mb-2">Quality check</div>
              {warnings.length === 0 ? (
                <div className="text-ink-muted">Пустых кадров нет, видео совпадает с голосом, субтитры в safe-zone.</div>
              ) : (
                <ul className="space-y-2">
                  {warnings.map((q, i) => (
                    <li key={i} className="flex gap-2">
                      <AlertTriangle size={12} className={`mt-0.5 shrink-0 ${q.severity === 'error' ? 'text-danger' : 'text-warn'}`} />
                      <span>
                        {q.message}
                        {q.time !== undefined && <span className="text-ink-faint"> · {q.time.toFixed(1)} с</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </main>
        <aside className="min-h-0 overflow-y-auto border-l border-line/60">
          <Properties />
        </aside>
      </div>

      <section className="min-h-0 border-t border-line/60 bg-surface">
        <Timeline />
      </section>

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}
