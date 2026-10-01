import { produce, type Draft } from 'immer';
import type { CaptionPosition, Point, Project, Segment, SfxEvent, TransitionKind } from '../model/types';
import { makeTransition } from '../planner/transitions';
import { attachSfxToSegments } from '../sfx/SfxPlanner';
import { clamp, round3 } from '../util/math';

/**
 * Pure timeline edits used by the editor. Each returns a new Project
 * (structural sharing via immer), so undo/redo is a stack of references.
 */

const MIN_SEG = 0.25;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 1.15;

function clipDuration(p: Draft<Project> | Project, clipId: string): number {
  return p.clips.find((c) => c.id === clipId)?.probe.durationSec ?? 0;
}

function fixSource(p: Draft<Project>, s: Draft<Segment>): void {
  const D = clipDuration(p, s.sourceClip);
  const need = (s.endTime - s.startTime) * s.speed;
  s.sourceStart = round3(clamp(s.sourceStart, 0, Math.max(0, D - Math.min(need, D) )));
  s.sourceEnd = round3(Math.min(D, s.sourceStart + need));
}

function segIndex(p: Project, id: string): number {
  return p.timeline?.segments.findIndex((s) => s.id === id) ?? -1;
}

/** Roll edit: moves the cut between segment i and i+1, keeping the total duration. */
export function moveCut(project: Project, leftSegmentId: string, newTime: number): Project {
  return produce(project, (p) => {
    const segs = p.timeline!.segments;
    const i = segIndex(project, leftSegmentId);
    if (i < 0 || i >= segs.length - 1) return;
    const a = segs[i];
    const b = segs[i + 1];
    const minT = a.startTime + Math.max(MIN_SEG, a.transitionIn.duration * 2);
    const maxT = b.endTime - Math.max(MIN_SEG, b.transitionOut.duration * 2);
    const t = round3(clamp(newTime, minT, maxT));
    const delta = t - b.startTime;
    a.endTime = t;
    b.startTime = t;
    // Keep B's content anchored where it was so the cut feels like a trim.
    b.sourceStart = b.sourceStart + delta * b.speed;
    fixSource(p, a);
    fixSource(p, b);
    attachSfxToSegments(segs as Segment[], p.timeline!.sfx as SfxEvent[]);
  });
}

/** Slip: change which part of the source a segment plays, keeping its timing. */
export function slipSource(project: Project, segmentId: string, sourceStart: number): Project {
  return produce(project, (p) => {
    const s = p.timeline!.segments.find((x) => x.id === segmentId);
    if (!s) return;
    s.sourceStart = sourceStart;
    fixSource(p, s);
  });
}

/** Replace the clip of one segment. Keeps timing and motion. */
export function replaceClip(project: Project, segmentId: string, clipId: string, sourceStart = 0): Project {
  return produce(project, (p) => {
    const s = p.timeline!.segments.find((x) => x.id === segmentId);
    if (!s || !p.clips.some((c) => c.id === clipId)) return;
    s.sourceClip = clipId;
    s.sourceStart = sourceStart;
    s.userConfirmed = true;
    s.confidence = 1;
    fixSource(p, s);
  });
}

/** "Move": swaps the content of two segments while the cut points stay on the voice. */
export function swapSegments(project: Project, aId: string, bId: string): Project {
  return produce(project, (p) => {
    const a = p.timeline!.segments.find((x) => x.id === aId);
    const b = p.timeline!.segments.find((x) => x.id === bId);
    if (!a || !b || a === b) return;
    const keys = ['sourceClip', 'sourceStart', 'scaleStart', 'scaleEnd', 'positionStart', 'positionEnd', 'speed', 'confidence', 'candidates'] as const;
    for (const k of keys) {
      const tmp = a[k];
      (a as Record<string, unknown>)[k] = b[k];
      (b as Record<string, unknown>)[k] = tmp;
    }
    a.userConfirmed = b.userConfirmed = true;
    fixSource(p, a);
    fixSource(p, b);
  });
}

/** Sets the transition at the cut after `leftSegmentId`. */
export function setTransition(project: Project, leftSegmentId: string, kind: TransitionKind): Project {
  return produce(project, (p) => {
    const segs = p.timeline!.segments;
    const i = segIndex(project, leftSegmentId);
    if (i < 0 || i >= segs.length - 1) return;
    const tr = makeTransition(kind);
    const a = segs[i];
    const b = segs[i + 1];
    if (kind !== 'cut' && (a.endTime - a.startTime < tr.duration * 1.5 || b.endTime - b.startTime < tr.duration * 1.5)) return;
    a.transitionOut = tr;
    b.transitionIn = tr;
  });
}

