import { useEffect, useState } from 'react';
import { Volume2, VolumeX, RotateCcw } from 'lucide-react';
import type { CaptionPosition, TransitionKind } from '@core/model/types';
import type { SfxLibrary } from '@core/sfx/SfxPlanner';
import { replaceClip, replaceSfx, setCaptionPosition, setFocus, setSfxGain, setSfxMuted, setTransition, setZoom, slipSource, setSfxEnabled, ZOOM_MAX } from '@core/edit/ops';
import { formatTime } from '@core/util/math';
import { api } from '../api';
import { useStore } from '../state/store';
import { Segmented } from './ui';
import { SFX_ICON } from './Timeline';

const TRANSITIONS: { value: TransitionKind; label: string }[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'slide-left', label: 'Slide ←' },
  { value: 'slide-up', label: 'Slide ↑' },
  { value: 'zoom', label: 'Zoom' },
];

const POSITIONS: { value: CaptionPosition; label: string }[] = [
  { value: 'upper-center', label: 'Upper' },
  { value: 'center', label: 'Center' },
  { value: 'lower-center', label: 'Lower' },
];

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <label className="block">
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="font-semibold tabular-nums">{format(local)}</span>
      </div>
      <input
        type="range"
        className="w-full accent-[#3BE37F]"
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onChange(local)}
        onKeyUp={() => onChange(local)}
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line/40 px-5 py-4">
      <div className="label mb-3">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

const FOCUS_PRESETS: { label: string; x: number; y: number }[] = [
  { label: 'Верх', x: 0.5, y: 0.3 },
  { label: 'Центр', x: 0.5, y: 0.47 },
  { label: 'Низ', x: 0.5, y: 0.68 },
];

export function Properties() {
  const project = useStore((s) => s.project);
  const segId = useStore((s) => s.selectedSegmentId);
  const sfxId = useStore((s) => s.selectedSfxId);
  const edit = useStore((s) => s.edit);
  const [lib, setLib] = useState<SfxLibrary | null>(null);
  useEffect(() => {
    void api.sfxLibrary().then(setLib).catch(() => undefined);
  }, []);
  if (!project?.timeline) return null;
  const tl = project.timeline;
  const idx = tl.segments.findIndex((s) => s.id === segId);
  const seg = idx >= 0 ? tl.segments[idx] : null;

  const global = (
    <Section title="Reel">
      <div>
        <div className="mb-1.5 text-xs text-ink-muted">Позиция субтитров</div>
        <Segmented value={project.captionStyle.position} options={POSITIONS} onChange={(v) => edit((p) => setCaptionPosition(p, v))} />
      </div>
      <label className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">Звуковые эффекты</span>
        <input type="checkbox" className="h-4 w-4 accent-[#3BE37F]" checked={project.render.sfxEnabled} onChange={(e) => edit((p) => setSfxEnabled(p, e.target.checked))} />
      </label>
    </Section>
  );

  if (!seg) {
    return (
      <div>
        {global}
        <div className="px-5 py-6 text-xs leading-relaxed text-ink-faint">Выберите фрагмент на таймлайне, чтобы заменить клип, поправить zoom, переход или SFX.</div>
      </div>
    );
  }

  const clip = project.clips.find((c) => c.id === seg.sourceClip);
  const D = clip?.probe.durationSec ?? 0;
  const need = (seg.endTime - seg.startTime) * seg.speed;
  const next = tl.segments[idx + 1];
  const segSfx = tl.sfx.filter((e) => seg.sfx.includes(e.id));

  return (
    <div>
      <Section title={`Фрагмент ${idx + 1} · ${formatTime(seg.startTime)}–${formatTime(seg.endTime)}`}>
        <div className="rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-ink-muted">“{seg.transcript || '…'}”</div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-ink-muted">Клип</span>
            <span className={`font-semibold ${seg.confidence < 0.45 ? 'text-warn' : 'text-ink-faint'}`}>совпадение {Math.round(seg.confidence * 100)}%</span>
          </div>
          <select className="input w-full" value={seg.sourceClip} onChange={(e) => edit((p) => replaceClip(p, seg.id, e.target.value))}>
            {project.clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {D > need + 0.05 && (
          <Slider label="Участок клипа (начало)" value={seg.sourceStart} min={0} max={Math.max(0, D - need)} step={0.05} format={(v) => `${v.toFixed(2)} с`} onChange={(v) => edit((p) => slipSource(p, seg.id, v))} />
        )}
      </Section>

      <Section title="Zoom / Motion">
        <Slider label="Zoom в начале" value={seg.scaleStart} min={1} max={ZOOM_MAX} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((p) => setZoom(p, seg.id, v, seg.scaleEnd))} />
        <Slider label="Zoom в конце" value={seg.scaleEnd} min={1} max={ZOOM_MAX} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((p) => setZoom(p, seg.id, seg.scaleStart, v))} />
        <div>
          <div className="mb-1.5 text-xs text-ink-muted">Фокус</div>
          <div className="flex gap-1.5">
            {FOCUS_PRESETS.map((f) => (
              <button key={f.label} className="btn-outline h-7 flex-1 px-2 text-xs" onClick={() => edit((p) => setFocus(p, seg.id, { x: f.x, y: f.y }, { x: f.x, y: f.y }))}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-ghost h-7 px-2 text-xs" onClick={() => edit((p) => setZoom(p, seg.id, 1, 1))}>
          <RotateCcw size={12} /> Без zoom
        </button>
      </Section>

      {next && (
        <Section title="Переход к следующему">
          <div className="flex flex-wrap gap-1.5">
            {TRANSITIONS.map((t) => (
              <button
                key={t.value}
                className={`h-7 rounded-lg px-2.5 text-xs font-semibold ${seg.transitionOut.kind === t.value ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}
                onClick={() => edit((p) => setTransition(p, seg.id, t.value))}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-ink-faint">По умолчанию — обычная склейка. Переход нужен, только если он помогает.</div>
        </Section>
      )}

      <Section title="SFX">
        {segSfx.length === 0 && <div className="text-xs text-ink-faint">В этом фрагменте нет эффектов.</div>}
        {segSfx.map((e) => {
          const Icon = SFX_ICON[e.category];
          const options = lib ? [...lib.click, ...lib.pop, ...lib.whoosh, ...lib.impact] : [e.file];
          return (
            <div key={e.id} className={`rounded-lg p-2.5 ${sfxId === e.id ? 'bg-surface-3' : 'bg-surface-2'}`}>
              <div className="flex items-center gap-2 text-xs">
                <Icon size={13} className="text-accent" />
                <span className="font-semibold capitalize">{e.category}</span>
                <span className="text-ink-faint">{formatTime(e.time)} · {e.reason}</span>
                <button className="ml-auto text-ink-muted hover:text-ink" onClick={() => edit((p) => setSfxMuted(p, e.id, !e.muted))} aria-label={e.muted ? 'Включить' : 'Выключить'}>
                  {e.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              </div>
              <select className="input mt-2 h-7 w-full text-xs" value={e.file} onChange={(ev) => edit((p) => replaceSfx(p, e.id, ev.target.value))}>
                {options.map((f) => (
                  <option key={f} value={f}>
                    {f.split(/[\\/]/).slice(-2).join('/')}
                  </option>
                ))}
              </select>
              <div className="mt-2">
                <Slider label="Громкость" value={e.gainDb} min={-30} max={-10} step={0.5} format={(v) => `${v} dB`} onChange={(v) => edit((p) => setSfxGain(p, e.id, v))} />
              </div>
            </div>
          );
        })}
      </Section>
      {global}
    </div>
  );
}
