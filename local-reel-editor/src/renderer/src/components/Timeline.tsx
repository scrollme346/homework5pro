import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import { MousePointerClick, Sparkle, Wind, Zap, ZoomIn, ZoomOut, AlertCircle } from 'lucide-react';
import type { SfxCategory } from '@core/model/types';
import { moveCut, swapSegments } from '@core/edit/ops';
import { formatTime } from '@core/util/math';
import { useStore, usePlayback } from '../state/store';
import { previewSeek } from './PreviewPlayer';
import { api } from '../api';

const LABEL_W = 84;
const ROWS = { captions: 30, video: 64, voice: 44, sfx: 30 };

export const SFX_ICON: Record<SfxCategory, typeof Zap> = { click: MousePointerClick, pop: Sparkle, whoosh: Wind, impact: Zap };

/** Stable, muted hue per clip so the same clip reads the same everywhere. */
export function clipHue(clipId: string): number {
  let h = 0;
  for (const ch of clipId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

function Playhead({ pps }: { pps: number }) {
  const time = usePlayback((s) => s.time);
  return <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-accent" style={{ left: time * pps }}><div className="absolute -left-[5px] -top-1 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-accent" /></div>;
}

export function Timeline() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selectedSegmentId);
  const selectedSfx = useStore((s) => s.selectedSfxId);
  const { select, selectSfx, edit } = useStore();
  const scroller = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(40);
  const [drag, setDrag] = useState<{ kind: 'cut'; segId: string; t: number } | { kind: 'move'; segId: string; overId: string | null } | null>(null);
  const tl = project?.timeline;
  const duration = tl?.duration ?? 0;

  // Fit the whole reel on first show.
  useEffect(() => {
    const w = scroller.current?.clientWidth ?? 800;
    if (duration > 0) setPps(Math.max(12, Math.min(200, (w - LABEL_W - 24) / duration)));
  }, [duration]);

  const clipMap = useMemo(() => new Map(project?.clips.map((c) => [c.id, c]) ?? []), [project?.clips]);
  if (!project || !tl) return null;

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_W;
    return Math.max(0, Math.min(duration, x / pps));
  };

  const onBackgroundDown = (e: RMouseEvent) => {
    if (e.button !== 0) return;
    previewSeek(timeAt(e.clientX));
    const move = (ev: MouseEvent) => previewSeek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startCutDrag = (e: RMouseEvent, segId: string) => {
    e.stopPropagation();
    e.preventDefault();
    let t = timeAt(e.clientX);
    setDrag({ kind: 'cut', segId, t });
    const move = (ev: MouseEvent) => {
      t = timeAt(ev.clientX);
      setDrag({ kind: 'cut', segId, t });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      edit((p) => moveCut(p, segId, t));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startMoveDrag = (e: RMouseEvent, segId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(segId);
    const x0 = e.clientX;
    let over: string | null = null;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - x0) < 6 && !moved) return;
      moved = true;
      const t = timeAt(ev.clientX);
      over = tl.segments.find((s) => t >= s.startTime && t < s.endTime)?.id ?? null;
      setDrag({ kind: 'move', segId, overId: over });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      if (moved && over && over !== segId) edit((p) => swapSegments(p, segId, over!));
      else if (!moved) previewSeek(tl.segments.find((s) => s.id === segId)!.startTime + 0.01);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const width = duration * pps;
  const peaks = project.voice?.peaks ?? [];
  const pk = project.voice?.peaksPerSecond ?? 100;
  const step = Math.max(1, Math.round(pk / Math.max(1, pps / 3)));
  const wave: number[] = [];
  for (let i = 0; i < peaks.length; i += step) wave.push(Math.max(...peaks.slice(i, i + step)));
  const waveMax = Math.max(0.01, ...wave);
  const tick = pps > 80 ? 1 : pps > 30 ? 2 : pps > 15 ? 5 : 10;

  const row = (label: string, h: number, children: React.ReactNode) => (
    <div className="relative flex border-b border-line/40" style={{ height: h }}>
      <div className="label sticky left-0 z-30 flex shrink-0 items-center bg-surface pl-4" style={{ width: LABEL_W }}>
        {label}
      </div>
      <div className="relative" style={{ width }}>
        {children}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line/40 px-4">
        <div className="label">Timeline</div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost h-7 w-7 px-0" onClick={() => setPps((p) => Math.max(8, p / 1.4))} aria-label="Уменьшить">
            <ZoomOut size={14} />
          </button>
          <button className="btn-ghost h-7 w-7 px-0" onClick={() => setPps((p) => Math.min(300, p * 1.4))} aria-label="Увеличить">
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden" onMouseDown={onBackgroundDown}>
        <div className="relative" style={{ width: width + LABEL_W + 24 }}>
          {/* Ruler */}
          <div className="relative flex h-6 border-b border-line/40">
            <div className="sticky left-0 z-30 shrink-0 bg-surface" style={{ width: LABEL_W }} />
            <div className="relative" style={{ width }}>
              {Array.from({ length: Math.floor(duration / tick) + 1 }, (_, i) => (
                <div key={i} className="absolute top-0 h-full border-l border-line/60 pl-1 text-[10px] tabular-nums text-ink-faint" style={{ left: i * tick * pps }}>
                  {formatTime(i * tick)}
                </div>
              ))}
            </div>
          </div>

          {row(
            'Captions',
            ROWS.captions,
            tl.captions.map((c) => (
              <div
                key={c.id}
                className="absolute top-1.5 flex h-[18px] items-center overflow-hidden rounded-[5px] bg-surface-3 px-1 text-[9px] font-bold text-ink-muted"
                style={{ left: c.start * pps, width: Math.max(2, (c.end - c.start) * pps - 1) }}
                title={c.text}
              >
                {(c.end - c.start) * pps > 26 ? c.text : ''}
              </div>
            )),
          )}

          {row(
            'Video',
            ROWS.video,
            <>
              {tl.segments.map((s, i) => {
                const clip = clipMap.get(s.sourceClip);
                const hue = clipHue(s.sourceClip);
                const isSel = s.id === selected;
                const isOver = drag?.kind === 'move' && drag.overId === s.id && drag.segId !== s.id;
                const section = tl.sections.find((x) => x.id === s.sectionId);
                const review = section?.needsReview;
                const left = s.startTime * pps;
                const w = (s.endTime - s.startTime) * pps;
                return (
                  <div key={s.id}>
                    <div
                      onMouseDown={(e) => startMoveDrag(e, s.id)}
                      className={`absolute top-1.5 cursor-grab overflow-hidden rounded-lg border transition-[border-color] ${isSel ? 'z-10 border-accent' : isOver ? 'border-ink' : 'border-transparent'}`}
                      style={{ left: left + 1, width: Math.max(4, w - 2), height: ROWS.video - 12, background: `hsl(${hue} 22% 20%)` }}
                      title={`${clip?.label ?? '?'} · ${s.transcript}`}
                    >
                      {clip?.thumbnail && <img src={api.mediaUrl(clip.thumbnail)} className="absolute inset-y-0 left-0 h-full w-auto opacity-50" draggable={false} />}
                      <div className="relative flex h-full flex-col justify-between p-1.5 pl-2">
                        <div className="flex items-center gap-1 truncate text-[11px] font-semibold text-ink drop-shadow">
                          {review && <AlertCircle size={11} className="shrink-0 text-warn" />}
                          {w > 40 ? clip?.label : ''}
                        </div>
                        {w > 50 && (
                          <div className="text-[9px] font-semibold tabular-nums text-ink-muted drop-shadow">
                            {Math.round(Math.max(s.scaleStart, s.scaleEnd) * 100)}%{s.scaleStart !== s.scaleEnd ? ' ↗' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                    {i < tl.segments.length - 1 && (
                      <div
                        className="group absolute top-0 z-20 flex h-full w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center"
                        style={{ left: (drag?.kind === 'cut' && drag.segId === s.id ? drag.t : s.endTime) * pps }}
                        onMouseDown={(e) => startCutDrag(e, s.id)}
                        title="Перетащите, чтобы сдвинуть склейку"
                      >
                        <div className={`h-8 w-[3px] rounded-full ${s.transitionOut.kind !== 'cut' ? 'bg-accent' : 'bg-transparent group-hover:bg-ink/70'}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </>,
          )}

          {row(
            'Voice',
            ROWS.voice,
            <svg className="absolute inset-0" width={width} height={ROWS.voice} preserveAspectRatio="none" viewBox={`0 0 ${wave.length} ${ROWS.voice}`}>
              {wave.map((v, i) => {
                const h = Math.max(1, (v / waveMax) * (ROWS.voice - 10));
                return <rect key={i} x={i} y={(ROWS.voice - h) / 2} width={0.75} height={h} fill="#3BE37F" opacity={0.75} />;
              })}
            </svg>,
          )}

          {row(
            'SFX',
            ROWS.sfx,
            tl.sfx.map((e) => {
              const Icon = SFX_ICON[e.category];
              return (
                <button
                  key={e.id}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  onClick={() => {
                    selectSfx(e.id);
                    const seg = tl.segments.find((s) => s.sfx.includes(e.id));
                    if (seg) useStore.setState({ selectedSegmentId: seg.id, selectedSfxId: e.id });
                  }}
                  className={`absolute top-1 flex h-[22px] w-[22px] -translate-x-1/2 items-center justify-center rounded-full border ${e.muted ? 'border-line text-ink-faint' : 'border-accent/50 bg-accent-soft text-accent'} ${selectedSfx === e.id ? 'ring-2 ring-accent' : ''}`}
                  style={{ left: e.time * pps }}
                  title={`${e.category} · ${e.reason} · ${e.gainDb} dB${e.muted ? ' (muted)' : ''}`}
                >
                  <Icon size={11} />
                </button>
              );
            }),
          )}
          <div className="pointer-events-none absolute bottom-0 top-0" style={{ left: LABEL_W }}>
            <Playhead pps={pps} />
          </div>
        </div>
      </div>
    </div>
  );
}
