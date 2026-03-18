#!/usr/bin/env python3
"""
Apply corrections from annotation-review.html back to YOLO-Pose label files.

Reads merged_labels.json exported by the review tool and overwrites .txt label
files for images marked as "accepted" or "corrected".

Usage:
    python scripts/apply_corrections.py \
        --labels-dir datasets/yolo_pose_v2_pseudo_strict/labels/train \
        --corrections merged_labels.json \
        [--dry-run]
"""

import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Apply keypoint corrections to YOLO-Pose label files"
    )
    parser.add_argument(
        "--labels-dir", required=True, type=Path,
        help="Directory containing .txt label files to overwrite"
    )
    parser.add_argument(
        "--corrections", required=True, type=Path,
        help="Path to merged_labels.json from annotation-review.html"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would be written without modifying files"
    )
    args = parser.parse_args()

    if not args.labels_dir.is_dir():
        print(f"Error: labels directory not found: {args.labels_dir}", file=sys.stderr)
        sys.exit(1)

    if not args.corrections.is_file():
        print(f"Error: corrections file not found: {args.corrections}", file=sys.stderr)
        sys.exit(1)

    with open(args.corrections) as f:
        data = json.load(f)

    written = 0
    skipped = 0
    missing = 0

    for name, entry in data.items():
        # Support both formats: plain string (legacy) or {label, status} object
        if isinstance(entry, str):
            label_line = entry
            status = "accepted"
        elif isinstance(entry, dict):
            label_line = entry.get("label", "")
            status = entry.get("status", "pending")
        else:
            skipped += 1
            continue

        # Only write labels for accepted or corrected images
        if status not in ("accepted", "corrected"):
            skipped += 1
            continue

        if not label_line.strip():
            skipped += 1
            continue

        label_path = args.labels_dir / f"{name}.txt"

        if args.dry_run:
            exists = "overwrite" if label_path.exists() else "create"
            print(f"[DRY RUN] Would {exists}: {label_path} ({status})")
        else:
            label_path.write_text(label_line.strip() + "\n")

        written += 1

    action = "Would write" if args.dry_run else "Wrote"
    print(f"\n{action} {written} label files, skipped {skipped} (pending/flagged)")
    if missing > 0:
        print(f"  {missing} files had no label data")


if __name__ == "__main__":
    main()
