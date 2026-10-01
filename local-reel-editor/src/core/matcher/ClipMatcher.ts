import type { ClipAsset, MatchCandidate } from '../model/types';
import type { Phrase } from '../transcript/phrases';
import { commonPrefixLength, contentTokens, stem, trigramDice } from '../text/normalize';
import { shareConcept } from '../text/concepts';
import { clamp } from '../util/math';

/** Similarity of two stemmed tokens, 0..1. */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (shareConcept(a, b)) return 0.85;
  const cp = commonPrefixLength(a, b);
  const minLen = Math.min(a.length, b.length);
  if (cp >= 4 && cp >= 0.6 * minLen) return 0.55 + 0.25 * (cp / Math.max(a.length, b.length));
  const dice = trigramDice(a, b);
  return dice >= 0.55 ? dice * 0.75 : 0;
}

interface LabelModel {
  clipId: string;
  stems: string[];
  weights: number[];
}

export interface PhraseMatch {
  phraseIndex: number;
  /** Score for every clip, aligned with the clip array passed in. */
  scores: number[];
  ranked: MatchCandidate[];
}

/**
 * Local, deterministic matcher between voice phrases and clip labels.
 * Uses normalisation, stemming (RU/EN Snowball), fuzzy prefix/trigram
 * similarity and a small bilingual concept vocabulary. No network, no LLM.
 */
export class ClipMatcher {
  private labels: LabelModel[];

  constructor(private clips: Pick<ClipAsset, 'id' | 'label'>[]) {
    const stemLists = clips.map((c) => {
      const toks = contentTokens(c.label);
      return (toks.length ? toks : contentTokens(c.label.replace(/[^\p{L}\s]/gu, ' '))).map(stem);
    });
    // Down-weight stems that appear in many labels ("экран", "screen").
    const df = new Map<string, number>();
    for (const list of stemLists) for (const s of new Set(list)) df.set(s, (df.get(s) ?? 0) + 1);
    const n = Math.max(1, clips.length);
    this.labels = clips.map((c, i) => ({
      clipId: c.id,
      stems: stemLists[i],
      weights: stemLists[i].map((s) => 0.35 + 0.65 * Math.log(1 + n / (df.get(s) ?? 1)) / Math.log(1 + n)),
    }));
  }

  /** Score how well `text` talks about each clip (0..1). */
  scoreText(text: string): number[] {
    const phraseStems = contentTokens(text).map(stem);
    return this.labels.map((label) => {
      if (!label.stems.length || !phraseStems.length) return 0;
      let total = 0;
      let wsum = 0;
      let strongHits = 0;
      for (let i = 0; i < label.stems.length; i++) {
        let best = 0;
        for (const p of phraseStems) best = Math.max(best, tokenSimilarity(label.stems[i], p));
        if (best >= 0.8) strongHits++;
        total += best * label.weights[i];
        wsum += label.weights[i];
      }
      const coverage = total / wsum;
      // A single strong hit on a multi-word label is still meaningful evidence.
      const anyStrong = strongHits > 0 ? 0.55 + 0.45 * coverage : coverage;
      return clamp(Math.max(coverage, anyStrong * (label.stems.length > 1 ? 0.95 : 1)), 0, 1);
    });
  }

  matchPhrases(phrases: Phrase[]): PhraseMatch[] {
    return phrases.map((p) => {
      const scores = this.scoreText(p.text);
      const ranked = scores
        .map((score, i) => ({ clipId: this.clips[i].id, score: Math.round(score * 100) / 100 }))
        .sort((a, b) => b.score - a.score);
      return { phraseIndex: p.index, scores, ranked };
    });
  }
}

/** Converts raw best/second scores into a 0..1 confidence. */
export function confidenceOf(best: number, second: number): number {
  if (best <= 0) return 0;
  const margin = clamp((best - second) / best, 0, 1);
  return clamp(best * (0.7 + 0.3 * margin), 0, 1);
}
