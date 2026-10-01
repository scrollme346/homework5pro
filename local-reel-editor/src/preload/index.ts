import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcResult, JobProgress } from '@shared/api';

/**
 * Minimal bridge. Results come back as plain {ok, value | error} objects so
 * error details survive the context boundary; the typed API lives in the UI.
 */
const bridge = {
  invoke: <T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> => ipcRenderer.invoke(channel, ...args),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  onJobProgress: (cb: (p: JobProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: JobProgress) => cb(p);
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  },
};

export type ReelBridge = typeof bridge;
contextBridge.exposeInMainWorld('reelBridge', bridge);
