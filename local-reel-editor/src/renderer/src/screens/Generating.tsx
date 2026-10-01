import { Check } from 'lucide-react';
import type { GenerateStage } from '@shared/api';
import { api } from '../api';
import { useGenerate } from '../state/actions';
import { useJob } from '../state/useJobs';
import { LocalBadge, ProgressBar, Spinner } from '../components/ui';

const STAGES: { id: GenerateStage; label: string }[] = [
  { id: 'transcribing', label: 'Transcribing voice...' },
  { id: 'understanding', label: 'Understanding clips...' },
  { id: 'story', label: 'Building story...' },
  { id: 'motion', label: 'Adding motion...' },
  { id: 'sound', label: 'Adding sound design...' },
  { id: 'captions', label: 'Creating captions...' },
  { id: 'preview', label: 'Preparing preview...' },
];

export function Generating() {
  const jobId = useGenerate((s) => s.jobId);
  const job = useJob(jobId);
  const current = STAGES.findIndex((s) => s.id === job?.stage);
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="w-[420px] animate-fadeUp">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight">Собираем ролик</h1>
          <LocalBadge />
        </div>
        <ol className="space-y-3">
          {STAGES.map((s, i) => {
            const done = current > i;
            const active = current === i || (current < 0 && i === 0);
            return (
              <li key={s.id} className={`flex items-center gap-3 text-[15px] ${done ? 'text-ink-muted' : active ? 'font-semibold text-ink' : 'text-ink-faint'}`}>
                <span className="flex h-6 w-6 items-center justify-center">{done ? <Check size={16} className="text-accent" /> : active ? <Spinner /> : <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" />}</span>
                {s.label}
              </li>
            );
          })}
        </ol>
        {job?.stage === 'transcribing' && <ProgressBar value={job.fraction} className="mt-6" />}
        <div className="mt-10 flex justify-center">
          <button className="btn-ghost" onClick={() => jobId && api.cancelJob(jobId)}>
            Отменить
          </button>
        </div>
      </div>
    </div>
  );
}