export function setZoom(project: Project, segmentId: string, scaleStart: number, scaleEnd: number): Project {
  return produce(project, (p) => {
    const s = p.timeline!.segments.find((x) => x.id === segmentId);
    if (!s) return;
    s.scaleStart = round3(clamp(scaleStart, ZOOM_MIN, ZOOM_MAX));
    s.scaleEnd = round3(clamp(scaleEnd, ZOOM_MIN, ZOOM_MAX));
  });
}

export function setFocus(project: Project, segmentId: string, start: Point, end: Point): Project {
  return produce(project, (p) => {
    const s = p.timeline!.segments.find((x) => x.id === segmentId);
    if (!s) return;
    s.positionStart = { x: round3(clamp(start.x, 0, 1)), y: round3(clamp(start.y, 0, 1)) };
    s.positionEnd = { x: round3(clamp(end.x, 0, 1)), y: round3(clamp(end.y, 0, 1)) };
  });
}

export function setSfxMuted(project: Project, sfxId: string, muted: boolean): Project {
  return produce(project, (p) => {
    const e = p.timeline!.sfx.find((x) => x.id === sfxId);
    if (e) e.muted = muted;
  });
}

export function replaceSfx(project: Project, sfxId: string, file: string): Project {
  return produce(project, (p) => {
    const e = p.timeline!.sfx.find((x) => x.id === sfxId);
    if (!e) return;
    e.file = file;
    const cat = file.replace(/\\/g, '/').split('/').slice(-2, -1)[0];
    if (cat === 'click' || cat === 'pop' || cat === 'whoosh' || cat === 'impact') e.category = cat;
  });
}

export function setSfxGain(project: Project, sfxId: string, gainDb: number): Project {
  return produce(project, (p) => {
    const e = p.timeline!.sfx.find((x) => x.id === sfxId);
    if (e) e.gainDb = Math.round(clamp(gainDb, -30, -10) * 10) / 10;
  });
}

export function moveSfx(project: Project, sfxId: string, time: number): Project {
  return produce(project, (p) => {
    const tl = p.timeline!;
    const e = tl.sfx.find((x) => x.id === sfxId);
    if (!e) return;
    e.time = round3(clamp(time, 0, tl.duration - 0.1));
    tl.sfx.sort((a, b) => a.time - b.time);
    attachSfxToSegments(tl.segments as Segment[], tl.sfx as SfxEvent[]);
  });
}

export function setCaptionPosition(project: Project, position: CaptionPosition): Project {
  return produce(project, (p) => {
    p.captionStyle.position = position;
  });
}

export function setSfxEnabled(project: Project, enabled: boolean): Project {
  return produce(project, (p) => {
    p.render.sfxEnabled = enabled;
  });
}

export function renameClip(project: Project, clipId: string, label: string): Project {
  return produce(project, (p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (c) c.label = label.trim() || c.fileLabel;
  });
}

/** Removes a clip from the project (the file on disk is never touched). */
export function removeClip(project: Project, clipId: string): Project {
  return produce(project, (p) => {
    p.clips = p.clips.filter((c) => c.id !== clipId);
    // Any plan that used it must be regenerated.
    if (p.timeline?.segments.some((s) => s.sourceClip === clipId)) p.timeline = undefined;
    for (const [k, v] of Object.entries(p.phraseOverrides)) if (v === clipId) delete p.phraseOverrides[k];
  });
}

/** Answer to "Which clip matches this section?" — remembered for every regenerate. */
export function chooseSectionClip(project: Project, sectionId: string, clipId: string): Project {
  return produce(project, (p) => {
    const tl = p.timeline!;
    const sec = tl.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    for (const pi of sec.phraseIndices) p.phraseOverrides[String(pi)] = clipId;
    sec.clipId = clipId;
    sec.needsReview = false;
    sec.confidence = 1;
    let cursor = 0;
    for (const s of tl.segments) {
      if (s.sectionId !== sectionId) continue;
      s.sourceClip = clipId;
      s.sourceStart = cursor;
      s.userConfirmed = true;
      s.confidence = 1;
      fixSource(p, s);
      cursor = s.sourceEnd;
    }
  });
}

export function confirmSection(project: Project, sectionId: string): Project {
  return produce(project, (p) => {
    const sec = p.timeline!.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    for (const pi of sec.phraseIndices) p.phraseOverrides[String(pi)] = sec.clipId;
    sec.needsReview = false;
  });
}
