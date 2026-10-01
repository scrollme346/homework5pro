# Local Reel Editor

Desktop app that turns **a finished voice-over + a few labelled screen recordings** into a
vertical **1080×1920 Reel** — cuts, gentle zooms, one-word captions and quiet SFX — fully on
your computer. No paid AI APIs; nothing is uploaded.

```
New Reel → Add Voice → Add Clips → Generate Reel → Preview → Export
```

## Quick start (development)

Requirements: Node 20+, FFmpeg + FFprobe (on PATH, or chosen in the app), Python 3.9+ for local Whisper.

```bash
npm install
npm run dev          # launches the Electron app with hot reload
```

On first launch open **Компоненты** (Home → top right) and:
1. FFmpeg — detected automatically, or pick the `ffmpeg` binary.
2. **Установить** — creates a private Python env and installs `faster-whisper` (one time).
3. **Скачать модель** — Fast / Balanced (recommended) / Accurate. After that everything works offline.

Name your clips by what they show (`создание задачи.mp4`, `статистика.mp4`): the names are
matched against what the voice says.

## Scripts

| command | what it does |
|---|---|
| `npm run dev` / `npm run build` | run / build the app (electron-vite) |
| `npm test` | unit tests + real-FFmpeg integration tests (vitest) |
| `npm run e2e` | drives the real Electron UI end-to-end with Playwright (needs Xvfb on Linux) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run cli -- make --voice v.wav --clips ./clips --out reel.mp4` | headless pipeline (same engine) |
| `npm run gen:sfx` | regenerate the built-in SFX library |
| `npm run test:media -- <dir>` | build a test set (espeak voice with exact word timings + synthetic screen recordings) |
| `npm run dist` | package installers with electron-builder (see `vendor/ffmpeg/README.md`) |

## Your own sound effects

Drop `.wav`/`.mp3` files into the app's user SFX folder (`<userData>/sfx/{click,pop,whoosh,impact}/`)
or into `assets/sfx/<category>/` in a source checkout. They are picked up on the next Generate.

## Projects

Each project is a folder in `Documents/Local Reel Editor/` with `project.reel.json` (all
metadata, transcript with word timestamps, timeline, captions, SFX, render settings) and
`cache/` (proxies, thumbnails). Re-opening a project never re-transcribes. Original media is
never modified.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.
