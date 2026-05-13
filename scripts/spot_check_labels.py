#!/usr/bin/env python3
"""Spot-check pseudo labels by drawing them on a random sample of images.

Usage:
    python scripts/spot_check_labels.py \
        --images /mnt/d/dataset_pipeline/yolo_pose_v2_pseudo/images/train \
        --labels /mnt/d/dataset_pipeline/yolo_pose_v2_pseudo/labels/train \
        --output /mnt/d/dataset_pipeline/spot_check \
        --n 30
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

import cv2
import numpy as np

NUM_KEYPOINTS = 20
ROLE_NAMES = ["W", "H", "A1", "A2", "C3", "C4", "E1", "D", "C1", "B1"]
ROLE_KPT_INDICES = {
    "W": (0, 1), "H": (2, 3), "A1": (4, 5), "A2": (6, 7), "C3": (8, 9),
    "C4": (10, 11), "E1": (12, 13), "D": (14, 15), "C1": (16, 17), "B1": (18, 19),
}

# Distinct colors per role (BGR)
ROLE_COLORS = {
    "W":  (0, 255, 255),   # yellow
    "H":  (0, 200, 0),     # green
    "A1": (255, 0, 0),     # blue
    "A2": (255, 100, 0),   # light blue
    "C3": (0, 0, 255),     # red
    "C4": (0, 100, 255),   # orange
    "E1": (255, 0, 255),   # magenta
    "D":  (255, 255, 0),   # cyan
    "C1": (100, 255, 100), # light green
    "B1": (100, 100, 255), # light red
}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def parse_label(label_path: Path) -> tuple[np.ndarray, np.ndarray] | None:
    """Parse YOLO-Pose label → (bbox[4], kpts[20,3]) in normalized coords."""
    text = label_path.read_text().strip()
    if not text:
        return None
    parts = text.split()
    if len(parts) < 5 + NUM_KEYPOINTS * 3:
        return None
    bbox = np.array([float(x) for x in parts[1:5]])
    kpts = np.zeros((NUM_KEYPOINTS, 3))
    for i in range(NUM_KEYPOINTS):
        base = 5 + i * 3
        kpts[i] = [float(parts[base]), float(parts[base + 1]), float(parts[base + 2])]
    return bbox, kpts


def draw_labels(img: np.ndarray, bbox: np.ndarray, kpts: np.ndarray, name: str) -> np.ndarray:
    """Draw bbox and keypoints on image."""
    vis = img.copy()
    h, w = vis.shape[:2]

    # Draw bbox
    cx, cy, bw, bh = bbox
    x1 = int((cx - bw / 2) * w)
    y1 = int((cy - bh / 2) * h)
    x2 = int((cx + bw / 2) * w)
    y2 = int((cy + bh / 2) * h)
    cv2.rectangle(vis, (x1, y1), (x2, y2), (200, 200, 200), 1, cv2.LINE_AA)

    # Draw keypoints per role with lines connecting pairs
    for role, (i1, i2) in ROLE_KPT_INDICES.items():
        color = ROLE_COLORS[role]
        v1 = kpts[i1, 2] > 0
        v2 = kpts[i2, 2] > 0

        px1 = int(kpts[i1, 0] * w)
        py1 = int(kpts[i1, 1] * h)
        px2 = int(kpts[i2, 0] * w)
        py2 = int(kpts[i2, 1] * h)

        if v1 and v2:
            cv2.line(vis, (px1, py1), (px2, py2), color, 2, cv2.LINE_AA)
        if v1:
            cv2.circle(vis, (px1, py1), 5, color, -1, cv2.LINE_AA)
            cv2.putText(vis, f"{role}a", (px1 + 6, py1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1, cv2.LINE_AA)
        if v2:
            cv2.circle(vis, (px2, py2), 5, color, -1, cv2.LINE_AA)
            cv2.putText(vis, f"{role}b", (px2 + 6, py2 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1, cv2.LINE_AA)

    # Legend
    cv2.putText(vis, name, (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    vis_kpts = int(np.sum(kpts[:, 2] > 0))
    cv2.putText(vis, f"{vis_kpts}/{NUM_KEYPOINTS} kpts visible", (8, 36),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1, cv2.LINE_AA)

    return vis


def main() -> int:
    parser = argparse.ArgumentParser(description="Spot-check pseudo labels visually")
    parser.add_argument("--images", required=True, help="Images directory")
    parser.add_argument("--labels", required=True, help="Labels directory")
    parser.add_argument("--output", default="/mnt/d/dataset_pipeline/spot_check", help="Output dir")
    parser.add_argument("--n", type=int, default=30, help="Number of random samples")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    img_dir = Path(args.images)
    lbl_dir = Path(args.labels)
    out_dir = Path(args.output)

    if not img_dir.exists():
        print(f"ERROR: Images dir not found: {img_dir}", file=sys.stderr)
        return 1

    all_images = sorted([
        p for p in img_dir.iterdir()
        if p.suffix.lower() in IMAGE_EXTENSIONS and p.is_file()
    ])
    print(f"Found {len(all_images)} images")

    random.seed(args.seed)
    sample = random.sample(all_images, min(args.n, len(all_images)))
    print(f"Sampling {len(sample)} for spot check")

    out_dir.mkdir(parents=True, exist_ok=True)

    good, bad, no_label = 0, 0, 0
    for img_path in sample:
        lbl_path = lbl_dir / f"{img_path.stem}.txt"
        if not lbl_path.exists():
            no_label += 1
            continue

        parsed = parse_label(lbl_path)
        if parsed is None:
            no_label += 1
            continue

        bbox, kpts = parsed
        img = cv2.imread(str(img_path))
        if img is None:
            bad += 1
            continue

        vis = draw_labels(img, bbox, kpts, img_path.stem)
        cv2.imwrite(str(out_dir / f"{img_path.stem}_check.jpg"), vis, [cv2.IMWRITE_JPEG_QUALITY, 92])
        good += 1

    print(f"\nWrote {good} visualizations to {out_dir}")
    if no_label:
        print(f"  {no_label} missing/empty labels")
    if bad:
        print(f"  {bad} unreadable images")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
