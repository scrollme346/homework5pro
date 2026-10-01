import { useEffect, useState } from 'react';
import { Plus, FolderOpen, Film, Trash2, Settings2 } from 'lucide-react';
import type { ProjectSummary } from '@shared/api';
import { formatTime } from '@core/util/math';
import { api } from '../api';
import { useStore } from '../state/store';
import { LocalBadge } from '../components/ui';
import { DependencyPanel, depsReady, useDependencies } from '../components/DependencyPanel';

function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'только что';
  if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
  return new Date(iso).toLocaleDateString();
}

export function Home() {
  const open = useStore((s) => s.open);
  const showError = useStore((s) => s.showError);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [showDeps, setShowDeps] = useState(false);
  const { deps, refresh } = useDependencies();

  const load = () => api.listProjects().then(setProjects).catch((e) => showError(e));
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    try {
      const r = await api.createProject(name || 'New Reel');
      open(r.dir, r.project, 'setup');
    } catch (e) {
      showError(e, 'Проект не создан');
    }
  };

  const openFile = async () => {
    try {
      const r = await api.openProjectFile();
      if (r) open(r.dir, r.project);
    } catch (e) {
      showError(e, 'Проект не открыт');
    }
  };

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Удалить проект «${p.name}»? Ваши исходные видео и аудио не будут затронуты.`)) return;
    try {
      await api.deleteProject(p.dir);
      await load();
    } catch (e) {
      showError(e);
    }
  };

  const ready = depsReady(deps, true);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-10 pb-16 pt-12">
        <header className="flex items-center justify-between">
          <LocalBadge />
          <button className={`chip ${ready ? 'bg-surface-2 text-ink-muted' : 'bg-warn/15 text-warn'} h-7 px-3`} onClick={() => setShowDeps(true)}>
            <Settings2 size={13} /> {deps === null ? 'Компоненты…' : ready ? 'Компоненты готовы' : 'Настроить компоненты'}
          </button>
        </header>

        <section className="mt-16 animate-fadeUp">
          <h1 className="text-[64px] font-extrabold leading-[0.95] tracking-[-0.03em]">
            LOCAL REEL
            <br />
            <span className="text-accent">EDITOR</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted">
            Голос + записи экрана → готовый вертикальный Reel. Монтаж, субтитры и звук — автоматически и полностью на вашем компьютере.
          </p>

          <div className="mt-10 flex items-center gap-3">
            {naming ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <input autoFocus className="input h-14 w-80 rounded-2xl text-base" placeholder="Название ролика" value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn-primary h-14 rounded-2xl px-8 text-base" type="submit">
                  Создать
                </button>
                <button className="btn-ghost h-14" type="button" onClick={() => setNaming(false)}>
                  Отмена
                </button>
              </form>
            ) : (
              <button className="btn-primary h-14 rounded-2xl px-8 text-base" onClick={() => setNaming(true)}>
                <Plus size={20} strokeWidth={2.6} /> New Reel
              </button>
            )}
            <button className="btn-ghost h-14" onClick={openFile}>
              <FolderOpen size={18} /> Открыть проект…
            </button>
          </div>
        </section>

        <section className="mt-20">
          <div className="label mb-4">Recent Projects</div>
          {projects === null ? null : projects.length === 0 ? (
            <div className="panel flex items-center gap-4 p-6 text-sm text-ink-muted">
              <Film size={20} /> Пока нет проектов. Нажмите New Reel, чтобы начать.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {projects.map((p) => (
                <div
                  key={p.dir}
                  role="button"
                  tabIndex={0}
                  onClick={() => api.openProject(p.dir).then((r) => open(r.dir, r.project)).catch((e) => showError(e, 'Проект не открыт'))}
                  className="panel group cursor-pointer overflow-hidden text-left transition-colors hover:border-accent/50"
                >
                  <div className="relative aspect-[4/5] bg-surface-2">
                    {p.thumbnail ? <img src={api.mediaUrl(p.thumbnail)} className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" /> : <div className="flex h-full items-center justify-center text-ink-faint"><Film /></div>}
                    {p.hasTimeline && <span className="chip absolute left-3 top-3 bg-black/60 text-accent">Смонтирован</span>}
                    <button
                      className="absolute right-2 top-2 hidden rounded-lg bg-black/60 p-2 text-ink-muted hover:text-danger group-hover:block"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(p);
                      }}
                      aria-label="Удалить проект"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="p-4">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="mt-1 text-xs text-ink-muted">
                      {p.duration ? formatTime(p.duration) : '—'} · {p.clipCount} клип. · {timeAgo(p.updatedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {showDeps && (
        <DependencyPanel
          onClose={() => {
            setShowDeps(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
