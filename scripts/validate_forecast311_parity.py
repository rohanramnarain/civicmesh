#!/usr/bin/env python3
"""Validate ONNX model outputs against parity fixtures.

Run from repo root:
    uv run --project apps/api python scripts/validate_forecast311_parity.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort


MODEL_DIR = Path(__file__).resolve().parents[1] / "public" / "models" / "forecast311" / "v1"
FIXTURES_PATH = MODEL_DIR / "parity-fixtures.json"
MODEL_CARD_PATH = MODEL_DIR / "model-card.json"


def load_model_card() -> dict:
    with MODEL_CARD_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def validate_checksums() -> list[str]:
    """Verify model files match checksums declared in model-card.json."""
    import hashlib

    errors: list[str] = []
    model_card = load_model_card()
    declared = {m["onnx_file"]: m["checksum"] for m in model_card["models"]}

    for onnx_file, expected in declared.items():
        path = MODEL_DIR / onnx_file
        if not path.exists():
            errors.append(f"Missing model file: {onnx_file}")
            continue

        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        expected_digest = expected.removeprefix("sha256:")
        if digest != expected_digest:
            errors.append(
                f"Checksum mismatch for {onnx_file}: expected {expected_digest}, got {digest}"
            )

    return errors


def validate_parity() -> list[str]:
    """Run parity fixtures through each ONNX model and check predictions."""
    errors: list[str] = []

    if not FIXTURES_PATH.exists():
        errors.append(f"Parity fixtures not found at {FIXTURES_PATH}")
        return errors

    with FIXTURES_PATH.open("r", encoding="utf-8") as fh:
        fixtures = json.load(fh)

    model_card = load_model_card()
    model_names = {m["model_name"]: m["onnx_file"] for m in model_card["models"]}

    for model_name, fixture in fixtures.items():
        onnx_file = model_names.get(model_name)
        if onnx_file is None:
            errors.append(f"Unknown model in fixtures: {model_name}")
            continue

        model_path = MODEL_DIR / onnx_file
        if not model_path.exists():
            errors.append(f"Model file not found: {onnx_file}")
            continue

        input_vector = np.array(fixture["input"], dtype=np.float32).reshape(1, -1)
        expected = float(fixture["expected_prediction"])
        tolerance = float(fixture["tolerance"])

        try:
            session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
            input_name = session.get_inputs()[0].name
            outputs = session.run(None, {input_name: input_vector})
            prediction = float(np.maximum(0, outputs[0].flatten()[0]))
        except Exception as exc:  # pragma: no cover
            errors.append(f"Inference failed for {model_name}: {exc}")
            continue

        if abs(prediction - expected) > tolerance:
            errors.append(
                f"{model_name} prediction mismatch: expected {expected} ± {tolerance}, got {prediction}"
            )
        else:
            print(f"✓ {model_name}: predicted {prediction:.6f} (expected {expected} ± {tolerance})")

    return errors


def main() -> int:
    print("Validating model checksums...")
    checksum_errors = validate_checksums()
    if checksum_errors:
        print("Checksum validation failed:")
        for err in checksum_errors:
            print(f"  ✗ {err}")
    else:
        print("✓ All model checksums match model-card.json")

    print("\nValidating parity fixtures...")
    parity_errors = validate_parity()
    if parity_errors:
        print("Parity validation failed:")
        for err in parity_errors:
            print(f"  ✗ {err}")

    total_errors = len(checksum_errors) + len(parity_errors)
    if total_errors == 0:
        print("\n✓ All model validations passed")
        return 0

    print(f"\n✗ {total_errors} validation error(s) found")
    return 1


if __name__ == "__main__":
    sys.exit(main())
