let counter = 0;

/** Short unique id. Uses crypto when available; deterministic ids come from `seededId`. */
export function newId(prefix: string): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const rand = g.crypto?.randomUUID ? g.crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  counter = (counter + 1) % 1e6;
  return `${prefix}_${rand}${counter.toString(36)}`;
}

/** Deterministic id for planner output, so regenerating gives stable ids. */
export function seededId(prefix: string, index: number, seed: number): string {
  return `${prefix}_${(seed >>> 0).toString(36)}_${index.toString(36)}`;
}
