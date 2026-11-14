#!/usr/bin/env python3
"""Offline Vosk ASR for WO-008. Emits word-level JSON; no network, no secrets."""
import argparse
import json
import os
import subprocess
import tempfile
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--sample-rate", type=int, default=16000)
    args = parser.parse_args()

    converted = tempfile.mktemp(suffix=".wav")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                args.input,
                "-ar",
                str(args.sample_rate),
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                converted,
            ],
            check=True,
        )
        model = Model(args.model)
        recognizer = KaldiRecognizer(model, args.sample_rate)
        recognizer.SetWords(True)
        words = []
        with wave.open(converted, "rb") as audio:
            audio.readframes(0)
            while True:
                data = audio.readframes(4000)
                if not data:
                    break
                if recognizer.AcceptWaveform(data):
                    result = json.loads(recognizer.Result())
                    words.extend(result.get("result", []))
        words.extend(json.loads(recognizer.FinalResult()).get("result", []))
        payload = {
            "schemaVersion": 1,
            "provider": "vosk",
            "model": os.path.basename(args.model.rstrip("/\\")),
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
        with open(args.output, "w", encoding="utf-8") as output:
            json.dump(payload, output, ensure_ascii=False, indent=2)
            output.write("\n")
        print(json.dumps({"words": len(payload["words"]), "output": args.output}, ensure_ascii=False))
    finally:
        try:
            os.remove(converted)
        except OSError:
            pass


if __name__ == "__main__":
    main()
