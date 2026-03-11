#!/usr/bin/env python3
"""Pseudo-labeling pipeline for unlabeled sofa photos.

Uses a trained YOLO-Pose model as a "teacher" to generate labels for
unlabeled images, then filters aggressively by confidence to produce
high-quality training data.

Usage:
    python scripts/pseudo_label.py \
        --model /mnt/d/dataset_pipeline/runs/pose_v2/pose_v1/weights/best.pt \
        --unlabeled /path/to/sofa/photos \
        --output /mnt/d/dataset_pipeline/yolo_pose_v2_pseudo \
        --original /mnt/d/dataset_pipeline/yolo_pose_v2 \
        --combined /mnt/d/dataset_pipeline/yolo_pose_v2_combined
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

NUM_KEYPOINTS = 20
BBOX_PAD_FRAC = 0.05
BBOX_MIN_FRAC = 0.02
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"}


def bbox_from_keypoints(kpts: np.ndarray) -> np.ndarray | None:
    """Recompute bbox from visible keypoints with padding.

    Args:
        kpts: (N, 3) array with [x_norm, y_norm, vis]

    Returns None if no visible keypoints.
    """
    vis_mask = kpts[:, 2] > 0
    if not np.any(vis_mask):
        return None
    xs = kpts[vis_mask, 0]
    ys = kpts[vis_mask, 1]
    x_min, x_max = xs.min(), xs.max()
    y_min, y_max = ys.min(), ys.max()

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


def format_label(cls: int, bbox: np.ndarray, kpts: np.ndarray) -> str:
    """Format into a YOLO-Pose label line (65 tokens)."""
    parts = [str(cls)]
    parts.extend(f"{v:.6f}" for v in bbox)
    for x, y, vis in kpts:
        vis_int = int(round(vis))
        if vis_int == 0:
            parts.extend(["0.000000", "0.000000", "0"])
        else:
            parts.extend([f"{x:.6f}", f"{y:.6f}", str(vis_int)])
    return " ".join(parts)


def resize_max_edge(img: np.ndarray, max_edge: int) -> np.ndarray:
    """Resize image so its longest edge is max_edge pixels."""
    h, w = img.shape[:2]
    if max(h, w) <= max_edge:
        return img
    scale = max_edge / max(h, w)
    new_w = int(round(w * scale))
    new_h = int(round(h * scale))
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


def run_pseudo_labeling(args: argparse.Namespace) -> int:
    from ultralytics import YOLO

    if not args.unlabeled:
        print("ERROR: --unlabeled is required for inference mode", file=sys.stderr)
        return 1

    model_path = Path(args.model)
    unlabeled_dir = Path(args.unlabeled)
    output_dir = Path(args.output)
    original_dir = Path(args.original)

    if not model_path.exists():
        print(f"ERROR: Model not found: {model_path}", file=sys.stderr)
        return 1
    if not unlabeled_dir.exists():
        print(f"ERROR: Unlabeled dir not found: {unlabeled_dir}", file=sys.stderr)
        return 1
    if not original_dir.exists():
        print(f"ERROR: Original dataset not found: {original_dir}", file=sys.stderr)
        return 1

    # Create output directories
    out_img_dir = output_dir / "images" / "train"
    out_lbl_dir = output_dir / "labels" / "train"
    out_img_dir.mkdir(parents=True, exist_ok=True)
    out_lbl_dir.mkdir(parents=True, exist_ok=True)

    # Collect unlabeled images (sorted for reproducibility)
    all_images = sorted([
        p for p in unlabeled_dir.rglob("*")
        if p.suffix.lower() in IMAGE_EXTENSIONS and p.is_file()
    ])
    print(f"[pseudo_label] Found {len(all_images)} unlabeled images")
    print(f"[pseudo_label] Model: {model_path}")
    print(f"[pseudo_label] Filters: box_conf≥{args.box_conf}, kpt_conf≥{args.kpt_conf}, "
          f"mean_conf≥{args.mean_conf}, min_visible≥{args.min_visible}")

    # Check for filename collisions
    stem_counts: dict[str, int] = {}
    for p in all_images:
        stem_counts[p.stem] = stem_counts.get(p.stem, 0) + 1
    collisions = {s: c for s, c in stem_counts.items() if c > 1}
    if collisions:
        print(f"  WARNING: {len(collisions)} filename collisions detected. "
              f"Will use parent dir as prefix for disambiguation.")

    # Load model
    print("[pseudo_label] Loading model...")
    model = YOLO(str(model_path))

    # Stats tracking
    stats = {
        "total_scanned": 0,
        "skipped_existing": 0,
        "passed": 0,
        "rejected_no_detection": 0,
        "rejected_box_conf": 0,
        "rejected_min_visible": 0,
        "rejected_mean_conf": 0,
        "rejected_read_error": 0,
        "per_image": [],
    }

    start_time = time.time()

    for img_path in tqdm(all_images, desc="Pseudo-labeling", unit="img"):
        stats["total_scanned"] += 1

        # Disambiguate filename if collision
        stem = img_path.stem
        if stem in collisions:
            parent_name = img_path.parent.name
            stem = f"{parent_name}_{stem}"

        out_img_path = out_img_dir / f"{stem}.jpg"
        out_lbl_path = out_lbl_dir / f"{stem}.txt"

        # Idempotency: skip if already processed
        if out_img_path.exists() and out_lbl_path.exists():
            stats["skipped_existing"] += 1
            continue

        # Read image
        img = cv2.imread(str(img_path))
        if img is None:
            stats["rejected_read_error"] += 1
            continue

        # Run inference
        results = model.predict(str(img_path), imgsz=640, verbose=False)
        if not results or len(results) == 0:
            stats["rejected_no_detection"] += 1
            continue

        result = results[0]
        if (result.keypoints is None or len(result.keypoints) == 0
                or result.boxes is None or len(result.boxes) == 0):
            stats["rejected_no_detection"] += 1
            continue

        # Take highest confidence detection
        best_idx = int(result.boxes.conf.argmax())
        box_conf = float(result.boxes.conf[best_idx])

        # Filter: box confidence
        if box_conf < args.box_conf:
            stats["rejected_box_conf"] += 1
            continue

        # Extract keypoints
        kpts_px = result.keypoints.data[best_idx].cpu().numpy()  # (20, 3)
        img_h, img_w = result.orig_shape

        # Normalize to 0-1
        kpts_norm = np.zeros_like(kpts_px)
        kpts_norm[:, 0] = kpts_px[:, 0] / max(1, img_w)
        kpts_norm[:, 1] = kpts_px[:, 1] / max(1, img_h)
        kpts_norm[:, 2] = kpts_px[:, 2]  # per-keypoint confidence

        # Apply per-keypoint confidence threshold
        # Keypoints below threshold → invisible (0 0 0)
        low_conf_mask = kpts_norm[:, 2] < args.kpt_conf
        kpts_norm[low_conf_mask] = [0.0, 0.0, 0.0]

        # Count visible keypoints after thresholding
        visible_count = int(np.sum(kpts_norm[:, 2] > 0))

        # Filter: minimum visible keypoints
        if visible_count < args.min_visible:
            stats["rejected_min_visible"] += 1
            continue

        # Filter: mean confidence of visible keypoints
        visible_mask = kpts_norm[:, 2] > 0
        mean_conf = float(np.mean(kpts_norm[visible_mask, 2]))
        if mean_conf < args.mean_conf:
            stats["rejected_mean_conf"] += 1
            continue

        # Recompute bbox from visible keypoints
        # Set visibility to 2 (visible) for keypoints that passed threshold
        kpts_out = kpts_norm.copy()
        kpts_out[visible_mask, 2] = 2.0
        kpts_out[~visible_mask, 2] = 0.0

        bbox = bbox_from_keypoints(kpts_out)
        if bbox is None:
            stats["rejected_min_visible"] += 1
            continue

        # Resize image and save
        img_resized = resize_max_edge(img, args.max_edge)
        cv2.imwrite(str(out_img_path), img_resized, [cv2.IMWRITE_JPEG_QUALITY, 92])

        # Write label
        label_line = format_label(0, bbox, kpts_out)
        out_lbl_path.write_text(label_line + "\n")

        stats["passed"] += 1
        stats["per_image"].append({
            "stem": stem,
            "box_conf": round(box_conf, 4),
            "visible_kpts": visible_count,
            "mean_kpt_conf": round(mean_conf, 4),
        })

    elapsed = time.time() - start_time

    # Print summary
    print(f"\n[pseudo_label] Done in {elapsed:.1f}s")
    print(f"  Total scanned:          {stats['total_scanned']}")
    print(f"  Skipped (existing):     {stats['skipped_existing']}")
    print(f"  Passed all filters:     {stats['passed']}")
    print(f"  Rejected (read error):  {stats['rejected_read_error']}")
    print(f"  Rejected (no detect):   {stats['rejected_no_detection']}")
    print(f"  Rejected (box conf):    {stats['rejected_box_conf']}")
    print(f"  Rejected (min visible): {stats['rejected_min_visible']}")
    print(f"  Rejected (mean conf):   {stats['rejected_mean_conf']}")
    yield_pct = (stats["passed"] / max(1, stats["total_scanned"] - stats["skipped_existing"])) * 100
    print(f"  Yield:                  {yield_pct:.1f}%")

    # Save report
    report_path = output_dir / "pseudo_label_report.json"
    report = {
        "model": str(model_path),
        "unlabeled_dir": str(unlabeled_dir),
        "filters": {
            "box_conf": args.box_conf,
            "kpt_conf": args.kpt_conf,
            "mean_conf": args.mean_conf,
            "min_visible": args.min_visible,
        },
        "stats": {k: v for k, v in stats.items() if k != "per_image"},
        "elapsed_seconds": round(elapsed, 1),
        "yield_pct": round(yield_pct, 2),
        "per_image": stats["per_image"],
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"  Report saved: {report_path}")

    # Create combined dataset if requested
    if args.combined:
        create_combined_dataset(
            combined_dir=Path(args.combined),
            original_dir=original_dir,
            pseudo_dir=output_dir,
            filter_junk=not args.no_filter,
        )

    return 0


def is_junk_image(img_path: Path, min_ar: float = 0.5, max_ar: float = 2.0,
                   max_white_frac: float = 0.30) -> bool:
    """Filter out website screenshots and product pages.

    Checks aspect ratio and white pixel fraction.
    Returns True if the image should be excluded.
    """
    img = cv2.imread(str(img_path))
    if img is None:
        return True
    h, w = img.shape[:2]
    ar = w / max(1, h)
    if ar < min_ar or ar > max_ar:
        return True
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    white_frac = float(np.mean(gray > 240))
    if white_frac > max_white_frac:
        return True
    return False


def create_combined_dataset(
    combined_dir: Path,
    original_dir: Path,
    pseudo_dir: Path,
    filter_junk: bool = True,
) -> None:
    """Create a merged dataset with symlinks from original + pseudo-labeled data."""
    print(f"\n[pseudo_label] Creating combined dataset: {combined_dir}")
    if filter_junk:
        print("  Junk filter ON: ar<0.5 or ar>2.0 or white>30%")

    combined_img_train = combined_dir / "images" / "train"
    combined_lbl_train = combined_dir / "labels" / "train"
    combined_img_train.mkdir(parents=True, exist_ok=True)
    combined_lbl_train.mkdir(parents=True, exist_ok=True)

    # Symlink val and test from original (directory-level symlinks)
    for split in ("val", "test"):
        for subdir in ("images", "labels"):
            src = original_dir / subdir / split
            dst = combined_dir / subdir / split
            if dst.exists() or dst.is_symlink():
                dst.unlink() if dst.is_symlink() else None
            if src.exists():
                dst.symlink_to(os.path.abspath(src))
                print(f"  Symlinked {subdir}/{split} → {src}")

    # Symlink original train images + labels
    orig_img_dir = original_dir / "images" / "train"
    orig_lbl_dir = original_dir / "labels" / "train"
    orig_images = sorted([
        p for p in orig_img_dir.iterdir()
        if p.suffix.lower() in IMAGE_EXTENSIONS
    ])
    orig_count = 0
    for img_path in tqdm(orig_images, desc="  Original symlinks", unit="img"):
        stem = img_path.stem
        lbl_path = orig_lbl_dir / f"{stem}.txt"
        img_dst = combined_img_train / img_path.name
        lbl_dst = combined_lbl_train / f"{stem}.txt"
        if not img_dst.exists():
            img_dst.symlink_to(os.path.abspath(img_path))
        if lbl_path.exists() and not lbl_dst.exists():
            lbl_dst.symlink_to(os.path.abspath(lbl_path))
        orig_count += 1

    # Symlink pseudo-labeled train images + labels
    pseudo_img_dir = pseudo_dir / "images" / "train"
    pseudo_lbl_dir = pseudo_dir / "labels" / "train"
    pseudo_count = 0
    filtered_count = 0
    if pseudo_img_dir.exists():
        pseudo_images = sorted([
            p for p in pseudo_img_dir.iterdir()
            if p.suffix.lower() in IMAGE_EXTENSIONS
        ])
        for img_path in tqdm(pseudo_images, desc="  Pseudo symlinks", unit="img"):
            if filter_junk and is_junk_image(img_path):
                filtered_count += 1
                continue
            stem = img_path.stem
            lbl_path = pseudo_lbl_dir / f"{stem}.txt"
            img_dst = combined_img_train / img_path.name
            lbl_dst = combined_lbl_train / f"{stem}.txt"
            if not img_dst.exists():
                img_dst.symlink_to(os.path.abspath(img_path))
            if lbl_path.exists() and not lbl_dst.exists():
                lbl_dst.symlink_to(os.path.abspath(lbl_path))
            pseudo_count += 1

    print(f"  Original train: {orig_count} images")
    print(f"  Pseudo train:   {pseudo_count} images")
    if filter_junk:
        print(f"  Filtered out:   {filtered_count} junk images")
    print(f"  Combined train: {orig_count + pseudo_count} images")

    # Write dataset.yaml
    yaml_path = combined_dir / "dataset.yaml"
    yaml_content = f"""# YOLOv8-Pose Combined Dataset (Original + Pseudo-labeled)
