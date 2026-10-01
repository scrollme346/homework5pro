import * as snowball from 'snowball-stemmers';

const ru = snowball.newStemmer('russian');
const en = snowball.newStemmer('english');

const STOPWORDS = new Set(
  (
    'и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это эта эти этот вот давайте давай здесь сюда очень просто также ещё сразу именно наш наша наше наши ваш нужно буду будем покажу посмотрим посмотреть сделаем сделать можете можем сможете ' +
    'the a an and or but of to in on at for with is are was were be been it this that these those you we i he she they my your our their from by as so then now here there just also can will would should let lets let\'s go see show look how what which into up down about very really get got have has do does done mp4 mov m4v webm mkv avi final v1 v2 v3 copy clip screen record recording'
  ).split(/\s+/),
);

/** Lowercase, unify ё→е, drop punctuation/digits/underscores, collapse spaces. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_\-–—.,!?…:;"'«»()[\]{}/\\|+*=#@%&^~`<>]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(' ').filter(Boolean) : [];
}

export const isCyrillic = (w: string): boolean => /[а-я]/.test(w);

export function stem(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (w.length <= 3) return w;
  return isCyrillic(w) ? ru.stem(w) : en.stem(w);
}

export function isStopword(w: string): boolean {
  return STOPWORDS.has(w);
}

/** Content tokens: normalised, stopwords removed, at least 2 chars. */
export function contentTokens(s: string): string[] {
  return tokenize(s).filter((t) => t.length >= 2 && !isStopword(t));
}

/** Clip label from a file name: strips extension and leading ordering numbers ("01 - "). */
export function labelFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,4}$/i, '');
  return base
    .replace(/^\s*\d+\s*[-_.)]*\s*/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || base;
}

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** Sørensen–Dice coefficient over character trigrams. */
export function trigramDice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}
