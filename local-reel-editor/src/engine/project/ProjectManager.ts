import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project } from '@core/model/types';
import { createProject } from '@core/model/defaults';
import { PROJECT_FILE_NAME, parseProject, serializeProject } from '@core/model/serialize';
import { UserFacingError } from '../errors';

export interface ProjectSummary {
  id: string;
  name: string;
  dir: string;
  updatedAt: string;
  duration?: number;
  clipCount: number;
  thumbnail?: string;
  hasTimeline: boolean;
}

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'reel';
}

/** Stores projects locally as folders: project.reel.json + cache/ (proxies, thumbnails) + renders/. */
export class ProjectManager {
  constructor(private root: string) {}

  get projectsRoot(): string {
    return this.root;
  }

  async create(name: string): Promise<{ project: Project; dir: string }> {
    await mkdir(this.root, { recursive: true });
    const project = createProject(name);
    const dir = join(this.root, `${slug(project.name)}-${project.id.slice(-6)}`);
    await mkdir(join(dir, 'cache'), { recursive: true });
    await this.save(dir, project);
    return { project, dir };
  }

  cacheDir(dir: string): string {
    return join(dir, 'cache');
  }

  /** Atomic save: write a temp file, then rename over the old one. */
  async save(dir: string, project: Project): Promise<Project> {
    const updated = { ...project, updatedAt: new Date().toISOString() };
    const file = join(dir, PROJECT_FILE_NAME);
    const tmp = `${file}.tmp`;
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, serializeProject(updated), 'utf8');
    await rename(tmp, file);
    return updated;
  }

  async load(dir: string): Promise<Project> {
    let text: string;
    try {
      text = await readFile(join(dir, PROJECT_FILE_NAME), 'utf8');
    } catch {
      throw new UserFacingError('Проект не найден. Возможно, папка была перемещена.', dir, 'project-missing');
    }
    return parseProject(text);
  }

  async list(): Promise<ProjectSummary[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.root);
    } catch {
      return [];
    }
    const out: ProjectSummary[] = [];
    for (const e of entries) {
      const dir = join(this.root, e);
      try {
        if (!(await stat(dir)).isDirectory()) continue;
        const p = await this.load(dir);
        out.push({
          id: p.id,
          name: p.name,
          dir,
          updatedAt: p.updatedAt,
          duration: p.voice?.probe.durationSec,
          clipCount: p.clips.length,
          thumbnail: p.clips[0]?.thumbnail,
          hasTimeline: !!p.timeline,
        });
      } catch {
        // Skip folders that are not projects.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Deletes a project folder (only the app's own folder, never user media). */
  async remove(dir: string): Promise<void> {
    if (!dir.startsWith(this.root)) throw new UserFacingError('Можно удалять только проекты из папки приложения.');
    await rm(dir, { recursive: true, force: true });
  }
}
