#!/usr/bin/env python3
"""Bootstrap YOLO-Pose keypoint annotations from MOS heuristic geometry.

Runs the existing GrabCut + hardcoded ratio pipeline on each image and converts
the resulting roleLines into YOLO-Pose label files with 20 keypoints (10 roles,
2 endpoints each).

Keypoint index mapping (V1):
  0-1   W_left, W_right       (base width)
  2-3   H_top, H_bottom       (overall height)
  4-5   A1_left, A1_right     (back/top width)
  6-7   A2_left, A2_right     (seat width)
  8-9   C3_top, C3_bottom     (right arm height)
  10-11 C4_top, C4_bottom     (right leg height)
  12-13 E1_top, E1_bottom     (left arm height)
  14-15 D_left, D_right       (floor base width)
  16-17 C1_inner, C1_outer    (right arm width)
  18-19 B1_start, B1_end      (right arm diagonal)

Output: YOLO-Pose format .txt label files + bootstrap_results.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

# Add the project root so we can import from services/mos-sam/app.py
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "services" / "mos-sam"))

from app import find_primary_contour, build_role_geometry  # noqa: E402

# All 10 V1 roles in canonical order.
V1_ROLES = ["W", "H", "A1", "A2", "C3", "C4", "E1", "D", "C1", "B1"]

# Map from role name to keypoint pair indices.
ROLE_TO_KPT_INDICES: Dict[str, Tuple[int, int]] = {
    "W": (0, 1),
    "H": (2, 3),
    "A1": (4, 5),
    "A2": (6, 7),
    "C3": (8, 9),
    "C4": (10, 11),
    "E1": (12, 13),
    "D": (14, 15),
    "C1": (16, 17),
    "B1": (18, 19),
}

NUM_KEYPOINTS = 20


def mos_to_yolo_coord(mos_val: float) -> float:
    """Convert MOS 0-1000 space to YOLO 0-1.0 normalized."""
    return max(0.0, min(1.0, mos_val / 1000.0))


def bbox_from_contour_px(
    bbox_px: Tuple[int, int, int, int], img_w: int, img_h: int
) -> Tuple[float, float, float, float]:
    """Convert pixel bbox (x1, y1, x2, y2) to YOLO center format (cx, cy, w, h) normalized."""
    x1, y1, x2, y2 = bbox_px
    bw = float(x2 - x1)
    bh = float(y2 - y1)
    cx = (x1 + bw / 2.0) / max(1, img_w)
    cy = (y1 + bh / 2.0) / max(1, img_h)
    nw = bw / max(1, img_w)
    nh = bh / max(1, img_h)
    return (
        max(0.0, min(1.0, cx)),
        max(0.0, min(1.0, cy)),
        max(0.0, min(1.0, nw)),
        max(0.0, min(1.0, nh)),
    )


def build_keypoints_from_role_lines(
    role_lines: Dict[str, Dict[str, float]],
) -> List[Tuple[float, float, int]]:
    """Build 20-keypoint list from MOS roleLines dict.

    Returns list of (x_norm, y_norm, visibility) where:
      visibility=2  keypoint visible and labeled
      visibility=0  keypoint not available
    """
    kpts: List[Tuple[float, float, int]] = [(0.0, 0.0, 0)] * NUM_KEYPOINTS

    for role, (idx_start, idx_end) in ROLE_TO_KPT_INDICES.items():
        line = role_lines.get(role)
        if not line:
            continue
        x1 = mos_to_yolo_coord(line["x1"])
        y1 = mos_to_yolo_coord(line["y1"])
        x2 = mos_to_yolo_coord(line["x2"])
        y2 = mos_to_yolo_coord(line["y2"])
        kpts[idx_start] = (x1, y1, 2)
        kpts[idx_end] = (x2, y2, 2)

    return kpts


def format_yolo_pose_line(
    class_id: int,
    bbox: Tuple[float, float, float, float],
    keypoints: List[Tuple[float, float, int]],
) -> str:
    """Format one YOLO-Pose annotation line."""
    parts = [str(class_id)]
    # bbox: cx cy w h
    parts.extend(f"{v:.6f}" for v in bbox)
    # keypoints: x y visibility for each
    for x, y, vis in keypoints:
        parts.extend([f"{x:.6f}", f"{y:.6f}", str(vis)])
    return " ".join(parts)


BOOTSTRAP_MAX_EDGE = 640  # Downscale for GrabCut speed; coords are normalized anyway


def process_image(
    img_path: Path,
) -> Optional[Dict]:
    """Run heuristic on one image, return annotation data or None on failure."""
    data = np.fromfile(str(img_path), dtype=np.uint8)
    img_bgr = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img_bgr is None:
        return None

    h, w = img_bgr.shape[:2]

    # Downscale large images for GrabCut performance.
    # Heuristic output is in MOS 0-1000 normalized space, so results are
    # resolution-independent.
    scale = 1.0
    if max(w, h) > BOOTSTRAP_MAX_EDGE:
        scale = BOOTSTRAP_MAX_EDGE / max(w, h)
        new_w = int(w * scale)
        new_h = int(h * scale)
        img_bgr = cv2.resize(img_bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)
        h, w = new_h, new_w

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    contour, bbox, area_ratio = find_primary_contour(img_rgb)
    role_lines, _curves, _anchors = build_role_geometry(
        contour, bbox, w, h, V1_ROLES, {}
    )

    keypoints = build_keypoints_from_role_lines(role_lines)
    yolo_bbox = bbox_from_contour_px(bbox, w, h)
    yolo_line = format_yolo_pose_line(0, yolo_bbox, keypoints)

    roles_found = [r for r in V1_ROLES if r in role_lines]
    visible_kpts = sum(1 for _, _, v in keypoints if v > 0)

    return {
        "filename": img_path.name,
        "width": w,
        "height": h,
        "area_ratio": round(area_ratio, 4),
        "roles_found": roles_found,
        "roles_missing": [r for r in V1_ROLES if r not in role_lines],
        "visible_keypoints": visible_kpts,
        "total_keypoints": NUM_KEYPOINTS,
        "yolo_line": yolo_line,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bootstrap YOLO-Pose annotations from MOS heuristic"
    )
    parser.add_argument(
        "--images",
        default="/mnt/d/dataset_pipeline/filtered_yolo/images",
        help="Directory of filtered furniture images",
    )
    parser.add_argument(
        "--output",
        default="/mnt/d/dataset_pipeline/yolo_pose_v1/labels_bootstrap",
        help="Output directory for YOLO-Pose .txt labels",
    )
    parser.add_argument(
        "--results-json",
        default="/mnt/d/dataset_pipeline/yolo_pose_v1/bootstrap_results.json",
        help="Path for per-image quality results JSON",
    )
    args = parser.parse_args()

    images_dir = Path(args.images)
    output_dir = Path(args.output)
    results_path = Path(args.results_json)

    if not images_dir.exists():
        print(f"ERROR: images directory not found: {images_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    results_path.parent.mkdir(parents=True, exist_ok=True)

    image_files = sorted(
        p
        for p in images_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    )

    print(f"[bootstrap] Found {len(image_files)} images in {images_dir}")

    results = []
    success = 0
    failed = 0
    t0 = time.time()

    for idx, img_path in enumerate(image_files, start=1):
        result = process_image(img_path)
        if result is None:
            failed += 1
            results.append({"filename": img_path.name, "error": "decode_failed"})
            continue

        # Write YOLO-Pose label file (same stem, .txt extension)
        label_path = output_dir / (img_path.stem + ".txt")
        label_path.write_text(result["yolo_line"] + "\n", encoding="utf-8")

        results.append(result)
        success += 1

        if idx % 50 == 0:
            elapsed = time.time() - t0
            rate = idx / max(0.001, elapsed)
            print(f"[bootstrap] {idx}/{len(image_files)} ({rate:.1f} img/s)")

    elapsed = time.time() - t0

    # Compute summary stats
    role_coverage = {}
    for role in V1_ROLES:
        found_count = sum(1 for r in results if role in r.get("roles_found", []))
        role_coverage[role] = round(found_count / max(1, success) * 100, 1)

    area_ratios = [r["area_ratio"] for r in results if "area_ratio" in r]

    summary = {
        "total_images": len(image_files),
        "success": success,
        "failed": failed,
        "elapsed_seconds": round(elapsed, 1),
        "role_coverage_pct": role_coverage,
        "area_ratio_stats": {
            "min": round(min(area_ratios), 4) if area_ratios else 0,
            "max": round(max(area_ratios), 4) if area_ratios else 0,
            "mean": round(sum(area_ratios) / len(area_ratios), 4) if area_ratios else 0,
            "median": round(
                float(np.median(area_ratios)), 4
            ) if area_ratios else 0,
        },
        "per_image": results,
    }

    results_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"\n[bootstrap] Done: {success} labels written, {failed} failed ({elapsed:.1f}s)")
    print(f"[bootstrap] Labels → {output_dir}")
    print(f"[bootstrap] Results → {results_path}")
    print(f"[bootstrap] Role coverage: {json.dumps(role_coverage, indent=2)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
