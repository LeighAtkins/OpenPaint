#!/usr/bin/env python3
"""Offline synthetic augmentation for YOLO-Pose train split.

Multiplies the training set via geometric + photometric transforms with
correctly transformed keypoint coordinates.  Only the train split is
augmented; val/test are never touched.

Usage:
    python scripts/augment_dataset.py \
        --dataset /mnt/d/dataset_pipeline/yolo_pose_v2 \
        --multiplier 6 --seed 42
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import cv2
import numpy as np


# ── Augmentation parameters ─────────────────────────────────────────

GEO_ROTATION_RANGE = (-10.0, 10.0)      # degrees
GEO_ROTATION_PROB = 0.7
GEO_SCALE_RANGE = (0.85, 1.15)
GEO_SCALE_PROB = 0.7
GEO_TRANSLATE_RANGE = (-0.06, 0.06)     # fraction of image size
GEO_TRANSLATE_PROB = 0.6
GEO_PERSPECTIVE_RANGE = (0.0002, 0.0008)
GEO_PERSPECTIVE_PROB = 0.35

PHOTO_BRIGHTNESS_RANGE = (0.7, 1.3)
PHOTO_BRIGHTNESS_PROB = 0.6
PHOTO_CONTRAST_RANGE = (0.8, 1.2)
PHOTO_CONTRAST_PROB = 0.6
PHOTO_HUE_RANGE = (-8, 8)               # degrees in HSV space
PHOTO_HUE_PROB = 0.4
PHOTO_SAT_RANGE = (0.7, 1.3)
PHOTO_SAT_PROB = 0.5
PHOTO_BLUR_SIGMA_RANGE = (0.3, 1.2)
PHOTO_BLUR_PROB = 0.3
PHOTO_NOISE_STD_RANGE = (3, 12)
PHOTO_NOISE_PROB = 0.3

BBOX_PAD_FRAC = 0.05   # 5% padding around visible keypoints for bbox
BBOX_MIN_FRAC = 0.02   # 2% floor for bbox width/height

NUM_KEYPOINTS = 20


# ── Deterministic seed helper ───────────────────────────────────────

def sample_seed(base_seed: int, stem: str, aug_index: int) -> int:
    """Deterministic per-sample seed: base_seed XOR hash(stem) XOR aug_index."""
    h = int(hashlib.sha256(stem.encode()).hexdigest()[:8], 16)
    return base_seed ^ h ^ aug_index


# ── Label parsing / formatting ──────────────────────────────────────

def parse_label(line: str) -> tuple[int, np.ndarray, np.ndarray]:
    """Parse a YOLO-Pose label line.

    Returns:
        cls: class id
        bbox: array [cx, cy, w, h] (normalized)
        kpts: array (N, 3) with columns [x, y, vis] (normalized coords, int vis)
    """
    tokens = line.strip().split()
    cls = int(tokens[0])
    bbox = np.array([float(t) for t in tokens[1:5]])
    kpt_flat = [float(t) for t in tokens[5:]]
    kpts = np.array(kpt_flat).reshape(-1, 3)
    return cls, bbox, kpts


def format_label(cls: int, bbox: np.ndarray, kpts: np.ndarray) -> str:
    """Format back into a YOLO-Pose label line."""
    parts = [str(cls)]
    parts.extend(f"{v:.6f}" for v in bbox)
    for x, y, vis in kpts:
        vis_int = int(round(vis))
        if vis_int == 0:
            parts.extend(["0.000000", "0.000000", "0"])
        else:
            parts.extend([f"{x:.6f}", f"{y:.6f}", str(vis_int)])
    return " ".join(parts)


# ── Geometric transform ─────────────────────────────────────────────

def build_geometric_transform(
    h: int, w: int, rng: np.random.Generator
) -> np.ndarray:
    """Build a 3x3 perspective transform matrix from random params."""
    M = np.eye(3, dtype=np.float64)

    # Center for rotation/scale
    cx, cy = w / 2.0, h / 2.0

    # Rotation
    if rng.random() < GEO_ROTATION_PROB:
        angle = rng.uniform(*GEO_ROTATION_RANGE)
        rad = np.radians(angle)
        cos_a, sin_a = np.cos(rad), np.sin(rad)
        R = np.array([
            [cos_a, -sin_a, cx - cos_a * cx + sin_a * cy],
            [sin_a,  cos_a, cy - sin_a * cx - cos_a * cy],
            [0, 0, 1],
        ], dtype=np.float64)
        M = R @ M

    # Scale
    if rng.random() < GEO_SCALE_PROB:
        s = rng.uniform(*GEO_SCALE_RANGE)
        S = np.array([
            [s, 0, cx * (1 - s)],
            [0, s, cy * (1 - s)],
            [0, 0, 1],
        ], dtype=np.float64)
        M = S @ M

    # Translation
    if rng.random() < GEO_TRANSLATE_PROB:
        tx = rng.uniform(*GEO_TRANSLATE_RANGE) * w
        ty = rng.uniform(*GEO_TRANSLATE_RANGE) * h
        T = np.array([
            [1, 0, tx],
            [0, 1, ty],
            [0, 0, 1],
        ], dtype=np.float64)
        M = T @ M

    # Perspective
    if rng.random() < GEO_PERSPECTIVE_PROB:
        p1 = rng.uniform(*GEO_PERSPECTIVE_RANGE) * rng.choice([-1, 1])
        p2 = rng.uniform(*GEO_PERSPECTIVE_RANGE) * rng.choice([-1, 1])
        P = np.array([
            [1, 0, 0],
            [0, 1, 0],
            [p1, p2, 1],
        ], dtype=np.float64)
        M = P @ M

    return M


def transform_keypoints(
    kpts: np.ndarray, M: np.ndarray, h: int, w: int
) -> np.ndarray:
    """Apply perspective transform M to keypoints (N,3) in normalized coords.

    Invisible keypoints (vis==0) are untouched.
    Visible keypoints that go OOB are set invisible.
    """
    out = kpts.copy()
    for i in range(len(out)):
        vis = int(round(out[i, 2]))
        if vis == 0:
            continue
        # Convert normalized → pixel
        px = out[i, 0] * w
        py = out[i, 1] * h
        # Apply perspective transform
        denom = M[2, 0] * px + M[2, 1] * py + M[2, 2]
        nx = (M[0, 0] * px + M[0, 1] * py + M[0, 2]) / denom
        ny = (M[1, 0] * px + M[1, 1] * py + M[1, 2]) / denom
        # Check bounds
        if nx < 0 or nx >= w or ny < 0 or ny >= h:
            out[i] = [0, 0, 0]
        else:
            out[i, 0] = nx / w
            out[i, 1] = ny / h
    return out


def bbox_from_keypoints(kpts: np.ndarray, h: int, w: int) -> np.ndarray | None:
    """Recompute bbox from visible keypoints with padding.

    Returns None if no visible keypoints.
    """
    vis_mask = kpts[:, 2] > 0
    if not np.any(vis_mask):
        return None
    xs = kpts[vis_mask, 0]
    ys = kpts[vis_mask, 1]
    x_min, x_max = xs.min(), xs.max()
    y_min, y_max = ys.min(), ys.max()

    # Add padding
    bw = max(x_max - x_min, BBOX_MIN_FRAC)
    bh = max(y_max - y_min, BBOX_MIN_FRAC)
    pad_x = bw * BBOX_PAD_FRAC
    pad_y = bh * BBOX_PAD_FRAC

    x_min = max(0, x_min - pad_x)
    x_max = min(1, x_max + pad_x)
    y_min = max(0, y_min - pad_y)
    y_max = min(1, y_max + pad_y)

    cx = (x_min + x_max) / 2
    cy = (y_min + y_max) / 2
    bw = x_max - x_min
    bh = y_max - y_min
    return np.array([cx, cy, bw, bh])


# ── Photometric transforms ──────────────────────────────────────────

def apply_photometric(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Apply random photometric transforms to an image (uint8 BGR)."""
    out = img.astype(np.float32)

    # Brightness
    if rng.random() < PHOTO_BRIGHTNESS_PROB:
        factor = rng.uniform(*PHOTO_BRIGHTNESS_RANGE)
        out *= factor

    # Contrast
    if rng.random() < PHOTO_CONTRAST_PROB:
        factor = rng.uniform(*PHOTO_CONTRAST_RANGE)
        mean = out.mean()
        out = (out - mean) * factor + mean

    out = np.clip(out, 0, 255).astype(np.uint8)

    # HSV adjustments
    do_hue = rng.random() < PHOTO_HUE_PROB
    do_sat = rng.random() < PHOTO_SAT_PROB
    if do_hue or do_sat:
        hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
        if do_hue:
            shift = rng.uniform(*PHOTO_HUE_RANGE)
            hsv[:, :, 0] = (hsv[:, :, 0] + shift) % 180
        if do_sat:
            factor = rng.uniform(*PHOTO_SAT_RANGE)
            hsv[:, :, 1] = np.clip(hsv[:, :, 1] * factor, 0, 255)
        out = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    # Gaussian blur
    if rng.random() < PHOTO_BLUR_PROB:
        sigma = rng.uniform(*PHOTO_BLUR_SIGMA_RANGE)
        ksize = int(np.ceil(sigma * 3)) * 2 + 1
        out = cv2.GaussianBlur(out, (ksize, ksize), sigma)

    # Gaussian noise
    if rng.random() < PHOTO_NOISE_PROB:
        std = rng.uniform(*PHOTO_NOISE_STD_RANGE)
        noise = rng.normal(0, std, out.shape).astype(np.float32)
        out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    return out


