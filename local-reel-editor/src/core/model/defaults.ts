import type { CaptionStyle, Project, RenderSettings } from './types';
import { PROJECT_FORMAT_VERSION } from './types';
import { newId } from '../util/id';

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  position: 'lower-center',
  fontSize: 92,
  uppercase: true,
  color: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 3,
  shadow: 2,
  animationMs: 120,
};

export const DEFAULT_RENDER: RenderSettings = {
  width: 1080,
  height: 1920,
  fps: 30,
  quality: 'high',
  hardwareAcceleration: false,
  sfxEnabled: true,
};

export function createProject(name: string, now = new Date()): Project {
  const iso = now.toISOString();
  return {
    format: 'local-reel-editor',
    version: PROJECT_FORMAT_VERSION,
    id: newId('prj'),
    name: name.trim() || 'Untitled Reel',
    createdAt: iso,
    updatedAt: iso,
    clips: [],
    editingStyle: 'dynamic',
    variation: 0,
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
    render: { ...DEFAULT_RENDER },
    qa: [],
    phraseOverrides: {},
  };
}