# Auto-generated by pseudo_label.py

path: {os.path.abspath(combined_dir)}
train: images/train
val: images/val
test: images/test

names:
  0: furniture

kpt_shape: [20, 3]
"""
    yaml_path.write_text(yaml_content)
    print(f"  Wrote {yaml_path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pseudo-labeling pipeline for unlabeled sofa photos"
    )
    parser.add_argument(
        "--model",
        default="/mnt/d/dataset_pipeline/runs/pose_v2/pose_v1/weights/best.pt",
        help="Path to teacher model weights",
    )
    parser.add_argument(
        "--unlabeled",
        default=None,
        help="Directory containing unlabeled images (searched recursively)",
    )
    parser.add_argument(
        "--output",
        default="/mnt/d/dataset_pipeline/yolo_pose_v2_pseudo",
        help="Output directory for pseudo-labeled data",
    )
    parser.add_argument(
        "--original", "--original-dataset",
        default="/mnt/d/dataset_pipeline/yolo_pose_v2",
        help="Path to original labeled dataset",
    )
    parser.add_argument(
        "--box-conf",
        type=float,
        default=0.50,
        help="Minimum box confidence threshold (default: 0.50)",
    )
    parser.add_argument(
        "--kpt-conf",
        type=float,
        default=0.40,
        help="Per-keypoint confidence threshold (default: 0.40)",
    )
    parser.add_argument(
        "--mean-conf",
        type=float,
        default=0.50,
        help="Mean keypoint confidence threshold (default: 0.50)",
    )
    parser.add_argument(
        "--min-visible",
        type=int,
        default=12,
        help="Minimum visible keypoints after thresholding (default: 12)",
    )
    parser.add_argument(
        "--max-edge",
        type=int,
        default=1024,
        help="Resize images so longest edge is this many pixels (default: 1024)",
    )
    parser.add_argument(
        "--combined",
        default=None,
        help="If set, create combined dataset with symlinks at this path",
    )
    parser.add_argument(
        "--combined-only",
        action="store_true",
        help="Skip inference; only rebuild the combined dataset from existing pseudo output",
    )
    parser.add_argument(
        "--no-filter",
        action="store_true",
        help="Disable junk image filtering (aspect ratio + white space) in combined dataset",
    )
    args = parser.parse_args()

    if args.combined_only:
        if not args.combined:
            # Auto-derive combined path from output
            args.combined = str(Path(args.output).parent / (Path(args.output).name + "_combined"))
        original_dir = Path(args.original)
        pseudo_dir = Path(args.output)
        if not original_dir.exists():
            print(f"ERROR: Original dataset not found: {original_dir}", file=sys.stderr)
            return 1
        if not pseudo_dir.exists():
            print(f"ERROR: Pseudo dataset not found: {pseudo_dir}", file=sys.stderr)
            return 1
        create_combined_dataset(
            combined_dir=Path(args.combined),
            original_dir=original_dir,
            pseudo_dir=pseudo_dir,
            filter_junk=not args.no_filter,
        )
        return 0

    return run_pseudo_labeling(args)


if __name__ == "__main__":
    raise SystemExit(main())