# ── Main augmentation loop ──────────────────────────────────────────

def augment_dataset(dataset_dir: Path, multiplier: int, base_seed: int) -> None:
    train_img_dir = dataset_dir / "images" / "train"
    train_lbl_dir = dataset_dir / "labels" / "train"

    if not train_img_dir.exists():
        print(f"ERROR: train image dir not found: {train_img_dir}", file=sys.stderr)
        sys.exit(1)
    if not train_lbl_dir.exists():
        print(f"ERROR: train label dir not found: {train_lbl_dir}", file=sys.stderr)
        sys.exit(1)

    # Collect original images (exclude any previous augmented files)
    originals = sorted([
        p for p in train_img_dir.iterdir()
        if p.suffix.lower() in (".jpg", ".jpeg", ".png")
        and "_aug" not in p.stem
    ])

    print(f"[augment] Found {len(originals)} original train images")
    print(f"[augment] Multiplier: {multiplier} → {len(originals) * (multiplier - 1)} augmented copies")
    print(f"[augment] Base seed: {base_seed}")

    written = 0
    skipped_exist = 0
    discarded = 0

    for img_path in originals:
        stem = img_path.stem
        lbl_path = train_lbl_dir / f"{stem}.txt"
        if not lbl_path.exists():
            print(f"  WARN: no label for {stem}, skipping")
            continue

        # Read image and label
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"  WARN: cannot read {img_path}, skipping")
            continue
        h, w = img.shape[:2]

        label_text = lbl_path.read_text().strip()
        if not label_text:
            print(f"  WARN: empty label for {stem}, skipping")
            continue
        cls, bbox, kpts = parse_label(label_text)

        # Generate (multiplier - 1) augmented copies (original counts as 1)
        for aug_idx in range(1, multiplier):
            aug_stem = f"{stem}_aug{aug_idx:03d}"
            out_img_path = train_img_dir / f"{aug_stem}.jpg"
            out_lbl_path = train_lbl_dir / f"{aug_stem}.txt"

            # Idempotency: skip if both files exist
            if out_img_path.exists() and out_lbl_path.exists():
                skipped_exist += 1
                continue

            # Deterministic RNG for this sample
            seed = sample_seed(base_seed, stem, aug_idx)
            rng = np.random.default_rng(seed)

            # Build and apply geometric transform
            M = build_geometric_transform(h, w, rng)
            aug_img = cv2.warpPerspective(
                img, M, (w, h),
                borderMode=cv2.BORDER_REFLECT_101,
            )

            # Transform keypoints
            aug_kpts = transform_keypoints(kpts, M, h, w)

            # Recompute bbox from visible keypoints
            new_bbox = bbox_from_keypoints(aug_kpts, h, w)
            if new_bbox is None:
                discarded += 1
                continue

            # Apply photometric transforms
            aug_img = apply_photometric(aug_img, rng)

            # Write outputs
            cv2.imwrite(str(out_img_path), aug_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            out_lbl_path.write_text(format_label(cls, new_bbox, aug_kpts) + "\n")
            written += 1

    print(f"\n[augment] Done:")
    print(f"  Written:  {written}")
    print(f"  Skipped (exist): {skipped_exist}")
    print(f"  Discarded (no visible kpts): {discarded}")
    print(f"  Total train images: {len(originals) + written + skipped_exist}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Offline augmentation for YOLO-Pose train split"
    )
    parser.add_argument(
        "--dataset",
        default="/mnt/d/dataset_pipeline/yolo_pose_v2",
        help="Path to YOLO-Pose dataset root",
    )
    parser.add_argument(
        "--multiplier",
        type=int,
        default=6,
        help="Total copies per image (original + augmented). Default: 6",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Base random seed for reproducibility",
    )
    args = parser.parse_args()

    augment_dataset(Path(args.dataset), args.multiplier, args.seed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
