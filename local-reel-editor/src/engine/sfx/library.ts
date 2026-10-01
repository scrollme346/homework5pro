import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SfxCategory } from '@core/model/types';
import type { SfxLibrary } from '@core/sfx/SfxPlanner';

export const SFX_CATEGORIES: SfxCategory[] = ['click', 'pop', 'whoosh', 'impact'];
const AUDIO = /\.(wav|mp3|m4a|aac|ogg|flac)$/i;

/**
 * Scans a SFX library root with click/ pop/ whoosh/ impact/ folders.
 * Returns paths relative to the root ("whoosh/air.wav").
 */
export async function scanSfxLibrary(root: string): Promise<SfxLibrary> {
  const lib: SfxLibrary = { click: [], pop: [], whoosh: [], impact: [] };
  for (const cat of SFX_CATEGORIES) {
    try {
      const files = (await readdir(join(root, cat))).filter((f) => AUDIO.test(f)).sort();
      lib[cat] = files.map((f) => `${cat}/${f}`);
    } catch {
      // Missing category folder → no sounds of that kind.
    }
  }
  return lib;
}
