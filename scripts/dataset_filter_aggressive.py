#!/usr/bin/env python3
"""Aggressive automated dataset cleaner for sofa + armchair training images.

Input: deduped image directory
Output:
  - clean/images
  - split/train|val|test/images
  - reports/kept.csv
  - reports/rejected.csv
  - reports/summary.json

This script uses cv2 + numpy heuristics only (no deep model required):
  - technical quality (decode, min resolution, blur)
  - foreground framing (mask area, centering, border touches)
  - overlay/annotation rejection (red/cyan line density + Hough lines)
  - front-view preference (mask symmetry)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import cv2
import numpy as np


VALID_EXTS = {
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".avif",
  ".gif",
}


@dataclass
class Metrics:
  path: str
  width: int = 0
  height: int = 0
  blur_var: float = 0.0
  overlay_ratio: float = 0.0
  overlay_line_count: int = 0
  mask_area_ratio: float = 0.0
  bbox_area_ratio: float = 0.0
  center_dist_norm: float = 0.0
  border_touches: int = 0
  symmetry_score: float = 0.0
  keep: bool = False
  reason: str = ""
  out_name: str = ""
  split: str = ""


def iter_images(root: Path) -> Iterable[Path]:
  for p in root.rglob("*"):
    if p.is_file() and p.suffix.lower() in VALID_EXTS:
      yield p


def read_image(path: Path) -> Optional[np.ndarray]:
  try:
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    return img
  except Exception:
    return None


def blur_variance(img_bgr: np.ndarray) -> float:
  gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
  return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def overlay_signal(img_bgr: np.ndarray) -> Tuple[float, int]:
  hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
  h = hsv[:, :, 0]
  s = hsv[:, :, 1]
  v = hsv[:, :, 2]

  red_mask = (((h <= 10) | (h >= 170)) & (s >= 120) & (v >= 80)).astype(np.uint8) * 255
  cyan_mask = ((h >= 78) & (h <= 102) & (s >= 90) & (v >= 80)).astype(np.uint8) * 255
  color_mask = cv2.bitwise_or(red_mask, cyan_mask)

  ratio = float(np.count_nonzero(color_mask)) / float(color_mask.size)

  lines = cv2.HoughLinesP(
    color_mask,
    rho=1,
    theta=np.pi / 180,
    threshold=25,
    minLineLength=max(18, int(min(img_bgr.shape[:2]) * 0.06)),
    maxLineGap=6,
  )
  line_count = 0 if lines is None else int(len(lines))
  return ratio, line_count


def build_foreground_mask(img_bgr: np.ndarray) -> np.ndarray:
  h, w = img_bgr.shape[:2]

  # GrabCut primary attempt
  mask = np.zeros((h, w), np.uint8)
  bgd = np.zeros((1, 65), np.float64)
  fgd = np.zeros((1, 65), np.float64)
  mx = max(8, int(w * 0.08))
  my = max(8, int(h * 0.08))
  rect = (mx, my, max(1, w - 2 * mx), max(1, h - 2 * my))

  try:
    cv2.grabCut(img_bgr, mask, rect, bgd, fgd, 3, cv2.GC_INIT_WITH_RECT)
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
  except Exception:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    _, fg = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

  kernel = np.ones((5, 5), np.uint8)
  fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, kernel, iterations=2)
  fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, kernel, iterations=1)
  return fg


def mask_geometry(mask: np.ndarray) -> Dict[str, float]:
  h, w = mask.shape[:2]
  nz = np.argwhere(mask > 0)
  if nz.size == 0:
    return {
      "mask_area_ratio": 0.0,
      "bbox_area_ratio": 0.0,
      "center_dist_norm": 1.0,
      "border_touches": 4,
      "symmetry_score": 0.0,
    }

  y_min, x_min = nz.min(axis=0)
  y_max, x_max = nz.max(axis=0)
  bbox_w = max(1, int(x_max - x_min + 1))
  bbox_h = max(1, int(y_max - y_min + 1))

  mask_area_ratio = float(nz.shape[0]) / float(mask.size)
  bbox_area_ratio = float(bbox_w * bbox_h) / float(mask.size)

  cx = (x_min + x_max) / 2.0
  cy = (y_min + y_max) / 2.0
  dx = abs(cx - (w / 2.0)) / max(1.0, w / 2.0)
  dy = abs(cy - (h / 2.0)) / max(1.0, h / 2.0)
  center_dist_norm = float((dx + dy) / 2.0)

  border_touches = 0
  if x_min <= 4:
    border_touches += 1
  if y_min <= 4:
    border_touches += 1
  if x_max >= w - 5:
    border_touches += 1
  if y_max >= h - 5:
    border_touches += 1

  # Mirror symmetry score from central crop of mask
  left = mask[:, : w // 2]
  right = mask[:, w - (w // 2) :]
  right_flip = np.fliplr(right)
  common_w = min(left.shape[1], right_flip.shape[1])
  left = left[:, :common_w]
  right_flip = right_flip[:, :common_w]
  inter = np.logical_and(left > 0, right_flip > 0).sum()
  union = np.logical_or(left > 0, right_flip > 0).sum()
  symmetry_score = float(inter / union) if union > 0 else 0.0

  return {
    "mask_area_ratio": mask_area_ratio,
    "bbox_area_ratio": bbox_area_ratio,
    "center_dist_norm": center_dist_norm,
    "border_touches": float(border_touches),
    "symmetry_score": symmetry_score,
  }


def assign_split(path: Path) -> str:
  h = hashlib.sha1(str(path).encode("utf-8")).hexdigest()
  v = int(h[:8], 16) % 100
  if v < 80:
    return "train"
  if v < 90:
    return "val"
  return "test"


def evaluate(path: Path, min_w: int, min_h: int) -> Metrics:
  m = Metrics(path=str(path))

  img = read_image(path)
  if img is None:
    m.reason = "decode_failed"
    return m

  h, w = img.shape[:2]
  m.width = int(w)
  m.height = int(h)

  if w < min_w or h < min_h:
    m.reason = "low_resolution"
    return m

  m.blur_var = blur_variance(img)
  if m.blur_var < 80.0:
    m.reason = "blurry"
    return m

  m.overlay_ratio, m.overlay_line_count = overlay_signal(img)
  if m.overlay_ratio > 0.015 and m.overlay_line_count >= 25:
    m.reason = "annotated_overlay"
    return m

  mask = build_foreground_mask(img)
  geo = mask_geometry(mask)
  m.mask_area_ratio = float(geo["mask_area_ratio"])
  m.bbox_area_ratio = float(geo["bbox_area_ratio"])
  m.center_dist_norm = float(geo["center_dist_norm"])
  m.border_touches = int(geo["border_touches"])
  m.symmetry_score = float(geo["symmetry_score"])

  if m.mask_area_ratio < 0.10:
    m.reason = "no_furniture_signal"
    return m
  if m.bbox_area_ratio < 0.20:
    m.reason = "too_far_or_small_subject"
    return m
  if m.bbox_area_ratio > 0.85:
    m.reason = "too_close_or_macro"
    return m
  if m.center_dist_norm > 0.30:
    m.reason = "off_center"
    return m
  if m.border_touches > 2:
    m.reason = "cropped_subject"
    return m
  if m.symmetry_score < 0.45:
    m.reason = "not_front_view_like"
    return m

  m.keep = True
  m.reason = "kept"
  return m


def write_csv(path: Path, rows: List[Metrics]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    header = list(asdict(rows[0]).keys()) if rows else list(asdict(Metrics(path="")).keys())
    w.writerow(header)
    for r in rows:
      d = asdict(r)
      w.writerow([d[k] for k in header])


def main() -> int:
  parser = argparse.ArgumentParser(description="Aggressive automated dataset filtering")
  parser.add_argument("--input", required=True, help="Input image folder (deduped images)")
  parser.add_argument("--out", required=True, help="Output root")
  parser.add_argument("--min-width", type=int, default=900)
  parser.add_argument("--min-height", type=int, default=900)
  parser.add_argument("--max-keep", type=int, default=1400)
  args = parser.parse_args()

  input_dir = Path(args.input)
  out_root = Path(args.out)
  clean_dir = out_root / "clean" / "images"
  split_root = out_root / "split"
  reports = out_root / "reports"

  files = sorted(iter_images(input_dir))
  all_metrics: List[Metrics] = []
  kept: List[Metrics] = []
  rejected: List[Metrics] = []

  for idx, p in enumerate(files, start=1):
    m = evaluate(p, min_w=args.min_width, min_h=args.min_height)
    all_metrics.append(m)
    if m.keep:
      kept.append(m)
    else:
      rejected.append(m)

    if idx % 250 == 0:
      print(f"[filter] processed {idx}/{len(files)}")

  # Aggressive mode: keep top-N by quality proxies.
  kept_sorted = sorted(
    kept,
    key=lambda r: (
      r.symmetry_score,
      -r.center_dist_norm,
      r.blur_var,
      -r.overlay_ratio,
    ),
    reverse=True,
  )
  if args.max_keep > 0 and len(kept_sorted) > args.max_keep:
    overflow = kept_sorted[args.max_keep:]
    for m in overflow:
      m.keep = False
      m.reason = "trimmed_by_max_keep"
    rejected.extend(overflow)
    kept_sorted = kept_sorted[: args.max_keep]

  clean_dir.mkdir(parents=True, exist_ok=True)
  for idx, m in enumerate(kept_sorted, start=1):
    src = Path(m.path)
    ext = src.suffix.lower() if src.suffix.lower() in VALID_EXTS else ".jpg"
    name = f"clean_{idx:05d}{ext}"
    dst = clean_dir / name
    shutil.copyfile(src, dst)
    m.out_name = name
    split = assign_split(dst)
    m.split = split

    split_dir = split_root / split / "images"
    split_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(dst, split_dir / name)

  write_csv(reports / "kept.csv", kept_sorted)
  write_csv(reports / "rejected.csv", rejected)
  write_csv(reports / "all_metrics.csv", all_metrics)

  reason_counts: Dict[str, int] = {}
  for r in rejected:
    reason_counts[r.reason] = reason_counts.get(r.reason, 0) + 1

  split_counts = {"train": 0, "val": 0, "test": 0}
  for r in kept_sorted:
    if r.split in split_counts:
      split_counts[r.split] += 1

  summary = {
    "input_total": len(files),
    "kept_total": len(kept_sorted),
    "rejected_total": len(rejected),
    "split_counts": split_counts,
    "reject_reasons": reason_counts,
    "thresholds": {
      "min_width": args.min_width,
      "min_height": args.min_height,
      "blur_min": 80.0,
      "overlay_ratio_max": 0.015,
      "overlay_line_count_max": 24,
      "bbox_area_min": 0.20,
      "bbox_area_max": 0.85,
      "center_dist_max": 0.30,
      "border_touches_max": 2,
      "symmetry_min": 0.45,
      "max_keep": args.max_keep,
    },
  }
  reports.mkdir(parents=True, exist_ok=True)
  (reports / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

  print("[filter] complete")
  print(json.dumps(summary, indent=2))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
