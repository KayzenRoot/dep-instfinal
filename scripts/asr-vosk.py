#!/usr/bin/env python3
"""Offline Vosk ASR for WO-008. Emits word-level JSON on stdout; no network."""
import argparse
import json
import os
import subprocess
import tempfile
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)


def checked_file(value: str, label: str) -> str:
    path = os.path.realpath(os.path.abspath(value))
    if path.startswith("-") or not os.path.isfile(path):
        raise SystemExit(f"{label} must be an existing file")
    return path


def checked_dir(value: str, label: str) -> str:
    path = os.path.realpath(os.path.abspath(value))
    if not os.path.isdir(path):
        raise SystemExit(f"{label} must be an existing directory")
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--sample-rate", type=int, default=16000)
    args = parser.parse_args()

    input_path = checked_file(args.input, "input")
    model_path = checked_dir(args.model, "model")
    with tempfile.TemporaryDirectory(prefix="dif-asr-") as directory:
        converted = os.path.join(directory, "input.wav")
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                input_path,
                "-ar",
                str(args.sample_rate),
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                converted,
            ],
            check=True,
            shell=False,
        )
        model = Model(model_path)
        recognizer = KaldiRecognizer(model, args.sample_rate)
        recognizer.SetWords(True)
        words = []
        with wave.open(converted, "rb") as audio:
            while True:
                data = audio.readframes(4000)
                if not data:
                    break
                if recognizer.AcceptWaveform(data):
                    words.extend(json.loads(recognizer.Result()).get("result", []))
        words.extend(json.loads(recognizer.FinalResult()).get("result", []))
    payload = {
        "schemaVersion": 1,
        "provider": "vosk",
        "model": os.path.basename(model_path),
        "sampleRate": args.sample_rate,
        "words": [
            {
                "word": item["word"],
                "startMs": round(float(item["start"]) * 1000),
                "endMs": round(float(item["end"]) * 1000),
                "confidence": float(item.get("conf", 0)),
            }
            for item in words
        ],
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
