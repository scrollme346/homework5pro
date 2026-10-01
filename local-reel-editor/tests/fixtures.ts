import type { ClipAsset, Word } from '../src/core/model/types';

/** Builds word timings from a sentence list with a fixed speaking rate. */
export function wordsFrom(text: string, start = 0.3, perWord = 0.32, gap = 0.06, sentenceGap = 0.45): Word[] {
  const out: Word[] = [];
  let t = start;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const d = perWord + tok.length * 0.01;
    out.push({ text: tok, start: +t.toFixed(3), end: +(t + d).toFixed(3) });
    t += d + (/[.!?]$/.test(tok) ? sentenceGap : gap);
  }
  return out;
}

export function clip(id: string, label: string, dur = 8, w = 1080, h = 2340, uiEvents: number[] = [1.2, 3.4, 5.1]): ClipAsset {
  return {
    id,
    path: `/media/${label}.mp4`,
    fileLabel: label,
    label,
    probe: { durationSec: dur, width: w, height: h, fps: 30, hasAudio: false, hasVideo: true },
    fitMode: w / h > 0.72 ? 'blur-fit' : 'cover',
    activity: {
      sampleRate: 10,
      energy: Array.from({ length: dur * 10 }, (_, i) => (i % 17 === 0 ? 0.05 : 0.01)),
      centroid: Array.from({ length: dur * 10 }, () => ({ x: 0.5, y: 0.6 })),
      sceneChanges: [],
      uiEvents,
    },
  };
}

export const DEMO_TEXT =
  'Сегодня я покажу, как работает приложение. На главном экране собраны все ваши дела. ' +
  'Теперь создадим новую задачу. Введите название и выберите время. ' +
  'После этого можно посмотреть подробную статистику. Графики показывают ваш прогресс за неделю. ' +
  'В профиле видно все ваши достижения. Тёмную тему можно включить в настройках. ' +
  'А расписание на неделю — в календаре. Попробуйте сами!';

export const DEMO_CLIPS = [
  clip('c_home', 'главный экран', 9),
  clip('c_task', 'создание задачи', 8),
  clip('c_stats', 'статистика', 12),
  clip('c_prof', 'профиль', 6),
  clip('c_set', 'настройки', 7),
  clip('c_cal', 'календарь', 10, 1920, 1080),
];

export const SFX_LIB = {
  click: ['click/a.wav', 'click/b.wav'],
  pop: ['pop/a.wav', 'pop/b.wav'],
  whoosh: ['whoosh/a.wav', 'whoosh/b.wav'],
  impact: ['impact/a.wav'],
};
