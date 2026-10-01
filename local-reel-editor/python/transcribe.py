#!/usr/bin/env python3
"""
Local speech-to-text sidecar for Local Reel Editor (faster-whisper).

Commands (all output is JSON lines on stdout):
  check                                  -> {"type":"check", "faster_whisper": "<ver>"}
  download --model SIZE --models-dir D   -> {"type":"downloaded", "path": ...}
  transcribe --audio F --model SIZE --models-dir D [--language ru|en|auto]
                                         -> {"type":"progress","value":0..1} ... {"type":"result", ...}
Errors: {"type":"error","code":...,"message":...}
Audio never leaves the machine.
"""
import argparse
import json
import os
import sys
import traceback

REPOS = {
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v3-turbo": "mobiuslabs/faster-whisper-large-v3-turbo",
}


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def model_dir(models_dir, size):
    return os.path.join(models_dir, size)


def has_model(path):
    return os.path.isfile(os.path.join(path, "model.bin")) and os.path.isfile(os.path.join(path, "config.json"))


def cmd_check(_args):
    try:
        import faster_whisper  # noqa: F401
        from faster_whisper import __version__ as ver
    except Exception as e:  # pragma: no cover - reported to UI
        emit({"type": "error", "code": "engine-missing", "message": str(e)})
        return 2
    emit({"type": "check", "faster_whisper": ver})
    return 0


def cmd_download(args):
    from faster_whisper.utils import download_model

    target = model_dir(args.models_dir, args.model)
    os.makedirs(target, exist_ok=True)
    repo = REPOS.get(args.model, args.model)
    try:
        path = download_model(repo, output_dir=target)
    except Exception as e:
        emit({"type": "error", "code": "download-failed", "message": str(e), "details": traceback.format_exc()})
        return 3
    emit({"type": "downloaded", "path": path})
    return 0


def cmd_transcribe(args):
    from faster_whisper import WhisperModel

    target = model_dir(args.models_dir, args.model)
    if not has_model(target):
        emit({"type": "error", "code": "model-missing", "message": "Speech model is not downloaded yet."})
        return 4
    threads = max(1, (os.cpu_count() or 4) - 1)
    try:
        model = WhisperModel(target, device=args.device, compute_type=args.compute_type, cpu_threads=threads)
    except Exception:
        model = WhisperModel(target, device="cpu", compute_type="int8", cpu_threads=threads)
    language = None if args.language in (None, "", "auto") else args.language
    segments, info = model.transcribe(
        args.audio,
        language=language,
        word_timestamps=True,
        beam_size=5,
        vad_filter=False,  # never drop speech: the voice-over is the master track
        condition_on_previous_text=False,
    )
    duration = float(info.duration or 0) or 1.0
    words = []
    texts = []
    for seg in segments:
        texts.append(seg.text.strip())
        for w in seg.words or []:
            words.append({
                "text": w.word.strip(),
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
                "probability": round(float(w.probability), 3),
            })
        emit({"type": "progress", "value": min(1.0, float(seg.end) / duration)})
    emit({
        "type": "result",
        "language": info.language,
        "text": " ".join(t for t in texts if t),
        "words": [w for w in words if w["text"]],
        "duration": duration,
    })
    return 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["check", "download", "transcribe"])
    p.add_argument("--audio")
    p.add_argument("--model", default="small")
    p.add_argument("--models-dir", default=os.path.expanduser("~/.local-reel-editor/models"))
    p.add_argument("--language", default="auto")
    p.add_argument("--device", default="auto")
    p.add_argument("--compute-type", default="int8")
    args = p.parse_args()
    try:
        return {"check": cmd_check, "download": cmd_download, "transcribe": cmd_transcribe}[args.command](args)
    except Exception as e:
        emit({"type": "error", "code": "crash", "message": str(e), "details": traceback.format_exc()})
        return 1


if __name__ == "__main__":
    sys.exit(main())
