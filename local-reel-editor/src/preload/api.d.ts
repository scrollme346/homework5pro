import type { IpcResult, JobProgress } from '../shared/api';

declare global {
  interface Window {
    reelBridge: {
      invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>>;
      pathForFile(file: File): string;
      onJobProgress(cb: (p: JobProgress) => void): () => void;
    };
  }
}
export {};
