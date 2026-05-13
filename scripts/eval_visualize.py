#!/usr/bin/env python3
"""Evaluate trained YOLOv8-Pose model and generate visual comparisons.

Overlays ground truth (green) vs predicted (red) keypoints on test images.
Computes Mean Endpoint Error (MEE) in MOS 0-1000 space per role.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

try:
    from ultralytics import YOLO
except ImportError:
    print("ERROR: ultralytics not installed. Run: pip install ultralytics", file=sys.stderr)
    sys.exit(1)


NUM_KEYPOINTS = 20
# V2 role order (matches SVG label generation)
ROLES = ["B1", "C1", "A1", "A2", "C3", "C4", "E1", "D", "B2", "A3"]
ROLE_KPT_INDICES = {
    "B1": (0, 1), "C1": (2, 3), "A1": (4, 5), "A2": (6, 7), "C3": (8, 9),
    "C4": (10, 11), "E1": (12, 13), "D": (14, 15), "B2": (16, 17), "A3": (18, 19),
}

# Colors (BGR for cv2)
GT_COLOR = (0, 200, 0)       # Green
PRED_COLOR = (0, 0, 230)     # Red
GT_LINE_COLOR = (0, 160, 0)
PRED_LINE_COLOR = (0, 0, 180)
TEXT_COLOR = (255, 255, 255)
BG_COLOR = (40, 40, 40)


def load_gt_label(label_path: Path) -> Optional[np.ndarray]:
    """Load ground truth keypoints from YOLO-Pose label file.

    Returns shape (20, 3) array of [x, y, vis] in 0-1 coords, or None.
    """
    text = label_path.read_text(encoding="utf-8").strip()
    if not text:
        return None
    parts = text.split()
    if len(parts) < 5 + NUM_KEYPOINTS * 3:
        return None
    kpts = np.zeros((NUM_KEYPOINTS, 3), dtype=np.float64)
    for i in range(NUM_KEYPOINTS):
        base = 5 + i * 3
        kpts[i, 0] = float(parts[base])
        kpts[i, 1] = float(parts[base + 1])
        kpts[i, 2] = float(parts[base + 2])
    return kpts


def predict_keypoints(model, img_path: Path, imgsz: int = 640) -> Optional[np.ndarray]:
    """Run model on image, return best detection's keypoints.

    Returns shape (20, 3) array of [x_norm, y_norm, conf] or None.
    """
    results = model.predict(str(img_path), imgsz=imgsz, verbose=False)
    if not results or len(results) == 0:
        return None

    result = results[0]
    if result.keypoints is None or len(result.keypoints) == 0:
        return None

    # Take highest confidence detection
    kpts_data = result.keypoints.data  # shape: (N, num_kpt, 3) in pixel coords
    boxes = result.boxes
    if boxes is not None and len(boxes) > 0:
        best_idx = int(boxes.conf.argmax())
    else:
        best_idx = 0

    kpts_px = kpts_data[best_idx].cpu().numpy()  # (num_kpt, 3)

    # Normalize to 0-1
    img_h, img_w = result.orig_shape
    kpts_norm = np.zeros_like(kpts_px)
    kpts_norm[:, 0] = kpts_px[:, 0] / max(1, img_w)
    kpts_norm[:, 1] = kpts_px[:, 1] / max(1, img_h)
    kpts_norm[:, 2] = kpts_px[:, 2]  # confidence

    return kpts_norm


def compute_endpoint_error_mos(
    gt: np.ndarray, pred: np.ndarray
) -> Dict[str, Dict[str, float]]:
    """Compute Mean Endpoint Error per role in MOS 0-1000 space."""
    errors = {}
    for role, (i1, i2) in ROLE_KPT_INDICES.items():
        gt_vis1 = gt[i1, 2] > 0
        gt_vis2 = gt[i2, 2] > 0
        pred_vis1 = pred[i1, 2] > 0.3  # confidence threshold
        pred_vis2 = pred[i2, 2] > 0.3

        if not (gt_vis1 and gt_vis2):
            continue  # No GT for this role

        if not (pred_vis1 and pred_vis2):
            errors[role] = {"error": float("inf"), "predicted": False}
            continue

        # MOS space: multiply by 1000
        e1 = np.sqrt(
            ((gt[i1, 0] - pred[i1, 0]) * 1000) ** 2 +
            ((gt[i1, 1] - pred[i1, 1]) * 1000) ** 2
        )
        e2 = np.sqrt(
            ((gt[i2, 0] - pred[i2, 0]) * 1000) ** 2 +
            ((gt[i2, 1] - pred[i2, 1]) * 1000) ** 2
        )
        errors[role] = {
            "error": round(float((e1 + e2) / 2), 2),
            "e1": round(float(e1), 2),
            "e2": round(float(e2), 2),
            "predicted": True,
        }

    return errors


def draw_comparison(
    img_bgr: np.ndarray,
    gt: Optional[np.ndarray],
    pred: Optional[np.ndarray],
    errors: Dict[str, Dict[str, float]],
    name: str,
) -> np.ndarray:
    """Draw GT (green) and predicted (red) keypoints overlaid on image."""
    vis = img_bgr.copy()
    h, w = vis.shape[:2]

    def draw_kpt_set(kpts, color, line_color, label_prefix, confidence_threshold=0.0):
        if kpts is None:
            return
        for role, (i1, i2) in ROLE_KPT_INDICES.items():
            v1 = kpts[i1, 2] > confidence_threshold
            v2 = kpts[i2, 2] > confidence_threshold
            if not (v1 or v2):
                continue

            px1 = int(kpts[i1, 0] * w)
            py1 = int(kpts[i1, 1] * h)
            px2 = int(kpts[i2, 0] * w)
            py2 = int(kpts[i2, 1] * h)

            if v1 and v2:
                cv2.line(vis, (px1, py1), (px2, py2), line_color, 1, cv2.LINE_AA)
            if v1:
                cv2.circle(vis, (px1, py1), 4, color, -1, cv2.LINE_AA)
            if v2:
                cv2.circle(vis, (px2, py2), 4, color, -1, cv2.LINE_AA)

    # Draw GT first (green), then predictions on top (red)
    draw_kpt_set(gt, GT_COLOR, GT_LINE_COLOR, "GT")
    draw_kpt_set(pred, PRED_COLOR, PRED_LINE_COLOR, "Pred", confidence_threshold=0.3)

    # Error text overlay
    y_off = 20
    cv2.putText(vis, name, (8, y_off), cv2.FONT_HERSHEY_SIMPLEX, 0.5, TEXT_COLOR, 1, cv2.LINE_AA)
    y_off += 18
    cv2.putText(vis, "Green=GT  Red=Pred", (8, y_off), cv2.FONT_HERSHEY_SIMPLEX, 0.35, TEXT_COLOR, 1)
    y_off += 16

    for role in ROLES:
        if role in errors:
            err = errors[role]
            if err["predicted"]:
                txt = f"{role}: MEE={err['error']:.1f}"
                color = GT_COLOR if err["error"] < 30 else (0, 180, 255) if err["error"] < 60 else PRED_COLOR
            else:
                txt = f"{role}: MISSED"
                color = (0, 0, 200)
            cv2.putText(vis, txt, (8, y_off), cv2.FONT_HERSHEY_SIMPLEX, 0.32, color, 1)
            y_off += 14

    return vis


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate YOLOv8-Pose furniture model")
    parser.add_argument(
        "--model",
        default="/mnt/d/dataset_pipeline/runs/pose_v1/weights/best.pt",
        help="Path to trained model weights",
    )
    parser.add_argument(
        "--test-images",
        default="/mnt/d/dataset_pipeline/yolo_pose_v1/images/test",
        help="Test images directory",
    )
    parser.add_argument(
        "--test-labels",
        default="/mnt/d/dataset_pipeline/yolo_pose_v1/labels/test",
        help="Test labels directory",
    )
    parser.add_argument(
        "--output",
        default="/mnt/d/dataset_pipeline/runs/pose_v1/eval_viz",
        help="Output directory for visualizations",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Inference image size",
    )
    parser.add_argument(
        "--also-val",
        action="store_true",
        help="Also evaluate on val set",
    )
    args = parser.parse_args()

    model_path = Path(args.model)
    if not model_path.exists():
        print(f"ERROR: model not found: {model_path}", file=sys.stderr)
        return 1

    print(f"[eval] Loading model: {model_path}")
    model = YOLO(str(model_path))

    eval_sets = [("test", Path(args.test_images), Path(args.test_labels))]
    if args.also_val:
        val_img = Path(args.test_images).parent / "val"
        val_lbl = Path(args.test_labels).parent / "val"
        if val_img.exists():
            eval_sets.append(("val", val_img, val_lbl))

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    all_results = {}

    for split_name, img_dir, lbl_dir in eval_sets:
        if not img_dir.exists():
            print(f"[eval] WARN: {split_name} images dir not found: {img_dir}")
            continue

        split_out = output_dir / split_name
        split_out.mkdir(parents=True, exist_ok=True)

        image_files = sorted(
            p for p in img_dir.iterdir()
            if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
        )

        split_errors: Dict[str, List[float]] = {role: [] for role in ROLES}
        role_predicted = {role: 0 for role in ROLES}
        role_total = {role: 0 for role in ROLES}
        results_per_image = []

        for img_path in image_files:
            stem = img_path.stem
            label_path = lbl_dir / (stem + ".txt")

            gt = load_gt_label(label_path) if label_path.exists() else None
            pred = predict_keypoints(model, img_path, imgsz=args.imgsz)

            errors = {}
            if gt is not None and pred is not None:
                errors = compute_endpoint_error_mos(gt, pred)

            # Track per-role stats
            for role in ROLES:
                if gt is not None:
                    i1, i2 = ROLE_KPT_INDICES[role]
                    if gt[i1, 2] > 0 and gt[i2, 2] > 0:
                        role_total[role] += 1
                        if role in errors and errors[role].get("predicted", False):
                            role_predicted[role] += 1
                            split_errors[role].append(errors[role]["error"])

            # Draw visualization
            img_bgr = cv2.imread(str(img_path))
            if img_bgr is not None:
                viz = draw_comparison(img_bgr, gt, pred, errors, stem)
                cv2.imwrite(str(split_out / f"{stem}_compare.jpg"), viz, [cv2.IMWRITE_JPEG_QUALITY, 90])

            results_per_image.append({
                "name": stem,
                "errors": errors,
                "has_gt": gt is not None,
                "has_pred": pred is not None,
            })

        # Compute summary metrics
        role_summary = {}
        for role in ROLES:
            errs = split_errors[role]
            total = role_total[role]
            predicted = role_predicted[role]
            role_summary[role] = {
                "mee": round(float(np.mean(errs)), 2) if errs else None,
                "median_ee": round(float(np.median(errs)), 2) if errs else None,
                "max_ee": round(float(np.max(errs)), 2) if errs else None,
                "coverage": round(predicted / max(1, total) * 100, 1),
                "predicted": predicted,
                "total_gt": total,
            }

        overall_errors = [e for errs in split_errors.values() for e in errs]
        overall_mee = round(float(np.mean(overall_errors)), 2) if overall_errors else None
        overall_coverage = round(
            sum(role_predicted.values()) / max(1, sum(role_total.values())) * 100, 1
        )

        split_summary = {
            "split": split_name,
            "total_images": len(image_files),
            "overall_mee": overall_mee,
            "overall_coverage_pct": overall_coverage,
            "per_role": role_summary,
            "per_image": results_per_image,
        }

        all_results[split_name] = split_summary

        print(f"\n[eval] {split_name} set ({len(image_files)} images):")
        print(f"  Overall MEE: {overall_mee}")
        print(f"  Overall Coverage: {overall_coverage}%")
        for role in ROLES:
            r = role_summary[role]
            mee_str = f"{r['mee']:.1f}" if r["mee"] is not None else "N/A"
            print(f"  {role:4s}: MEE={mee_str:>6s}  coverage={r['coverage']:>5.1f}%  ({r['predicted']}/{r['total_gt']})")

    # Save results
    results_path = output_dir / "eval_results.json"
    results_path.write_text(json.dumps(all_results, indent=2), encoding="utf-8")
    print(f"\n[eval] Results saved to {results_path}")
    print(f"[eval] Visualizations saved to {output_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
