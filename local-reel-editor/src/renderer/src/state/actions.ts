import { create } from 'zustand';
import { api, newJobId } from '../api';
import { useStore } from './store';

interface GenState {
  jobId: string | null;
  needsDeps: string | null;
  set(p: Partial<GenState>): void;
}

export const useGenerate = create<GenState>((set) => ({ jobId: null, needsDeps: null, set: (p) => set(p) }));

/** Runs transcription (if needed) + montage planning, showing the Generate screen. */
export async function runGenerate(opts: { variation?: boolean; retranscribe?: boolean } = {}): Promise<void> {
  const st = useStore.getState();
  const { dir, project } = st;
  if (!dir || !project) return;
  if (!project.transcript || opts.retranscribe) {
    const deps = await api.dependencies().catch(() => null);
    const ready = deps && deps.ffmpeg.found && deps.speechEngine.installed && deps.models[deps.selectedModel];
    if (!ready) {
      useGenerate.getState().set({ needsDeps: 'Чтобы распознать голос локально, нужен движок Whisper и модель. Это делается один раз.' });
      return;
    }
  }
  const back = st.screen;
  const jobId = newJobId('generate');
  useGenerate.getState().set({ jobId });
  st.setScreen('generating');
  try {
    const r = await api.generate(jobId, dir, project, opts);
    const s = useStore.getState();
    if (s.project && s.project.timeline && back === 'editor') {
      // Regenerate from the editor is undoable.
      s.edit(() => r.project);
    } else {
      s.load(r.project);
    }
    s.select(null);
    s.setScreen('editor');
  } catch (e) {
    useStore.getState().setScreen(back === 'generating' ? 'setup' : back);
    useStore.getState().showError(e, 'Ролик не собран');
  } finally {
    useGenerate.getState().set({ jobId: null });
    useStore.getState().setJob(null, jobId);
  }
}
