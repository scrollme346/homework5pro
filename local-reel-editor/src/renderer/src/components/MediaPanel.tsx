import { AlertCircle, Check, Mic } from 'lucide-react';
import { chooseSectionClip, confirmSection } from '@core/edit/ops';
import { formatTime } from '@core/util/math';
import { api } from '../api';
import { useStore } from '../state/store';
import { previewSeek } from './PreviewPlayer';
import { clipHue } from './Timeline';

/** Left column: review prompts for weak matches, the voice-over and the clips. */
export function MediaPanel() {
  const project = useStore((s) => s.project);
  const edit = useStore((s) => s.edit);
  const select = useStore((s) => s.select);
  if (!project) return null;
  const tl = project.timeline;
  const review = tl?.sections.filter((s) => s.needsReview) ?? [];
  const usage = new Map<string, number>();
  for (const s of tl?.segments ?? []) usage.set(s.sourceClip, (usage.get(s.sourceClip) ?? 0) + (s.endTime - s.startTime));

  return (
    <div className="space-y-5 p-4">
      {review.length > 0 && (
        <div className="space-y-3">
          {review.map((sec) => {
            const current = project.clips.find((c) => c.id === sec.clipId);
            const candidates = [sec.clipId, ...sec.candidates.map((c) => c.clipId), ...project.clips.map((c) => c.id)].filter((id, i, a) => a.indexOf(id) === i).slice(0, 4);
            return (
              <div key={sec.id} className="rounded-xl border border-warn/40 bg-warn/5 p-3 animate-fadeUp">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-warn">
                  <AlertCircle size={13} /> Which clip matches this section?
                </div>
                <button
                  className="mt-2 line-clamp-3 text-left text-xs leading-relaxed text-ink-muted hover:text-ink"
                  onClick={() => {
                    previewSeek(sec.start + 0.01);
                    const seg = tl!.segments.find((s) => s.sectionId === sec.id);
                    if (seg) select(seg.id);
                  }}
                >
                  {formatTime(sec.start)} · “{sec.text}”
                </button>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {candidates.map((id) => {
                    const c = project.clips.find((x) => x.id === id);
                    if (!c) return null;
                    const isCur = id === sec.clipId;
                    return (
                      <button
                        key={id}
                        className={`h-7 rounded-lg px-2.5 text-[11px] font-semibold ${isCur ? 'bg-surface-3 text-ink' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}
                        onClick={() => edit((p) => (isCur ? confirmSection(p, sec.id) : chooseSectionClip(p, sec.id, id)))}
                        title={isCur ? 'Оставить этот клип' : 'Использовать этот клип'}
                      >
                        {isCur && <Check size={11} className="mr-1 inline text-accent" />}
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                {current && <div className="mt-2 text-[10px] text-ink-faint">Сейчас: {current.label}. Ответ запомнится при повторной генерации.</div>}
              </div>
            );
          })}
        </div>
      )}

      {project.voice && (
        <div>
          <div className="label mb-2">Voice</div>
          <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-xs">
            <Mic size={14} className="text-accent" />
            <span className="truncate font-semibold">{project.voice.name}</span>
            <span className="ml-auto text-ink-faint">{formatTime(project.voice.probe.durationSec)}</span>
          </div>
          {project.transcript && <div className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-ink-faint">{project.transcript.text}</div>}
        </div>
      )}

      <div>
        <div className="label mb-2">Clips</div>
        <div className="space-y-2">
          {project.clips.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2">
              <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black">
                {c.thumbnail && <img src={api.mediaUrl(c.thumbnail)} className="h-full w-full object-cover" />}
                <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: `hsl(${clipHue(c.id)} 45% 45%)` }} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">{c.label}</div>
                <div className="mt-0.5 text-[11px] text-ink-faint">
                  {formatTime(c.probe.durationSec)} · {usage.get(c.id) ? `в ролике ${usage.get(c.id)!.toFixed(1)} с` : 'не используется'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
