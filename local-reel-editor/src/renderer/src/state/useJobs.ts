import { useEffect } from 'react';
import { api } from '../api';
import { useStore } from './store';

/** Routes backend job progress events into the store (mounted once in App). */
export function useJobProgressListener(): void {
  const setJob = useStore((s) => s.setJob);
  useEffect(() => api.onJobProgress((p) => setJob(p)), [setJob]);
}

export function useJob(jobId: string | null) {
  return useStore((s) => (jobId ? s.jobs[jobId] : undefined));
}
