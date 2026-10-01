import type { ClipAsset, Project, Segment, SfxEvent } from '@core/model/types';
import { sourceRect, viewportAt } from '@core/motion/MotionEngine';
import { CAPTION_Y, SAFE_ZONE, captionAt } from '@core/captions/CaptionEngine';
import { isAbsolutePath } from '@core/render/RenderPlan';
import { ease } from '@core/util/math';
import { api } from '../api';

const W = 540;
const H = 960;
const K = W / 1080; // preview px per output px

interface Slot {
  el: HTMLVideoElement;
  src: string;
  segId: string | null;
}

/**
 * Real-time preview: composes proxy videos on a canvas from the project
 * model (same viewport maths and easing as the FFmpeg renderer), with the
 * voice-over as master clock. Nothing is rendered to disk.
 */
export class PreviewEngine {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offB: HTMLCanvasElement;
  private slots: Slot[] = [];
  private audio = new Audio();
  private project: Project | null = null;
  private clips = new Map<string, ClipAsset>();
  private raf = 0;
  private playing = false;
  private time = 0;
  private actx: AudioContext | null = null;
  private sfxBuffers = new Map<string, AudioBuffer>();
  private scheduled: AudioBufferSourceNode[] = [];
  private sfxRoot = '';
  showSafeZone = false;
  onTime: (t: number) => void = () => undefined;
  onEnded: () => void = () => undefined;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.off = document.createElement('canvas');
    this.off.width = W;
    this.off.height = H;
    this.offB = document.createElement('canvas');
    this.offB.width = W;
    this.offB.height = H;
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => {
      this.pause();
      this.onEnded();
    });
    void api.info().then((i) => (this.sfxRoot = i.sfxRoot));
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setProject(p: Project): void {
    const voiceChanged = p.voice?.path !== this.project?.voice?.path;
    this.project = p;
    this.clips = new Map(p.clips.map((c) => [c.id, c]));
    if (voiceChanged && p.voice) {
      this.audio.src = api.mediaUrl(p.voice.path);
      this.audio.currentTime = this.time;
    }
    void this.loadSfx(p.timeline?.sfx ?? []);
    if (this.playing) this.scheduleSfx(this.time);
    this.draw(true);
  }

  get duration(): number {
    return this.project?.timeline?.duration ?? this.project?.voice?.probe.durationSec ?? 0;
  }

  async play(): Promise<void> {
    if (!this.project?.timeline || this.playing) return;
    if (this.time >= this.duration - 0.05) this.seek(0);
    this.playing = true;
    this.audio.currentTime = this.time;
    try {
      await this.audio.play();
    } catch {
      this.playing = false;
      return;
    }
    this.actx ??= new AudioContext();
    if (this.actx.state === 'suspended') await this.actx.resume();
    this.scheduleSfx(this.time);
  }

  pause(): void {
    this.playing = false;
    this.audio.pause();
    this.stopSfx();
    for (const s of this.slots) s.el.pause();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  seek(t: number): void {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.audio.currentTime = this.time;
    if (this.playing) this.scheduleSfx(this.time);
    this.onTime(this.time);
    this.draw(true);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.pause();
    this.audio.src = '';
    for (const s of this.slots) {
      s.el.removeAttribute('src');
      s.el.load();
    }
    this.slots = [];
    void this.actx?.close();
  }

  // ---------------------------------------------------------------- SFX

  private sfxUrl(file: string): string {
    return api.mediaUrl(isAbsolutePath(file) ? file : `${this.sfxRoot}/${file}`);
  }

  private async loadSfx(events: SfxEvent[]): Promise<void> {
    if (!this.sfxRoot) {
      this.sfxRoot = (await api.info()).sfxRoot;
    }
    this.actx ??= new AudioContext();
    for (const e of events) {
      if (this.sfxBuffers.has(e.file)) continue;
      try {
        const buf = await (await fetch(this.sfxUrl(e.file))).arrayBuffer();
        this.sfxBuffers.set(e.file, await this.actx.decodeAudioData(buf));
      } catch {
        /* missing file: QA reports it; preview just stays silent */
      }
    }
  }

  private stopSfx(): void {
    for (const s of this.scheduled) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.scheduled = [];
  }

  private scheduleSfx(from: number): void {
    this.stopSfx();
    const p = this.project;
    if (!p?.timeline || !p.render.sfxEnabled || !this.actx) return;
    const now = this.actx.currentTime;
    for (const e of p.timeline.sfx) {
      if (e.muted || e.time < from - 0.02) continue;
      const buf = this.sfxBuffers.get(e.file);
      if (!buf) continue;
      const src = this.actx.createBufferSource();
      src.buffer = buf;
      const gain = this.actx.createGain();
      gain.gain.value = Math.pow(10, e.gainDb / 20);
      src.connect(gain).connect(this.actx.destination);
      src.start(now + (e.time - from));
      this.scheduled.push(src);
    }
  }

  // ---------------------------------------------------------------- video pool

  private slotFor(seg: Segment): Slot | null {
    const clip = this.clips.get(seg.sourceClip);
    if (!clip) return null;
    const src = api.mediaUrl(clip.proxy ?? clip.path);
    let slot = this.slots.find((s) => s.segId === seg.id);
    if (slot) return slot;
    slot = this.slots.find((s) => s.segId === null && s.src === src) ?? this.slots.find((s) => s.segId === null);
    if (!slot) {
      if (this.slots.length >= 5) return null;
      const el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      slot = { el, src: '', segId: null };
      this.slots.push(slot);
    }
    if (slot.src !== src) {
      slot.src = src;
      slot.el.src = src;
    }
    slot.segId = seg.id;
    return slot;
  }

  private expectedSourceTime(seg: Segment, t: number): number {
    const clip = this.clips.get(seg.sourceClip);
    const dur = clip?.probe.durationSec ?? Infinity;
    return Math.max(0, Math.min(dur - 0.04, seg.sourceStart + (t - seg.startTime) * seg.speed));
  }

  /** Keeps video elements in sync with the master clock; pre-seeks the next shot. */
  private syncVideos(active: Segment[], upcoming: Segment | undefined, t: number): void {
    const keep = new Set([...active.map((s) => s.id), upcoming?.id].filter(Boolean) as string[]);
    for (const s of this.slots) {
      if (s.segId && !keep.has(s.segId)) {
        s.segId = null;
        s.el.pause();
      }
    }
    for (const seg of active) {
      const slot = this.slotFor(seg);
      if (!slot) continue;
      const want = this.expectedSourceTime(seg, t);
      const el = slot.el;
      el.playbackRate = seg.speed;
      const atEnd = want >= (this.clips.get(seg.sourceClip)?.probe.durationSec ?? Infinity) - 0.05;
      if (this.playing && !atEnd) {
        if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = want;
        if (el.paused) void el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.03) el.currentTime = want;
      }
    }
    if (upcoming) {
      const slot = this.slotFor(upcoming);
      if (slot && slot.el.paused && Math.abs(slot.el.currentTime - upcoming.sourceStart) > 0.05) slot.el.currentTime = upcoming.sourceStart;
    }
  }

  // ---------------------------------------------------------------- drawing

  /** Draws a segment's frame (fit + zoom/pan viewport) into `target`. */
  private compose(target: HTMLCanvasElement, seg: Segment, t: number): boolean {
    const ctx = target.getContext('2d')!;
    const slot = this.slots.find((s) => s.segId === seg.id);
    const clip = this.clips.get(seg.sourceClip);
    if (!slot || !clip || slot.el.readyState < 2) return false;
    const el = slot.el;
    const vw = el.videoWidth || clip.probe.width || 1080;
    const vh = el.videoHeight || clip.probe.height || 1920;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (clip.fitMode === 'blur-fit') {
      const cover = sourceRect('cover', vw, vh);
      ctx.filter = 'blur(14px) brightness(0.94) saturate(1.1)';
      ctx.drawImage(el, cover.x * W - 20, cover.y * H - 20, cover.w * W + 40, cover.h * H + 40);
      ctx.filter = 'none';
    }
    const r = sourceRect(clip.fitMode, vw, vh);
    ctx.drawImage(el, r.x * W, r.y * H, r.w * W, r.h * H);
    ctx.restore();
    // Apply the segment's zoom/pan viewport.
    this.applyViewport(target, viewportAt(seg, Math.min(t, seg.endTime)));
    return true;
  }

  private viewportCanvas = document.createElement('canvas');

  private applyViewport(src: HTMLCanvasElement, v: { scale: number; x: number; y: number }): void {
    if (v.scale <= 1.0005) return;
    const c = this.viewportCanvas;
    if (c.width !== W) {
      c.width = W;
      c.height = H;
    }
    const cctx = c.getContext('2d')!;
    cctx.drawImage(src, v.x * W, v.y * H, W / v.scale, H / v.scale, 0, 0, W, H);
    src.getContext('2d')!.drawImage(c, 0, 0);
  }

  private drawCaption(t: number): void {
    const p = this.project!;
    const cap = captionAt(p.timeline!.captions, t);
    if (!cap) return;
    const style = p.captionStyle;
    const ms = Math.max(60, Math.min(200, style.animationMs));
    const k = ((t - cap.start) * 1000) / ms;
    let s = 1;
    let a = 1;
    if (k < 0.6) {
      s = 0.95 + 0.07 * (k / 0.6);
      a = k / 0.6;
    } else if (k < 1) {
      s = 1.02 - 0.02 * ((k - 0.6) / 0.4);
    }
    const ctx = this.ctx;
    const fs = (cap.fontSize ?? style.fontSize) * K;
    ctx.save();
    ctx.translate(W / 2, CAPTION_Y[style.position] * K);
    ctx.scale(s, s);
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.font = `800 ${fs}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowOffsetX = ctx.shadowOffsetY = style.shadow * K;
    ctx.lineWidth = style.strokeWidth * 2 * K;
    ctx.strokeStyle = 'rgba(0,0,0,0.81)';
    ctx.strokeText(cap.text, 0, 0);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = style.color;
    ctx.fillText(cap.text, 0, 0);
    ctx.restore();
  }

  private drawSafeZone(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 80, 80, 0.13)';
    ctx.fillRect(0, 0, W, SAFE_ZONE.top * K);
    ctx.fillRect(0, H - SAFE_ZONE.bottom * K, W, SAFE_ZONE.bottom * K);
    ctx.fillRect(W - SAFE_ZONE.right * K, SAFE_ZONE.top * K, SAFE_ZONE.right * K, H - (SAFE_ZONE.top + SAFE_ZONE.bottom) * K);
    ctx.restore();
  }

  private draw(force = false): void {
    const p = this.project;
    const tl = p?.timeline;
    if (!tl || !tl.segments.length) {
      this.ctx.fillStyle = '#0A0A0B';
      this.ctx.fillRect(0, 0, W, H);
      return;
    }
    const t = this.time;
    const segs = tl.segments;
    let i = segs.findIndex((s) => t >= s.startTime && t < s.endTime);
    if (i < 0) i = t >= tl.duration ? segs.length - 1 : 0;
    const cur = segs[i];
    const prev = segs[i - 1];
    const inTransition = prev && prev.transitionOut.kind !== 'cut' && t < cur.startTime + prev.transitionOut.duration;
    const active = inTransition ? [prev, cur] : [cur];
    this.syncVideos(active, segs[i + 1], t);

    if (inTransition) {
      const okA = this.compose(this.offB, prev, t);
      const okB = this.compose(this.off, cur, t);
      if (!okA || !okB) {
        if (!force) return;
      }
      const d = prev.transitionOut.duration;
      const q = Math.max(0, Math.min(1, (t - cur.startTime) / d));
      // Same sine easing as the FFmpeg custom transitions (RenderPlan.xfadeTransition).
      const e = ease('inOut', q);
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      switch (prev.transitionOut.kind) {
        case 'slide-left':
          ctx.drawImage(this.offB, -e * W, 0);
          ctx.drawImage(this.off, (1 - e) * W, 0);
          break;
        case 'slide-up':
          ctx.drawImage(this.offB, 0, -e * H);
          ctx.drawImage(this.off, 0, (1 - e) * H);
          break;
        case 'zoom': {
          const za = 1 + 0.3 * e;
          const zb = 1.12 - 0.12 * e;
          ctx.globalAlpha = 1;
          ctx.drawImage(this.offB, (W - W * za) / 2, (H - H * za) / 2, W * za, H * za);
          ctx.globalAlpha = e;
          ctx.drawImage(this.off, (W - W * zb) / 2, (H - H * zb) / 2, W * zb, H * zb);
          break;
        }
        default:
          ctx.drawImage(this.offB, 0, 0);
          ctx.globalAlpha = q;
          ctx.drawImage(this.off, 0, 0);
      }
      ctx.restore();
    } else {
      if (!this.compose(this.off, cur, t) && !force) return;
      this.ctx.drawImage(this.off, 0, 0);
    }
    this.drawCaption(t);
    if (this.showSafeZone) this.drawSafeZone();
  }

  private lastReport = 0;

  private loop(): void {
    this.raf = requestAnimationFrame(this.loop);
    if (this.playing) {
      this.time = this.audio.currentTime;
      if (performance.now() - this.lastReport > 33) {
        this.lastReport = performance.now();
        this.onTime(this.time);
      }
    }
    this.draw();
  }
}
