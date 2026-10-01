import { create } from 'zustand';
import type { Project, QaIssue } from '@core/model/types';
import type { ErrorInfo, JobProgress } from '@shared/api';
import { checkTimeline } from '@core/qa/QualityChecker';
import { checkAudio } from '@core/qa/QualityChecker';
import { PRESETS } from '@core/planner/presets';
import { api, toErrorInfo } from '../api';

export type Screen = 'home' | 'setup' | 'generating' | 'editor';

interface State {
  screen: Screen;
  dir: string | null;
  project: Project | null;
  past: Project[];
  future: Project[];
  selectedSegmentId: string | null;
  selectedSfxId: string | null;
  error: (ErrorInfo & { title?: string }) | null;
  jobs: Record<string, JobProgress>;
  saving: boolean;

  open(dir: string, project: Project, screen?: Screen): void;
  goHome(): void;
  setScreen(s: Screen): void;
  /** Replace the project from a backend result (not an undoable edit). */
  load(project: Project): void;
  /** Undoable edit. */
  edit(fn: (p: Project) => Project): void;
  undo(): void;
  redo(): void;
  select(segmentId: string | null): void;
  selectSfx(id: string | null): void;
  showError(e: unknown, title?: string): void;
  clearError(): void;
  setJob(p: JobProgress | null, jobId?: string): void;
}

const HISTORY_LIMIT = 100;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Recomputes QA after manual edits (cheap; pure core code). */
function withQa(p: Project): Project {
  if (!p.timeline || !p.transcript || !p.voice) return p;
  const tl = structuredClone(p.timeline);
  const qa = checkTimeline(tl, p.transcript.words, new Map(p.clips.map((c) => [c.id, c])), p.voice.probe.durationSec, PRESETS[p.editingStyle], p.captionStyle.position);
  return { ...p, qa: [...checkAudio(p), ...qa.filter((q) => !q.autoFixed)] as QaIssue[] };
}

export const useStore = create<State>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const { dir, project } = get();
      if (!dir || !project) return;
      set({ saving: true });
      try {
        await api.saveProject(dir, project);
      } catch (e) {
        get().showError(e, 'Проект не сохранён');
      } finally {
        set({ saving: false });
      }
    }, 600);
  };

  return {
    screen: 'home',
    dir: null,
    project: null,
    past: [],
    future: [],
    selectedSegmentId: null,
    selectedSfxId: null,
    error: null,
    jobs: {},
    saving: false,

    open: (dir, project, screen) =>
      set({ dir, project, past: [], future: [], selectedSegmentId: null, selectedSfxId: null, screen: screen ?? (project.timeline ? 'editor' : 'setup') }),
    goHome: () => set({ screen: 'home', dir: null, project: null, past: [], future: [], selectedSegmentId: null }),
    setScreen: (screen) => set({ screen }),
    load: (project) => set({ project }),
    edit: (fn) => {
      const cur = get().project;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      set({ project: withQa(next), past: [...get().past, cur].slice(-HISTORY_LIMIT), future: [] });
      scheduleSave();
    },
    undo: () => {
      const { past, project, future } = get();
      if (!past.length || !project) return;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
      scheduleSave();
    },
    redo: () => {
      const { past, project, future } = get();
      if (!future.length || !project) return;
      set({ project: future[0], future: future.slice(1), past: [...past, project] });
      scheduleSave();
    },
    select: (selectedSegmentId) => set({ selectedSegmentId, selectedSfxId: null }),
    selectSfx: (selectedSfxId) => set({ selectedSfxId }),
    showError: (e, title) => {
      const info = toErrorInfo(e);
      if (info.code === 'cancelled') return;
      set({ error: { ...info, title } });
    },
    clearError: () => set({ error: null }),
    setJob: (p, jobId) => {
      const jobs = { ...get().jobs };
      if (p) jobs[p.jobId] = p;
      else if (jobId) delete jobs[jobId];
      set({ jobs });
    },
  };
});

/** Playback state lives in its own store so the playhead does not re-render the whole app. */
interface PlaybackState {
  time: number;
  playing: boolean;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
}

export const usePlayback = create<PlaybackState>((set) => ({
  time: 0,
  playing: false,
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
}));
