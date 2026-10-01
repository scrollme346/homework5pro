import { describe, expect, it } from 'vitest';
import { contentTokens, labelFromFileName, normalizeText, stem } from '../src/core/text/normalize';
import { ClipMatcher, confidenceOf, tokenSimilarity } from '../src/core/matcher/ClipMatcher';
import { splitPhrases } from '../src/core/transcript/phrases';
import { wordsFrom } from './fixtures';

describe('text normalisation', () => {
  it('normalises case, ё and punctuation', () => {
    expect(normalizeText('Тёмная ТЕМА, «Настройки»!')).toBe('темная тема настройки');
  });
  it('builds labels from file names', () => {
    expect(labelFromFileName('/x/01 - создание задачи.mp4')).toBe('создание задачи');
    expect(labelFromFileName('C:\\v\\statistics_screen.MOV')).toBe('statistics screen');
    expect(labelFromFileName('профиль.mp4')).toBe('профиль');
  });
  it('drops stopwords', () => {
    expect(contentTokens('Теперь мы создадим новую задачу')).toEqual(['создадим', 'новую', 'задачу']);
  });
  it('stems Russian and English', () => {
    expect(stem('статистику')).toBe(stem('статистика'));
    expect(stem('settings')).toBe(stem('setting'));
  });
});

describe('ClipMatcher', () => {
  const clips = ['главный экран', 'создание задачи', 'статистика', 'профиль', 'настройки', 'календарь'].map((label, i) => ({ id: `c${i}`, label }));
  const m = new ClipMatcher(clips);
  const best = (t: string) => {
    const s = m.scoreText(t);
    return clips[s.indexOf(Math.max(...s))].label;
  };
  it('matches spec examples', () => {
    expect(best('Теперь создадим новую задачу.')).toBe('создание задачи');
    expect(best('После этого можно посмотреть подробную статистику.')).toBe('статистика');
  });
  it('uses synonyms across languages', () => {
    expect(best('Тёмную тему можно включить в параметрах')).toBe('настройки');
    expect(best('А расписание на неделю')).toBe('календарь');
    expect(best('Open the analytics charts')).toBe('статистика');
  });
  it('gives zero for unrelated speech', () => {
    expect(Math.max(...m.scoreText('Вот и всё, попробуйте сами!'))).toBe(0);
  });
  it('rates fuzzy word forms', () => {
    expect(tokenSimilarity(stem('создание'), stem('создадим'))).toBeGreaterThan(0.5);
  });
  it('confidence rewards a clear margin', () => {
    expect(confidenceOf(0.9, 0.1)).toBeGreaterThan(confidenceOf(0.9, 0.8));
    expect(confidenceOf(0, 0)).toBe(0);
  });
});

describe('phrase splitting', () => {
  it('splits on sentence ends and keeps all words', () => {
    const words = wordsFrom('Привет всем друзья мои. Сегодня покажу новое приложение. Начнём прямо сейчас!');
    const p = splitPhrases(words);
    expect(p.length).toBe(3);
    expect(p.reduce((a, x) => a + (x.wordEnd - x.wordStart), 0)).toBe(words.length);
  });
  it('splits very long sentences', () => {
    const words = wordsFrom(Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ') + '.');
    const p = splitPhrases(words, { maxDuration: 5 });
    expect(p.length).toBeGreaterThan(1);
    for (const x of p) expect(x.end - x.start).toBeLessThanOrEqual(7.5);
  });
});
