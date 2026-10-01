import type { ClipAsset, Project, QaIssue, Segment, Timeline, Word } from '../model/types';
import type { StylePreset } from '../planner/presets';
import { CAPTION_MAX_WIDTH, CAPTION_Y, SAFE_ZONE, approxMeasure, type MeasureText } from '../captions/CaptionEngine';
import { FRAME_H } from '../motion/MotionEngine';
import { round3 } from '../util/math';

const EPS = 0.02;

/**
 * Montage QA (spec §37–§39). Fixes what it safely can (gaps, overlaps,
 * timeline end) and reports everything else.
 */
export function checkTimeline(
  timeline: Timeline,
  words: Word[],
  clips: Map<string, ClipAsset>,
  voiceDuration: number,
  preset: StylePreset,
  captionPosition: keyof typeof CAPTION_Y,
  measure: MeasureText = approxMeasure,
): QaIssue[] {
  const issues: QaIssue[] = [];
  const segs = timeline.segments;

  if (!segs.length) {
    issues.push({ code: 'empty-timeline', severity: 'error', message: 'Монтажный план пуст.' });
    return issues;
  }

  // Coverage: no empty frames, starts at 0, ends with the voice.
  if (Math.abs(segs[0].startTime) > EPS) {
    segs[0].startTime = 0;
    issues.push({ code: 'gap-start', severity: 'info', message: 'Начало заполнено первым клипом.', autoFixed: true });
  }
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i];
    const b = segs[i + 1];
    if (Math.abs(a.endTime - b.startTime) > 1e-3) {
      a.endTime = b.startTime;
      issues.push({ code: 'gap', severity: 'info', message: 'Устранён разрыв между фрагментами.', time: b.startTime, autoFixed: true });
    }
  }
  const last = segs[segs.length - 1];
  if (Math.abs(last.endTime - voiceDuration) > EPS) {
    last.endTime = round3(voiceDuration);
    issues.push({ code: 'duration', severity: 'info', message: 'Длительность видео выровнена по voice-over.', autoFixed: true });
  }
  timeline.duration = round3(voiceDuration);

  for (const s of segs) {
    if (s.endTime - s.startTime < 0.2) {
      issues.push({ code: 'tiny-segment', severity: 'warning', message: 'Очень короткий фрагмент (< 0.2 с).', time: s.startTime });
    }
    const clip = clips.get(s.sourceClip);
    if (!clip) {
      issues.push({ code: 'missing-clip', severity: 'error', message: 'Фрагмент ссылается на удалённый клип.', time: s.startTime });
      continue;
    }
    if (!clip.probe.hasVideo) {
      issues.push({ code: 'no-video', severity: 'error', message: `Клип «${clip.label}» не содержит видео.`, time: s.startTime });
    }
    if (s.sourceStart >= clip.probe.durationSec - 0.05) {
      issues.push({ code: 'black-frame', severity: 'error', message: `Фрагмент начинается после конца клипа «${clip.label}».`, time: s.startTime });
    }
    if (s.scaleStart < 1 || s.scaleEnd < 1) {
      issues.push({ code: 'underfill', severity: 'error', message: 'Масштаб меньше 100% оставит пустые края кадра.', time: s.startTime });
    }
  }

  // Long static stretches.
  let staticStart = segs[0].startTime;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const prev = segs[i - 1];
    const moving = Math.abs(s.scaleEnd - s.scaleStart) > 0.005 || Math.hypot(s.positionEnd.x - s.positionStart.x, s.positionEnd.y - s.positionStart.y) > 0.02;
    const visualChange = !prev || prev.sourceClip !== s.sourceClip || Math.abs(prev.sourceEnd - s.sourceStart) > 0.05 || Math.abs(prev.scaleEnd - s.scaleStart) > 0.005;
    if (moving || visualChange) staticStart = moving ? s.endTime : s.startTime;
    const staticFor = s.endTime - staticStart;
    if (!moving && staticFor > preset.maxStatic + 0.5) {
      issues.push({ code: 'static', severity: 'warning', message: `Статичный кадр ${staticFor.toFixed(1)} с.`, time: staticStart });
      staticStart = s.endTime;
    }
  }

  // Transition density.
  let lastTr = -Infinity;
  for (const s of segs) {
    if (s.transitionOut.kind === 'cut') continue;
    if (s.endTime - lastTr < preset.transitionMinGap * 0.6) {
      issues.push({ code: 'transition-density', severity: 'warning', message: 'Переходы стоят слишком часто.', time: s.endTime });
    }
    lastTr = s.endTime;
  }

  // SFX: no identical file twice in a row, not too dense.
  const sfx = timeline.sfx.filter((e) => !e.muted);
  for (let i = 1; i < sfx.length; i++) {
    if (sfx[i].file === sfx[i - 1].file) {
      issues.push({ code: 'sfx-repeat', severity: 'warning', message: 'Один и тот же SFX дважды подряд.', time: sfx[i].time });
    }
    if (sfx[i].time - sfx[i - 1].time < 1) {
      issues.push({ code: 'sfx-density', severity: 'warning', message: 'SFX стоят слишком плотно.', time: sfx[i].time });
    }
    if (sfx[i].gainDb > -12) {
      issues.push({ code: 'sfx-loud', severity: 'warning', message: 'SFX громче рекомендованного (−12 dB).', time: sfx[i].time });
    }
  }

  issues.push(...checkCaptions(timeline, words, captionPosition, measure));
  return issues;
}

