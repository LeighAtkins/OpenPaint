#!/usr/bin/env python3
"""Prepare a binary arm/no-arm image-classification dataset.

Strategy implemented:
- Positive class (arm): stems present in merged_labels JSON
- Negative class (no_arm): random stems from customer photos not in positives

This is a weak-label bootstrap for quick iteration. Review sampled no_arm
candidates before relying on metrics.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import shutil
from dataclasses import dataclass
from pathlib import Path


VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


@dataclass
class Example:
    stem: str
    class_name: str
    split: str
    source: str
    file_path: Path
    status: str


def stable_split(stem: str) -> str:
    h = hashlib.sha1(stem.encode("utf-8")).hexdigest()
    bucket = int(h[:8], 16) % 100
    if bucket < 80:
        return "train"
    if bucket < 90:
        return "val"
    return "test"


def discover_photo_files(photo_dir: Path) -> dict[str, Path]:
    stem_to_path: dict[str, Path] = {}
    for p in sorted(photo_dir.iterdir()):
        if not p.is_file() or p.suffix.lower() not in VALID_EXTS:
            continue
        stem = p.stem
        if stem not in stem_to_path:
            stem_to_path[stem] = p
    return stem_to_path


def parse_status_filter(raw: str) -> set[str] | None:
    value = (raw or "").strip()
    if value in {"", "*", "all"}:
        return None
    return {s.strip() for s in value.split(",") if s.strip()}


def load_positive_stems(labels_json: Path, status_filter: set[str] | None) -> tuple[set[str], dict[str, str]]:
    payload = json.loads(labels_json.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("labels JSON must be an object keyed by photo stem")

    positives: set[str] = set()
    status_by_stem: dict[str, str] = {}
    for stem, rec in payload.items():
        if not isinstance(stem, str):
            continue
        if not isinstance(rec, dict):
            continue
        status = str(rec.get("status", "")).strip() or "unknown"
        if status_filter is not None and status not in status_filter:
            continue
        positives.add(stem)
        status_by_stem[stem] = status
    return positives, status_by_stem


def ensure_dirs(base: Path) -> None:
    for split in ("train", "val", "test"):
        for cls in ("arm", "no_arm"):
            (base / split / cls).mkdir(parents=True, exist_ok=True)


def place_image(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare arm/no-arm classification dataset")
    parser.add_argument(
        "--labels-json",
        default="/mnt/c/Users/Memory is RAM/Downloads/merged_labels (5).json",
        help="Path to merged labels JSON",
    )
    parser.add_argument(
        "--photos-dir",
        default="/mnt/d/customer-photos",
        help="Directory containing photo_* images",
    )
    parser.add_argument(
        "--out-dir",
        default="/mnt/d/dataset_pipeline/yolo_arm_binary",
        help="Output dataset root",
    )
    parser.add_argument(
        "--positive-statuses",
        default="all",
        help="Comma list of statuses to treat as arm positives, or 'all'",
    )
    parser.add_argument(
        "--no-arm-count",
        type=int,
        default=0,
        help="Number of no_arm samples (0 = match positive count)",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for negative sampling")
    args = parser.parse_args()

    labels_json = Path(args.labels_json)
    photos_dir = Path(args.photos_dir)
    out_dir = Path(args.out_dir)
    images_root = out_dir / "images"
    reports_root = out_dir / "reports"

    if not labels_json.exists():
        raise SystemExit(f"ERROR: labels JSON not found: {labels_json}")
    if not photos_dir.exists():
        raise SystemExit(f"ERROR: photos dir not found: {photos_dir}")

    status_filter = parse_status_filter(args.positive_statuses)
    positive_stems_all, status_by_stem = load_positive_stems(labels_json, status_filter)
    stem_to_path = discover_photo_files(photos_dir)

    positive_stems = sorted(s for s in positive_stems_all if s in stem_to_path)
    missing_positive = sorted(s for s in positive_stems_all if s not in stem_to_path)

    if not positive_stems:
        raise SystemExit("ERROR: no positive stems found in photo directory")

    negative_pool = sorted(set(stem_to_path.keys()) - set(positive_stems))
    target_negatives = args.no_arm_count if args.no_arm_count > 0 else len(positive_stems)
    target_negatives = min(target_negatives, len(negative_pool))

    rng = random.Random(args.seed)
    negative_stems = sorted(rng.sample(negative_pool, target_negatives))

    ensure_dirs(images_root)
    reports_root.mkdir(parents=True, exist_ok=True)

    examples: list[Example] = []

    for stem in positive_stems:
        src = stem_to_path[stem]
        split = stable_split(stem)
        dst = images_root / split / "arm" / f"{stem}{src.suffix.lower()}"
        place_image(src, dst)
        examples.append(
            Example(
                stem=stem,
                class_name="arm",
                split=split,
                source="merged_labels",
                file_path=dst,
                status=status_by_stem.get(stem, "unknown"),
            )
        )

    for stem in negative_stems:
        src = stem_to_path[stem]
        split = stable_split(stem)
        dst = images_root / split / "no_arm" / f"{stem}{src.suffix.lower()}"
        place_image(src, dst)
        examples.append(
            Example(
                stem=stem,
                class_name="no_arm",
                split=split,
                source="sampled_unlabeled",
                file_path=dst,
                status="",
            )
        )

    with (reports_root / "manifest.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["stem", "class", "split", "source", "status", "file_path"])
        for ex in examples:
            w.writerow([ex.stem, ex.class_name, ex.split, ex.source, ex.status, str(ex.file_path)])

    with (reports_root / "no_arm_candidates.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["stem", "path"])
        for stem in negative_stems:
            w.writerow([stem, str(stem_to_path[stem])])

    split_counts: dict[str, dict[str, int]] = {
        "train": {"arm": 0, "no_arm": 0},
        "val": {"arm": 0, "no_arm": 0},
        "test": {"arm": 0, "no_arm": 0},
    }
    for ex in examples:
        split_counts[ex.split][ex.class_name] += 1

    summary = {
        "labels_json": str(labels_json),
        "photos_dir": str(photos_dir),
        "out_dir": str(out_dir),
        "positive_statuses": sorted(status_filter) if status_filter is not None else "all",
        "positives_requested": len(positive_stems_all),
        "positives_found": len(positive_stems),
        "positives_missing": len(missing_positive),
        "no_arm_sampled": len(negative_stems),
        "negative_pool_total": len(negative_pool),
        "weak_negative_labels": True,
        "split_counts": split_counts,
    }
    (reports_root / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("[arm-dataset] Prepared dataset")
    print(f"  images root: {images_root}")
    print(f"  manifest:    {reports_root / 'manifest.csv'}")
    print(f"  summary:     {reports_root / 'summary.json'}")
    print(f"  positives:   {len(positive_stems)}")
    print(f"  no_arm:      {len(negative_stems)}")
    if missing_positive:
        print(f"  missing positives: {len(missing_positive)} (see summary)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
