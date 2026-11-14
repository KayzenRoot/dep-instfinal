#!/usr/bin/env python3
"""Offline Vosk ASR for WO-008. Emits word-level JSON on stdout; no network.

The narration take is WAV/PCM. This helper resamples to 16 kHz with the Python
standard library so no external command receives CLI-controlled paths.
"""
import argparse
import array
import json
import os
import sys
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


def read_pcm16_mono(path: str) -> tuple[array.array, int]:
    with wave.open(path, "rb") as audio:
        if audio.getsampwidth() != 2:
            raise SystemExit("input must be 16-bit PCM WAV")
        channels = audio.getnchannels()
        rate = audio.getframerate()
        raw = audio.readframes(audio.getnframes())
    samples = array.array("h", raw)
    if sys.byteorder == "big":
        samples.byteswap()
    if channels == 2:
        samples = array.array(
            "h", ((samples[index] + samples[index + 1]) // 2 for index in range(0, len(samples), 2))
        )
    elif channels != 1:
        raise SystemExit("input must be mono or stereo")
    return samples, rate


def resample(samples: array.array, rate: int, target: int = 16000) -> array.array:
    if rate == target:
        return samples
    ratio = rate / target
    length = max(1, int(len(samples) / ratio))
    return array.array("h", (samples[min(len(samples) - 1, int(index * ratio))] for index in range(length)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--sample-rate", type=int, default=16000)
    args = parser.parse_args()

    input_path = checked_file(args.input, "input")
    model_path = checked_dir(args.model, "model")
    samples, rate = read_pcm16_mono(input_path)
    resampled = resample(samples, rate, args.sample_rate)
    pcm = resampled.tobytes()
    model = Model(model_path)
    recognizer = KaldiRecognizer(model, args.sample_rate)
    recognizer.SetWords(True)
    words = []
    for offset in range(0, len(pcm), 8000):
        if recognizer.AcceptWaveform(pcm[offset : offset + 8000]):
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
