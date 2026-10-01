import type { Word } from '../model/types';

export interface Phrase {
  index: number;
  start: number;
  end: number;
  text: string;
  wordStart: number;
  /** Exclusive. */
  wordEnd: number;
}

const SENTENCE_END = /[.!?…]["»)]?$/;
const CLAUSE_END = /[,;:—–-]["»)]?$/;

export interface PhraseOptions {
  /** Silence (sec) that always ends a phrase. */
  pauseBreak: number;
  /** Phrases longer than this are split at the best clause/pause point. */
  maxDuration: number;
  /** Phrases shorter than this are merged into a neighbour. */
  minDuration: number;
}

const DEFAULTS: PhraseOptions = { pauseBreak: 0.55, maxDuration: 7, minDuration: 0.9 };

/** Groups words into semantic phrases using punctuation and pauses. */
export function splitPhrases(words: Word[], opts: Partial<PhraseOptions> = {}): Phrase[] {
  const o = { ...DEFAULTS, ...opts };
  if (words.length === 0) return [];
  const groups: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const gap = next ? next.start - w.end : 0;
    const isEnd = !next || SENTENCE_END.test(w.text.trim()) || gap >= o.pauseBreak;
    if (isEnd) {
      groups.push([start, i + 1]);
      start = i + 1;
    }
  }

  // Split overly long phrases at the strongest internal boundary.
  const split: Array<[number, number]> = [];
  const queue = [...groups];
  while (queue.length) {
    const [a, b] = queue.shift()!;
    const dur = words[b - 1].end - words[a].start;
    if (dur <= o.maxDuration || b - a < 4) {
      split.push([a, b]);
      continue;
    }
    let best = -1;
    let bestScore = -Infinity;
    for (let i = a + 1; i < b - 1; i++) {
      const gap = words[i + 1].start - words[i].end;
      const clause = CLAUSE_END.test(words[i].text.trim()) ? 0.4 : 0;
      const t = words[i].end - words[a].start;
      const balance = 1 - Math.abs(t / dur - 0.5) * 2; // prefer the middle
      const score = gap * 3 + clause + balance * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    queue.unshift([a, best + 1], [best + 1, b]);
  }

  // Merge tiny fragments into the previous (or next) phrase.
  const merged: Array<[number, number]> = [];
  for (const g of split) {
    const dur = words[g[1] - 1].end - words[g[0]].start;
    if (merged.length && dur < o.minDuration) {
      merged[merged.length - 1][1] = g[1];
    } else {
      merged.push([...g]);
    }
  }
  if (merged.length > 1) {
    const f = merged[0];
    if (words[f[1] - 1].end - words[f[0]].start < o.minDuration) {
      merged[1][0] = f[0];
      merged.shift();
    }
  }

  return merged.map(([a, b], index) => ({
    index,
    start: words[a].start,
    end: words[b - 1].end,
    text: words
      .slice(a, b)
      .map((w) => w.text.trim())
      .join(' '),
    wordStart: a,
    wordEnd: b,
  }));
}
