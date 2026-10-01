import type { ClipAsset, MatchCandidate, Section } from '../model/types';
import type { Phrase } from '../transcript/phrases';
import { ClipMatcher, confidenceOf } from '../matcher/ClipMatcher';
import { contentTokens, stem } from '../text/normalize';
import { conceptsOfStem } from '../text/concepts';
import { seededId } from '../util/id';
import { CUT_LEAD, REVIEW_THRESHOLD } from './presets';

const STRONG = 0.5;
const WEAK = 0.2;
const CONTINUITY_BONUS = 0.18;

export interface PhraseAssignment {
  phraseIndex: number;
  clipId: string;
  confidence: number;
  candidates: MatchCandidate[];
  /** Why the clip was chosen, for debugging and the UI. */
  source: 'match' | 'continuity' | 'fallback' | 'user' | 'coverage';
}

/** Index of a clip that looks like an overview/home screen, used for intros. */
function overviewClipIndex(clips: Pick<ClipAsset, 'label'>[]): number {
  const idx = clips.findIndex((c) =>
    contentTokens(c.label)
      .map(stem)
      .some((s) => {
        const cs = conceptsOfStem(s);
        return !!cs && (cs.has('home') || cs.has('app') || cs.has('onboarding'));
      }),
  );
  return idx >= 0 ? idx : 0;
}

/**
 * Assigns one clip to each phrase with a small Viterbi search:
 * emission = matcher score, transition = continuity bonus for staying on
 * the same clip. Weak phrases therefore inherit the surrounding topic.
 */
export function assignClips(
  phrases: Phrase[],
  clips: Pick<ClipAsset, 'id' | 'label'>[],
  overrides: Record<string, string> = {},
): PhraseAssignment[] {
  if (!phrases.length || !clips.length) return [];
  const matcher = new ClipMatcher(clips);
  const matches = matcher.matchPhrases(phrases);
  const n = phrases.length;
  const k = clips.length;
  const overview = overviewClipIndex(clips);

  const emission = (pi: number, ci: number): number => {
    const forced = overrides[String(pi)];
    if (forced) return clips[ci].id === forced ? 10 : -10;
    const s = matches[pi].scores[ci];
    const best = Math.max(...matches[pi].scores);
    if (best < WEAK) {
      // No evidence: slight preference for the overview clip at the very start.
      return pi === 0 && ci === overview ? 0.05 : 0;
    }
    return s;
  };

  const score: number[][] = Array.from({ length: n }, () => new Array(k).fill(-Infinity));
  const back: number[][] = Array.from({ length: n }, () => new Array(k).fill(-1));
  for (let c = 0; c < k; c++) score[0][c] = emission(0, c);
  for (let p = 1; p < n; p++) {
    for (let c = 0; c < k; c++) {
      let best = -Infinity;
      let arg = 0;
      for (let prev = 0; prev < k; prev++) {
        const v = score[p - 1][prev] + (prev === c ? CONTINUITY_BONUS : 0);
        if (v > best) {
          best = v;
          arg = prev;
        }
      }
      score[p][c] = best + emission(p, c);
      back[p][c] = arg;
    }
  }
  const path = new Array<number>(n);
  path[n - 1] = score[n - 1].indexOf(Math.max(...score[n - 1]));
  for (let p = n - 1; p > 0; p--) path[p - 1] = back[p][path[p]];

  const result: PhraseAssignment[] = path.map((ci, pi) => {
    const m = matches[pi];
    const s = m.scores[ci];
    const second = Math.max(0, ...m.scores.filter((_, i) => i !== ci));
    const forced = overrides[String(pi)];
    let source: PhraseAssignment['source'] = 'match';
    let confidence = confidenceOf(s, second);
    if (forced) {
      source = 'user';
      confidence = 1;
    } else if (s < WEAK) {
      source = pi === 0 || !hasStrongNeighbour(path, matches, pi) ? 'fallback' : 'continuity';
      // Continuity is a reasonable guess but not evidence.
      confidence = source === 'continuity' ? 0.5 : 0.3;
    }
    return { phraseIndex: pi, clipId: clips[ci].id, confidence, candidates: m.ranked.slice(0, 4), source };
  });

  // Coverage pass: the user uploaded every clip to be shown. If a clip was
  // never used, give it the weak phrase where it scores best, as long as
  // that does not break a strong match.
  const used = new Set(result.map((r) => r.clipId));
  for (let ci = 0; ci < k; ci++) {
    if (used.has(clips[ci].id)) continue;
    let bestPi = -1;
    let bestScore = -1;
    for (let pi = 0; pi < n; pi++) {
      const r = result[pi];
      if (r.source === 'user' || r.source === 'coverage') continue;
      const own = matches[pi].scores[path[pi]];
      if (own >= STRONG) continue;
      // Do not take the only phrase of another clip.
      if (result.filter((x) => x.clipId === r.clipId).length < 2) continue;
      const s = matches[pi].scores[ci] + (r.source === 'match' ? 0 : 0.1);
      if (s > bestScore) {
        bestScore = s;
        bestPi = pi;
      }
    }
    if (bestPi >= 0) {
      result[bestPi] = {
        ...result[bestPi],
        clipId: clips[ci].id,
        confidence: Math.min(0.4, 0.25 + matches[bestPi].scores[ci]),
        source: 'coverage',
      };
      used.add(clips[ci].id);
    }
  }
  return result;
}

function hasStrongNeighbour(path: number[], matches: { scores: number[] }[], pi: number): boolean {
  const c = path[pi];
  for (let d = 1; d <= 3; d++) {
    for (const j of [pi - d, pi + d]) {
      if (j < 0 || j >= path.length || path[j] !== c) continue;
      if (matches[j].scores[c] >= WEAK) return true;
    }
  }
  return false;
}

/**
 * Merges consecutive phrases that use the same clip into sections and
 * places section boundaries just before the next phrase starts speaking.
 */
export function buildSections(
  phrases: Phrase[],
  assignments: PhraseAssignment[],
  duration: number,
  seed: number,
): Section[] {
  const sections: Section[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const a = assignments[i];
    const last = sections[sections.length - 1];
    if (last && last.clipId === a.clipId) {
      last.end = phrases[i].end;
      last.text += ' ' + phrases[i].text;
      // Section confidence = strongest evidence among its phrases.
      if (a.confidence > last.confidence) {
        last.confidence = a.confidence;
        last.candidates = a.candidates;
      }
      last.phraseIndices.push(i);
    } else {
      sections.push({
        id: seededId('sec', sections.length, seed),
        start: phrases[i].start,
        end: phrases[i].end,
        text: phrases[i].text,
        clipId: a.clipId,
        confidence: a.confidence,
        candidates: a.candidates,
        needsReview: false,
        phraseIndices: [i],
      });
    }
  }
  // Boundaries: cut a moment before speech of the next section begins.
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const next = sections[i + 1];
    if (i === 0) s.start = 0;
    if (next) {
      const cut = Math.max(s.end, next.start - CUT_LEAD);
      s.end = cut;
      next.start = cut;
    } else {
      s.end = duration;
    }
    const userPicked = s.phraseIndices.some((pi) => assignments[pi].source === 'user');
    s.needsReview = !userPicked && s.confidence < REVIEW_THRESHOLD;
  }
  return sections;
}
