import type { CaptionEvent, CaptionPosition, CaptionStyle, Word } from '../model/types';
import { FRAME_H, FRAME_W } from '../motion/MotionEngine';
import { seededId } from '../util/id';
import { round3 } from '../util/math';

/**
 * Reels safe zone at 1080×1920: the top bar, the bottom caption/handle
 * block and the right-hand action column are covered by the Instagram UI.
 */
export const SAFE_ZONE = { top: 250, bottom: 440, left: 90, right: 170 };
export const CAPTION_MAX_WIDTH = FRAME_W - 2 * Math.max(SAFE_ZONE.left, SAFE_ZONE.right) - 40;

/** Vertical centre of the caption line for each position, in px. */
export const CAPTION_Y: Record<CaptionPosition, number> = {
  'upper-center': 600,
  center: 960,
  'lower-center': 1330,
};

/** Width of `text` in px at `fontSize`. Injected so the engine stays font-agnostic. */
export type MeasureText = (text: string, fontSize: number) => number;

/** Fallback metric for Inter ExtraBold caps (≈0.70 em per glyph). */
export const approxMeasure: MeasureText = (text, fontSize) => {
  let w = 0;
  for (const ch of text) w += /[ШЩЖМЮWMФ]/i.test(ch) ? 0.92 : /[IЇ1.,!']/.test(ch) ? 0.34 : 0.7;
  return w * fontSize;
};

/** Strips punctuation that should not be shown as part of a one-word caption. */
export function captionText(word: string, uppercase: boolean): string {
  const t = word
    .trim()
    .replace(/^[\s"'«»„“”(\[{—–\-.,!?…:;]+/, '')
    .replace(/[\s"'«»„“”)\]}—–\-.,!?…:;]+$/, '');
  return uppercase ? t.toLocaleUpperCase('ru-RU') : t;
}

/**
 * One word on screen at a time, appearing exactly when it is spoken.
 * A word stays until the next word starts (short pauses) or fades out
 * shortly after it ends (long pauses), so captions never overlap.
 */
export function buildCaptions(
  words: Word[],
  style: CaptionStyle,
  seed: number,
  measure: MeasureText = approxMeasure,
): CaptionEvent[] {
  const visible = words
    .map((w, i) => ({ w, i, text: captionText(w.text, style.uppercase) }))
    .filter((x) => x.text.length > 0 && Number.isFinite(x.w.start) && Number.isFinite(x.w.end));
  const out: CaptionEvent[] = [];
  for (let k = 0; k < visible.length; k++) {
    const { w, i, text } = visible[k];
    const next = visible[k + 1]?.w;
    const start = Math.max(0, w.start);
    let end = Math.max(w.end, start + 0.12);
    if (next) {
      const gap = next.start - w.end;
      end = gap < 0.7 ? next.start : Math.min(w.end + 0.35, next.start);
    } else {
      end = w.end + 0.4;
    }
    end = Math.max(end, start + 0.06);
    const width = measure(text, style.fontSize);
    const fontSize = width > CAPTION_MAX_WIDTH ? Math.floor((style.fontSize * CAPTION_MAX_WIDTH) / width) : style.fontSize;
    out.push({ id: seededId('cap', k, seed), text, start: round3(start), end: round3(end), wordIndex: i, fontSize });
  }
  // Guarantee no overlap after rounding.
  for (let k = 0; k < out.length - 1; k++) if (out[k].end > out[k + 1].start) out[k].end = out[k + 1].start;
  return out;
}

/** Caption that is visible at time t, if any. */
export function captionAt(captions: CaptionEvent[], t: number): CaptionEvent | undefined {
  let lo = 0;
  let hi = captions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = captions[mid];
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return c;
  }
  return undefined;
}

function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '').padEnd(6, '0');
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase();
}

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');
}

export const CAPTION_FONT_FAMILY = 'Inter ExtraBold';

/**
 * ASS subtitle file for libass. Animation: 95% → 102% → 100% scale with a
 * fade-in, matching the preview's CSS keyframes.
 */
export function captionsToAss(captions: CaptionEvent[], style: CaptionStyle): string {
  const y = CAPTION_Y[style.position];
  const ms = Math.max(60, Math.min(200, style.animationMs));
  const up = Math.round(ms * 0.6);
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${FRAME_W}`,
    `PlayResY: ${FRAME_H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Word,${CAPTION_FONT_FAMILY},${style.fontSize},${assColor(style.color)},${assColor(style.color)},${assColor(style.strokeColor, 0x30)},${assColor('#000000', 0x80)},0,0,0,0,100,100,0,0,1,${style.strokeWidth},${style.shadow},5,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = captions.map((c) => {
    const fs = c.fontSize && c.fontSize !== style.fontSize ? `\\fs${c.fontSize}` : '';
    const anim = `\\fscx95\\fscy95\\alpha&HFF&\\t(0,${up},\\fscx102\\fscy102\\alpha&H00&)\\t(${up},${ms},\\fscx100\\fscy100)`;
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Word,,0,0,0,,{\\an5\\pos(${FRAME_W / 2},${y})${fs}${anim}}${escapeAss(c.text)}`;
  });
  return [...header, ...lines, ''].join('\n');
}
