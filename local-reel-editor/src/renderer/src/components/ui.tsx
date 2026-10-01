import { useState, type ReactNode } from 'react';
import { ShieldCheck, X, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useStore } from '../state/store';

export function LocalBadge() {
  return (
    <span className="chip bg-accent-soft text-accent" title="Видео и голос обрабатываются только на этом компьютере. Ничего не отправляется на сервер.">
      <ShieldCheck size={13} strokeWidth={2.4} /> Local processing
    </span>
  );
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-accent" />;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeUp" onMouseDown={onClose}>
      <div className={`panel max-h-[86vh] overflow-auto p-6 shadow-2xl ${wide ? 'w-[720px]' : 'w-[480px]'}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          {onClose && (
            <button className="btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="Закрыть">
              <X size={16} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Friendly error with optional technical details ("Show details"). */
export function ErrorDialog() {
  const error = useStore((s) => s.error);
  const clear = useStore((s) => s.clearError);
  const [open, setOpen] = useState(false);
  if (!error) return null;
  return (
    <Modal title={error.title ?? 'Не получилось'} onClose={clear}>
      <p className="text-sm leading-relaxed text-ink">{error.message}</p>
      {error.details && (
        <div className="mt-4">
          <button className="flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Show details
          </button>
          {open && (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-[11px] leading-snug text-ink-muted select-text">{error.details}</pre>
          )}
        </div>
      )}
      <div className="mt-6 flex justify-end">
        <button className="btn-primary" onClick={clear}>
          Понятно
        </button>
      </div>
    </Modal>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-lg px-3.5 text-[13px] font-semibold transition-colors ${value === o.value ? 'bg-surface-3 text-ink shadow' : 'text-ink-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Waveform({ peaks, height = 48, color = '#3BE37F', className = '' }: { peaks: number[]; height?: number; color?: string; className?: string }) {
  const bars = 160;
  const step = Math.max(1, Math.floor(peaks.length / bars));
  const values: number[] = [];
  for (let i = 0; i < peaks.length; i += step) values.push(Math.max(...peaks.slice(i, i + step)));
  const max = Math.max(0.01, ...values);
  return (
    <svg className={className} viewBox={`0 0 ${values.length} ${height}`} preserveAspectRatio="none" style={{ height }}>
      {values.map((v, i) => {
        const h = Math.max(1.5, (v / max) * (height - 4));
        return <rect key={i} x={i + 0.15} y={(height - h) / 2} width={0.7} height={h} rx={0.35} fill={color} />;
      })}
    </svg>
  );
}
