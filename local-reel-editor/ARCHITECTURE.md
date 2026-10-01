# Architecture

## Stack (and why)

- **Electron + React + TypeScript + Tailwind**, built with electron-vite. Chosen over Tauri because
  the heavy work is done by external processes (FFmpeg, Python/faster-whisper) anyway, and Electron
  gives one language (TS) for UI, planner and orchestration, a Chromium `<video>`/canvas for an
  instant preview, and mature packaging on all three OSes.
- **FFmpeg / FFprobe** — every video/audio operation: probe, proxies, motion analysis, trim, compose,
  zoom/pan, xfade transitions, ASS captions (libass), voice + SFX mix, H.264/AAC encode.
- **faster-whisper** (local) in a Python sidecar with a private venv — word-level timestamps, no API.
  Model sizes: Fast = `base`, Balanced = `small` (default), Accurate = `large-v3-turbo`.

## Layout

```
src/core/       pure TypeScript, no Node/Electron APIs — runs in UI, main process, CLI and tests
  model/          Project types, defaults, project.reel.json (de)serialisation
  text/           normalisation, RU/EN Snowball stemming, bilingual UI-concept synonyms
  transcript/     words → phrases (punctuation + pauses)
  matcher/        ClipMatcher: phrase ↔ clip-label scores and confidence
  planner/        MontagePlanner: sections (Viterbi), shots, source ranges, transitions, presets
  motion/         MotionEngine: fit modes, viewport/easing shared by preview and renderer
  captions/       CaptionEngine: one-word captions, safe zones, auto-fit, ASS writer
  sfx/            SfxPlanner: sparse quiet click/pop/whoosh/impact placement
  qa/             QualityChecker: coverage, black frames, static shots, density, captions, audio
  edit/           undoable timeline operations (trim/roll, slip, replace, move, zoom, SFX…)
  render/         RenderPlan: project model → FFmpeg jobs (argument arrays + files)
src/engine/     Node side, used by Electron main and the CLI
  Studio.ts       application façade
  project/        ProjectManager (folders, atomic saves, recent list)
  media/          probe, importer (thumbnail, proxy, motion analysis), audio analysis
  transcription/  TranscriptionEngine (venv install, model download, transcribe)
  ffmpeg/         locate (+ HW encoder detection), async runner with progress/cancel
  export/         ExportManager (parallel shot renders → final mix, temp file + rename)
  sfx/            SFX library scanner
src/main/       Electron main: IPC handlers, jobs + cancellation, media:// protocol (Range)
src/preload/    minimal bridge (invoke / file paths / progress events)
src/renderer/   React UI: Home, Setup, Generating, Editor (preview, timeline, properties, export)
python/         transcribe.py sidecar (JSON lines)
cli/            headless CLI over Studio
```

The UI never sees FFmpeg strings: it edits the **project model**; the preview reads the model;
`RenderPlan` compiles the model to FFmpeg jobs at export.

## Data flow

```
Voice + Clips ──import──► probe · waveform/levels · proxy · thumbnail · motion activity
      │
      ▼
Transcription (faster-whisper, word timestamps)  — stored in project.reel.json
      ▼
Matching: phrases → clip scores (stems, fuzzy, concepts) → Viterbi with continuity → sections
      ▼
Montage plan: shots at word boundaries (style rhythm) · source ranges (jump cuts on UI events,
continuous playback + motion for short clips) · punch-ins focused on on-screen activity ·
mostly cuts, rare light transitions · sparse quiet SFX · one-word captions · QA
      ▼
Preview: canvas compositing of proxies, voice = master clock, WebAudio SFX (no rendering)
      ▼
Render: one FFmpeg job per shot (trim/retime/compose/zoompan) → final job (concat/xfade,
ASS captions, voice+SFX mix with peak-safety limiter, H.264/AAC 1080×1920) → atomic rename
```

## Key decisions

- **Voice is the master track**: never cut/sped; the timeline is tiled exactly on the global frame
  grid (`round(t·fps)`), so the video has exactly `round(voiceDuration·fps)` frames.
- **Deterministic**: the planner seed is a hash of transcript, clip labels/durations, style and
  `variation`. Same inputs → same edit; **Variation** changes only the seed.
- **Smooth by default**: one continuous camera move per topic (velocity-matched in → linear → out sine easing across cuts); a soft transition at every topic change (dissolve, eased slide or zoom-through); short dissolves on jump cuts;
  zoom 100→108–112 % (max 115 %); SFX −22…−16 dB, ≥2.4 s apart, never the same file twice in a row.
- **Low confidence never blocks**: weak sections get a guess (continuity / coverage) and a
  "Which clip matches this section?" card; answers are stored as `phraseOverrides`.
- **Motion has a reason**: zoom focus is the energy-weighted centroid of pixel changes in the source
  window; jump cuts snap to detected UI actions; clicks are placed on those actions.
- **Preview ≠ render, same maths**: `viewportAt()` and the cubic easing are shared; the FFmpeg
  expression is generated from the same constants. Static zooms use exact crops; animated zooms use
  zoompan on a 2× supersampled frame to avoid sub-pixel jitter.
- **Robustness**: every FFmpeg run is a separate cancellable process; failures stop sibling jobs,
  remove temp files and never touch the project; errors carry a user message + "Show details".

## Hard parts / risks

- Matching quality depends on clip names; mitigated by concepts, continuity and the review prompt.
- Whisper word timings drift on music/noise; we keep `vad_filter` off so no speech is dropped.
- Preview sync relies on proxies with short GOP (`-g 10`) for fast seeking.
- Python must exist for the speech engine (we explain and link to python.org; a bundled runtime is
  a packaging follow-up).

## Phases — status

| Phase | Status |
|---|---|
| 1 Foundation: shell, projects, import, persistence, FFmpeg detection, preview | done |
| 2 Audio: Whisper sidecar, word timestamps, waveform, caption model | done* |
| 3 Basic auto edit: matching, MontagePlanner, cuts, 9:16, sync | done |
| 4 Captions: one word, animation, style, safe zones | done |
| 5 Polish: zoom, motion, transitions, SFX | done |
| 6 Editor: timeline, replace, trim, properties, undo/redo | done |
| 7 Export: quality presets, progress, cancel, HW encoder option | done |
| 8 QA: unit + real-FFmpeg integration + Electron e2e | done on synthetic media |

\* faster-whisper install was verified in CI-like sandbox; model download there is blocked by the
network policy, so end-to-end tests use an espeak voice with exact ground-truth word timings in the
same JSON format the sidecar emits. Real-voice testing on a user machine is the next QA step.
