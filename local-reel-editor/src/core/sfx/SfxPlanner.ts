import type { ClipAsset, SfxCategory, SfxEvent, Segment, Section } from '../model/types';
import type { StylePreset } from '../planner/presets';
import type { Rng } from '../util/rng';
import { seededId } from '../util/id';
import { round3 } from '../util/math';

export type SfxLibrary = Record<SfxCategory, string[]>;

/** Gains relative to the voice, dB. SFX should be felt more than heard. */
export const SFX_GAIN: Record<SfxCategory, [number, number]> = {
  click: [-20, -16],
  pop: [-21, -17],
  whoosh: [-22, -18],
  impact: [-22, -19],
};

/** How far before the anchor time each SFX starts (whooshes lead into the cut). */
const LEAD: Record<SfxCategory, number> = { click: 0.02, pop: 0.03, whoosh: 0.18, impact: 0.05 };

/**
 * Places muted, sparse SFX: whoosh on slides/zoom transitions, pop on some
 * topic changes, click on detected taps inside the footage, at most one
 * soft impact per reel. Never the same file twice in a row.
 */
export function planSfx(
  segments: Segment[],
  sections: Section[],
  clips: Map<string, ClipAsset>,
  library: SfxLibrary,
  preset: StylePreset,
  rng: Rng,
  seed: number,
  duration: number,
): SfxEvent[] {
  const wanted: { t: number; category: SfxCategory; reason: string; priority: number }[] = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i];
    const b = segments[i + 1];
    const tr = a.transitionOut.kind;
    if (tr === 'slide-left' || tr === 'slide-up' || tr === 'zoom') {
      wanted.push({ t: a.endTime, category: 'whoosh', reason: `${tr} transition`, priority: 3 });
    } else if (a.sectionId !== b.sectionId && tr === 'cut' && rng.chance(preset.popChance)) {
      wanted.push({ t: b.startTime, category: 'pop', reason: 'new section', priority: 2 });
    } else if (a.sectionId === b.sectionId && b.scaleStart - a.scaleEnd > 0.05 && rng.chance(0.25)) {
      wanted.push({ t: b.startTime, category: 'pop', reason: 'punch-in accent', priority: 1 });
    }
  }

  for (const seg of segments) {
    const clip = clips.get(seg.sourceClip);
    for (const ev of clip?.activity?.uiEvents ?? []) {
      if (ev < seg.sourceStart + 0.1 || ev > seg.sourceEnd - 0.1) continue;
      const t = seg.startTime + (ev - seg.sourceStart) / Math.max(0.1, seg.speed);
      if (t > seg.endTime - 0.1) continue;
      if (rng.chance(preset.clickChance)) wanted.push({ t, category: 'click', reason: 'UI action in clip', priority: 1 });
    }
  }

  if (preset.allowImpact && sections.length >= 3 && duration > 12) {
    // One soft impact on the strongest-matched later section ("key moment").
    const key = sections.slice(1).reduce((best, s) => (s.confidence > best.confidence ? s : best));
    wanted.push({ t: key.start, category: 'impact', reason: 'key moment', priority: 4 });
  }

  // Thin out by priority, respecting the minimum spacing.
  wanted.sort((x, y) => y.priority - x.priority || x.t - y.t);
  const kept: typeof wanted = [];
  for (const w of wanted) {
    if (!library[w.category]?.length) continue;
    if (w.t < 0.15 || w.t > duration - 0.2) continue;
    if (kept.some((k) => Math.abs(k.t - w.t) < preset.sfxMinGap)) continue;
    kept.push(w);
  }
  kept.sort((x, y) => x.t - y.t);

  const counters: Record<SfxCategory, number> = { click: 0, pop: 0, whoosh: 0, impact: 0 };
  for (const c of Object.keys(counters) as SfxCategory[]) counters[c] = Math.floor(rng.next() * 97);
  let lastFile = '';
  return kept.map((w, i) => {
    const files = library[w.category];
    let file = files[counters[w.category]++ % files.length];
    if (file === lastFile && files.length > 1) file = files[counters[w.category]++ % files.length];
    lastFile = file;
    const [lo, hi] = SFX_GAIN[w.category];
    return {
      id: seededId('sfx', i, seed),
      category: w.category,
      file,
      time: round3(Math.max(0, w.t - LEAD[w.category])),
      gainDb: Math.round(rng.range(lo, hi) * 10) / 10,
      muted: false,
      reason: w.reason,
    };
  });
}

/** Links SFX ids to the segments they play in. */
export function attachSfxToSegments(segments: Segment[], sfx: SfxEvent[]): void {
  for (const s of segments) s.sfx = [];
  for (const e of sfx) {
    const seg = segments.find((s) => e.time >= s.startTime && e.time < s.endTime) ?? segments[segments.length - 1];
    seg?.sfx.push(e.id);
  }
}
