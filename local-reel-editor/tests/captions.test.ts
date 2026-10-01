import { describe, expect, it } from 'vitest';
import { buildCaptions, captionAt, captionText, captionsToAss, CAPTION_MAX_WIDTH, approxMeasure } from '../src/core/captions/CaptionEngine';
import { DEFAULT_CAPTION_STYLE } from '../src/core/model/defaults';
import { wordsFrom } from './fixtures';

describe('CaptionEngine', () => {
  const words = wordsFrom('Сегодня я покажу, как работает приложение. — Начнём!');
  const caps = buildCaptions(words, DEFAULT_CAPTION_STYLE, 1);

  it('shows one word at a time, synced to speech', () => {
    expect(caps.map((c) => c.text)).toEqual(['СЕГОДНЯ', 'Я', 'ПОКАЖУ', 'КАК', 'РАБОТАЕТ', 'ПРИЛОЖЕНИЕ', 'НАЧНЁМ']);
    for (let i = 0; i < caps.length; i++) {
      expect(caps[i].start).toBeCloseTo(words[caps[i].wordIndex].start, 3);
      if (i > 0) expect(caps[i].start).toBeGreaterThanOrEqual(caps[i - 1].end);
    }
  });

  it('never shows punctuation alone', () => {
    expect(caps.some((c) => c.text === '—')).toBe(false);
    expect(captionText('«Привет!»', true)).toBe('ПРИВЕТ');
  });

  it('finds the visible caption', () => {
    expect(captionAt(caps, caps[2].start + 0.01)?.text).toBe('ПОКАЖУ');
    expect(captionAt(caps, -1)).toBeUndefined();
  });

  it('shrinks very long words to fit', () => {
    const long = buildCaptions([{ text: 'Достопримечательностями', start: 0, end: 1 }], DEFAULT_CAPTION_STYLE, 1);
    expect(approxMeasure(long[0].text, long[0].fontSize!)).toBeLessThanOrEqual(CAPTION_MAX_WIDTH + 1);
  });

  it('writes an ASS file with the subtle pop animation', () => {
    const ass = captionsToAss(caps, DEFAULT_CAPTION_STYLE);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('\\fscx95\\fscy95');
    expect(ass).toContain('\\fscx102');
    expect(ass.match(/^Dialogue:/gm)?.length).toBe(caps.length);
  });
});
