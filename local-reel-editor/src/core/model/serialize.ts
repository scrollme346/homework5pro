import type { Project } from './types';
import { PROJECT_FORMAT_VERSION } from './types';
import { DEFAULT_CAPTION_STYLE, DEFAULT_RENDER } from './defaults';

export const PROJECT_FILE_NAME = 'project.reel.json';

export class ProjectFormatError extends Error {}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/** Parses and validates a project file, filling defaults for fields added later. */
export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectFormatError('Файл проекта повреждён: это не JSON.');
  }
  if (!raw || typeof raw !== 'object' || (raw as { format?: string }).format !== 'local-reel-editor') {
    throw new ProjectFormatError('Это не файл проекта Local Reel Editor.');
  }
  const p = raw as Project;
  if (typeof p.version !== 'number' || p.version > PROJECT_FORMAT_VERSION) {
    throw new ProjectFormatError('Проект создан более новой версией приложения.');
  }
  return {
    ...p,
    version: PROJECT_FORMAT_VERSION,
    clips: Array.isArray(p.clips) ? p.clips.map((c) => ({ ...c, fitMode: c.fitMode ?? 'cover' })) : [],
    editingStyle: p.editingStyle ?? 'dynamic',
    variation: p.variation ?? 0,
    captionStyle: { ...DEFAULT_CAPTION_STYLE, ...(p.captionStyle ?? {}) },
    render: { ...DEFAULT_RENDER, ...(p.render ?? {}) },
    qa: p.qa ?? [],
    phraseOverrides: p.phraseOverrides ?? {},
  };
}