export function checkCaptions(
  timeline: Timeline,
  words: Word[],
  position: keyof typeof CAPTION_Y,
  measure: MeasureText = approxMeasure,
): QaIssue[] {
  const issues: QaIssue[] = [];
  for (const w of words) {
    if (!w.text || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end < w.start) {
      issues.push({ code: 'word-timing', severity: 'warning', message: `Слово без корректного времени: «${w.text}».`, time: w.start });
    }
  }
  const caps = timeline.captions;
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    if (i > 0 && caps[i - 1].end > c.start + 1e-3) {
      issues.push({ code: 'caption-overlap', severity: 'error', message: 'Субтитры накладываются.', time: c.start });
    }
    const fs = c.fontSize ?? 92;
    if (measure(c.text, fs) > CAPTION_MAX_WIDTH + 2) {
      issues.push({ code: 'caption-clipped', severity: 'warning', message: `Слово «${c.text}» может не поместиться в кадр.`, time: c.start });
    }
    const y = CAPTION_Y[position];
    if (y - fs < SAFE_ZONE.top || y + fs > FRAME_H - SAFE_ZONE.bottom) {
      issues.push({ code: 'caption-safe-zone', severity: 'warning', message: 'Субтитры выходят из safe-zone.', time: c.start });
    }
  }
  if (timeline.duration > 0 && words.length && caps.length && caps[caps.length - 1].end > timeline.duration + 0.5) {
    issues.push({ code: 'caption-tail', severity: 'info', message: 'Последний субтитр заканчивается после конца ролика.' });
  }
  return issues;
}

/** Pre-export audio QA from voice analysis (no automatic compression). */
export function checkAudio(project: Project): QaIssue[] {
  const issues: QaIssue[] = [];
  const v = project.voice;
  if (!v) return [{ code: 'no-voice', severity: 'error', message: 'Нет voice-over.' }];
  if (v.peakDb !== undefined && v.peakDb > -0.3) {
    issues.push({ code: 'clipping', severity: 'warning', message: 'В voice-over есть клиппинг (пики около 0 dBFS). Финальный лимитер смягчит пики, но лучше перезаписать или экспортировать голос тише.' });
  }
  if (v.meanDb !== undefined && v.meanDb < -35) {
    issues.push({ code: 'voice-quiet', severity: 'warning', message: 'Голос очень тихий. Его будет плохо слышно на телефоне.' });
  }
  return issues;
}

export function segmentsCoverDuration(segs: Segment[], duration: number): boolean {
  if (!segs.length) return false;
  if (Math.abs(segs[0].startTime) > EPS) return false;
  for (let i = 0; i < segs.length - 1; i++) if (Math.abs(segs[i].endTime - segs[i + 1].startTime) > 1e-3) return false;
  return Math.abs(segs[segs.length - 1].endTime - duration) <= EPS;
}
