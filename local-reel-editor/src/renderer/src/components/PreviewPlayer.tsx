import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, Grid3x3 } from 'lucide-react';
import { formatTime } from '@core/util/math';
import { PreviewEngine } from '../preview/PreviewEngine';
import { useStore, usePlayback } from '../state/store';

let engineRef: PreviewEngine | null = null;
/** Lets the timeline seek without prop-drilling. */
export const previewSeek = (t: number) => engineRef?.seek(t);
export const previewToggle = () => {
  if (!engineRef) return;
  if (engineRef.isPlaying) engineRef.pause();
  else void engineRef.play();
  usePlayback.getState().setPlaying(engineRef.isPlaying);
};

export function PreviewPlayer() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const project = useStore((s) => s.project);
  const { time, playing, setTime, setPlaying } = usePlayback();
  const [safe, setSafe] = useState(false);

  useEffect(() => {
    const engine = new PreviewEngine(canvas.current!);
    engine.onTime = (t) => setTime(t);
    engine.onEnded = () => setPlaying(false);
    engineRef = engine;
    return () => {
      engine.destroy();
      engineRef = null;
      setPlaying(false);
    };
  }, [setTime, setPlaying]);

  useEffect(() => {
    if (project) engineRef?.setProject(project);
  }, [project]);

  useEffect(() => {
    if (engineRef) engineRef.showSafeZone = safe;
    engineRef?.seek(usePlayback.getState().time);
  }, [safe]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        previewToggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const duration = project?.timeline?.duration ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3">
      <div className="relative aspect-[9/16] h-full max-h-full min-h-0 overflow-hidden rounded-2xl bg-black shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-line/60">
        <canvas ref={canvas} className="h-full w-full cursor-pointer" onClick={previewToggle} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button className="btn-ghost h-9 w-9 px-0" onClick={() => previewSeek(0)} aria-label="В начало">
          <SkipBack size={16} />
        </button>
        <button className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-bg hover:bg-white" onClick={previewToggle} aria-label={playing ? 'Пауза' : 'Играть'}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
        </button>
        <div className="w-24 text-center font-mono text-xs tabular-nums text-ink-muted">
          {formatTime(time)} / {formatTime(duration)}
        </div>
        <button className={`btn-ghost h-9 w-9 px-0 ${safe ? 'text-accent' : ''}`} onClick={() => setSafe(!safe)} title="Показать safe-zone Reels" aria-label="Safe zone">
          <Grid3x3 size={16} />
        </button>
      </div>
    </div>
  );
}
