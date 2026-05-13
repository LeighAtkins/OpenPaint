#!/usr/bin/env python3
"""Prepare YOLO-Pose dataset from bootstrapped + reviewed annotations.

Handles:
- Merging bootstrapped labels with manual corrections JSON
- Resizing source images from large PNGs to 1024px max-edge JPEGs
- RGBA → RGB conversion
- Stratified train/val/test split (80/15/5) by aspect ratio
- Writing dataset.yaml for Ultralytics

Output structure:
  /mnt/d/dataset_pipeline/yolo_pose_v1/
  ├── dataset.yaml
  ├── images/{train,val,test}/
  └── labels/{train,val,test}/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image


NUM_KEYPOINTS = 20
MAX_EDGE = 1024
JPEG_QUALITY = 92

V1_ROLES = ["W", "H", "A1", "A2", "C3", "C4", "E1", "D", "C1", "B1"]
V2_ROLES = ["B1", "C1", "A1", "A2", "C3", "C4", "E1", "D", "B2", "A3"]


def resize_and_convert(src: Path, dst: Path, max_edge: int) -> Tuple[int, int]:
    """Load image, convert RGBA→RGB, resize to max_edge, save as JPEG."""
    img = Image.open(src)

    # RGBA → RGB
    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        if img.mode in ("RGBA", "LA"):
            background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    w, h = img.size
    if max(w, h) > max_edge:
        scale = max_edge / max(w, h)
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        w, h = new_w, new_h

    img.save(dst, "JPEG", quality=JPEG_QUALITY)
    return w, h


def aspect_ratio_bin(w: int, h: int) -> str:
    """Bin images by aspect ratio for stratified splitting."""
    ar = w / max(1, h)
    if ar < 0.75:
        return "tall"
    elif ar < 1.1:
        return "square"
    else:
        return "wide"


def deterministic_split(name: str, val_names: set, test_ratio: float = 0.05) -> str:
    """Assign split: manually reviewed → val, rest → train/test by hash."""
    if name in val_names:
        return "val"
    h = int(hashlib.sha256(name.encode()).hexdigest()[:8], 16) % 1000
    if h < int(test_ratio * 1000):
        return "test"
    return "train"


def load_corrections(path: Path) -> Dict[str, dict]:
    """Load corrections JSON from the review tool."""
    if not path or not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data


def merge_label(bootstrap_line: str, correction_entry: Optional[dict]) -> str:
    """Merge a bootstrap label line with optional corrections."""
    if not correction_entry or "keypoints" not in correction_entry:
        return bootstrap_line

    parts = bootstrap_line.strip().split()
    if len(parts) < 5 + NUM_KEYPOINTS * 3:
        return bootstrap_line

    # Keep class_id and bbox from bootstrap
    new_parts = parts[:5]
    kpts = correction_entry["keypoints"]
    for i in range(NUM_KEYPOINTS):
        new_parts.append(f"{kpts[i * 3]:.6f}")
        new_parts.append(f"{kpts[i * 3 + 1]:.6f}")
        new_parts.append(str(int(kpts[i * 3 + 2])))

    return " ".join(new_parts)


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare YOLO-Pose dataset")
    parser.add_argument(
        "--images",
        default="/mnt/d/dataset_pipeline/filtered_yolo/images",
        help="Source images directory",
    )
    parser.add_argument(
        "--labels",
        default="/mnt/d/dataset_pipeline/yolo_pose_v1/labels_bootstrap",
        help="Bootstrap labels directory",
    )
    parser.add_argument(
        "--corrections",
        default="",
        help="Corrections JSON from review tool (optional)",
    )
    parser.add_argument(
        "--merged-labels",
        default="",
        help="Merged labels JSON from review tool (optional)",
    )
    parser.add_argument(
        "--reviewed-list",
        default="",
        help="Text file with names of manually reviewed images (one per line, for val set)",
    )
    parser.add_argument(
        "--output",
        default="/mnt/d/dataset_pipeline/yolo_pose_v1",
        help="Output root for dataset",
    )
    parser.add_argument(
        "--max-edge",
        type=int,
        default=MAX_EDGE,
        help="Max edge for resized images",
    )
    args = parser.parse_args()

    images_dir = Path(args.images)
    labels_dir = Path(args.labels)
    output_root = Path(args.output)

    if not images_dir.exists():
        print(f"ERROR: images directory not found: {images_dir}", file=sys.stderr)
        return 1
    if not labels_dir.exists():
        print(f"ERROR: labels directory not found: {labels_dir}", file=sys.stderr)
        return 1

    # Load corrections and merged labels
    corrections = {}
    if args.corrections:
        corrections = load_corrections(Path(args.corrections))
        print(f"[prepare] Loaded {len(corrections)} corrections")

    merged_labels = {}
    if args.merged_labels:
        merged_path = Path(args.merged_labels)
        if merged_path.exists():
            merged_labels = json.loads(merged_path.read_text(encoding="utf-8"))
            print(f"[prepare] Loaded {len(merged_labels)} merged labels")

    # Load reviewed names for val set
    val_names: set = set()
    if args.reviewed_list:
        reviewed_path = Path(args.reviewed_list)
        if reviewed_path.exists():
            val_names = {
                line.strip()
                for line in reviewed_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            }
            print(f"[prepare] {len(val_names)} manually reviewed images → val set")

    # Also add corrected/accepted images from corrections to val set
    for name, entry in corrections.items():
        status = entry.get("status", "pending")
        if status in ("accepted", "corrected"):
            val_names.add(name)

    # Discover images with matching labels
    image_files = sorted(
        p for p in images_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    )

    # Create output directories
    for split in ("train", "val", "test"):
        (output_root / "images" / split).mkdir(parents=True, exist_ok=True)
        (output_root / "labels" / split).mkdir(parents=True, exist_ok=True)

    splits = {"train": [], "val": [], "test": []}
    skipped = 0

    for img_path in image_files:
        stem = img_path.stem
        label_path = labels_dir / (stem + ".txt")

        # Check if flagged in corrections or merged labels — skip entirely
        corr_status = corrections.get(stem, {}).get("status", "")
        merged_entry = merged_labels.get(stem)
        if isinstance(merged_entry, dict):
            merged_status = merged_entry.get("status", "")
        else:
            merged_status = ""
        if corr_status == "flagged" or merged_status == "flagged":
            skipped += 1
            continue

        # Check for label from merged, bootstrap, or skip
        if merged_entry is not None:
            if isinstance(merged_entry, dict):
                label_line = merged_entry.get("label", "")
            else:
                label_line = merged_entry  # legacy plain string format
        elif label_path.exists():
            label_line = label_path.read_text(encoding="utf-8").strip()
            # Apply corrections if available
            label_line = merge_label(label_line, corrections.get(stem))
        else:
            skipped += 1
            continue

        if not label_line:
            skipped += 1
            continue

        # Determine split
        split = deterministic_split(stem, val_names)

        # Resize image
        out_img = output_root / "images" / split / (stem + ".jpg")
        try:
            new_w, new_h = resize_and_convert(img_path, out_img, args.max_edge)
        except Exception as e:
            print(f"[prepare] WARN: failed to process {img_path.name}: {e}")
            skipped += 1
            continue

        # Write label
        out_label = output_root / "labels" / split / (stem + ".txt")
        out_label.write_text(label_line + "\n", encoding="utf-8")

        splits[split].append(stem)

    # Enforce minimum val/test sizes by moving from train
    min_val = max(10, int(len(splits["train"]) * 0.12))
    min_test = max(5, int(len(splits["train"]) * 0.04))

    if len(splits["val"]) < min_val:
        needed = min_val - len(splits["val"])
        # Move from train (sorted by hash for determinism)
        candidates = sorted(splits["train"], key=lambda n: hashlib.sha256(n.encode()).hexdigest())
        to_move = candidates[:needed]
        for name in to_move:
            splits["train"].remove(name)
            splits["val"].append(name)
            # Move files
            for subdir in ("images", "labels"):
                ext = ".jpg" if subdir == "images" else ".txt"
                src = output_root / subdir / "train" / (name + ext)
                dst = output_root / subdir / "val" / (name + ext)
                if src.exists():
                    shutil.move(str(src), str(dst))

    if len(splits["test"]) < min_test:
        needed = min_test - len(splits["test"])
        candidates = sorted(splits["train"], key=lambda n: hashlib.sha256(("test" + n).encode()).hexdigest())
        to_move = candidates[:needed]
        for name in to_move:
            splits["train"].remove(name)
            splits["test"].append(name)
            for subdir in ("images", "labels"):
                ext = ".jpg" if subdir == "images" else ".txt"
                src = output_root / subdir / "train" / (name + ext)
                dst = output_root / subdir / "test" / (name + ext)
                if src.exists():
                    shutil.move(str(src), str(dst))

    # Write dataset.yaml
    yaml_path = output_root / "dataset.yaml"
    yaml_content = f"""# YOLOv8-Pose Furniture Keypoint Dataset (V1)
# Auto-generated by prepare_dataset.py

path: {output_root}
train: images/train
val: images/val
test: images/test

# Single class: furniture
names:
  0: furniture

# 20 keypoints (10 measurement roles x 2 endpoints)
# Format: [num_keypoints, dims_per_keypoint]
# dims=3: x, y, visibility
kpt_shape: [20, 3]

# No flip_idx for V1 — left/right symmetry mapping not verified
# flip_idx: []
"""
    yaml_path.write_text(yaml_content, encoding="utf-8")

    # Summary
    total = sum(len(v) for v in splits.values())
    summary = {
        "total": total,
        "skipped": skipped,
        "splits": {k: len(v) for k, v in splits.items()},
        "val_from_reviewed": len(val_names),
        "corrections_applied": len([n for n in corrections if n in {s for v in splits.values() for s in v}]),
        "output": str(output_root),
    }

    summary_path = output_root / "dataset_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"\n[prepare] Dataset ready at {output_root}")
    print(f"  train: {len(splits['train'])}")
    print(f"  val:   {len(splits['val'])}")
    print(f"  test:  {len(splits['test'])}")
    print(f"  total: {total}")
    print(f"  skipped: {skipped}")
    print(f"  dataset.yaml: {yaml_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
