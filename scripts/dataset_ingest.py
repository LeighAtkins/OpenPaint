#!/usr/bin/env python3
"""
Dataset ingestion pipeline for mixed image/archive inboxes.

Stages:
1) Extract ZIP archives to staging.
2) Collect image candidates from loose + extracted files.
3) Optional decode/size validation (if Pillow is installed).
4) Exact dedupe by SHA256.
5) Write reports and optionally copy deduped files to output folder.

This script is intentionally dependency-light and can run with stdlib only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib
import json
import os
import shutil
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


IMAGE_EXTS = {
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".bmp",
  ".tif",
  ".tiff",
  ".gif",
  ".avif",
}


Image = None
try:
  pil_image_module = importlib.import_module("PIL.Image")
  Image = pil_image_module
  HAS_PIL = True
except Exception:
  HAS_PIL = False


@dataclass
class Candidate:
  source_path: Path
  provenance: str
  ext: str
  size_bytes: int
  width: Optional[int] = None
  height: Optional[int] = None
  decode_ok: Optional[bool] = None
  sha256: Optional[str] = None


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
  digest = hashlib.sha256()
  with path.open("rb") as f:
    while True:
      chunk = f.read(chunk_size)
      if not chunk:
        break
      digest.update(chunk)
  return digest.hexdigest()


def discover_zips(root: Path) -> List[Path]:
  out: List[Path] = []
  for p in root.rglob("*"):
    if p.is_file() and p.suffix.lower() == ".zip":
      out.append(p)
  return sorted(out)


def extract_zips(zip_paths: Iterable[Path], out_root: Path) -> Tuple[int, int]:
  extracted = 0
  failed = 0
  out_root.mkdir(parents=True, exist_ok=True)

  for zpath in zip_paths:
    zhash = hashlib.sha1(str(zpath).encode("utf-8")).hexdigest()[:12]
    target = out_root / f"zip_{zhash}"
    if target.exists() and any(target.iterdir()):
      extracted += 1
      continue

    target.mkdir(parents=True, exist_ok=True)
    try:
      with zipfile.ZipFile(zpath) as zf:
        zf.extractall(target)
      extracted += 1
    except Exception:
      failed += 1

  return extracted, failed


def iter_image_files(root: Path) -> Iterable[Path]:
  for p in root.rglob("*"):
    if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
      yield p


def build_candidates(loose_images_root: Path, extracted_root: Path) -> List[Candidate]:
  candidates: List[Candidate] = []

  if loose_images_root.exists():
    for p in iter_image_files(loose_images_root):
      candidates.append(
        Candidate(
          source_path=p,
          provenance="loose",
          ext=p.suffix.lower(),
          size_bytes=p.stat().st_size,
        )
      )

  if extracted_root.exists():
    for p in iter_image_files(extracted_root):
      candidates.append(
        Candidate(
          source_path=p,
          provenance="zip_extracted",
          ext=p.suffix.lower(),
          size_bytes=p.stat().st_size,
        )
      )

  return candidates


def validate_images(candidates: List[Candidate], min_width: int, min_height: int) -> Tuple[int, int]:
  if not HAS_PIL:
    return 0, 0

  ok = 0
  rejected_small = 0
  for item in candidates:
    try:
      with Image.open(item.source_path) as im:  # type: ignore[union-attr]
        w, h = im.size
      item.width = int(w)
      item.height = int(h)
      item.decode_ok = True
      ok += 1
      if w < min_width or h < min_height:
        item.decode_ok = False
        rejected_small += 1
    except Exception:
      item.decode_ok = False

  return ok, rejected_small


def dedupe_exact(candidates: List[Candidate]) -> Tuple[List[Candidate], List[Tuple[str, Path]]]:
  seen: Dict[str, Candidate] = {}
  duplicates: List[Tuple[str, Path]] = []

  for item in candidates:
    if item.decode_ok is False:
      continue
    digest = sha256_file(item.source_path)
    item.sha256 = digest
    if digest not in seen:
      seen[digest] = item
    else:
      duplicates.append((digest, item.source_path))

  uniques = list(seen.values())
  return uniques, duplicates


def copy_uniques(uniques: List[Candidate], out_dir: Path) -> None:
  out_dir.mkdir(parents=True, exist_ok=True)
  for idx, item in enumerate(uniques, start=1):
    stem = f"img_{idx:06d}"
    ext = item.ext if item.ext in IMAGE_EXTS else ".jpg"
    target = out_dir / f"{stem}{ext}"
    # On some drvfs mounts (Windows drives in WSL), preserving metadata can fail.
    # Use copyfile to maximize compatibility.
    shutil.copyfile(item.source_path, target)


def write_reports(
  reports_dir: Path,
  candidates: List[Candidate],
  uniques: List[Candidate],
  duplicates: List[Tuple[str, Path]],
) -> None:
  reports_dir.mkdir(parents=True, exist_ok=True)

  with (reports_dir / "inventory.csv").open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow([
      "source_path",
      "provenance",
      "ext",
      "size_bytes",
      "width",
      "height",
      "decode_ok",
      "sha256",
    ])
    for item in candidates:
      w.writerow([
        str(item.source_path),
        item.provenance,
        item.ext,
        item.size_bytes,
        item.width if item.width is not None else "",
        item.height if item.height is not None else "",
        item.decode_ok if item.decode_ok is not None else "",
        item.sha256 or "",
      ])

  with (reports_dir / "duplicates_exact.csv").open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["sha256", "duplicate_path"])
    for digest, path in duplicates:
      w.writerow([digest, str(path)])

  summary = {
    "total_candidates": len(candidates),
    "decode_enabled": HAS_PIL,
    "decode_ok": sum(1 for c in candidates if c.decode_ok is True),
    "decode_failed_or_rejected": sum(1 for c in candidates if c.decode_ok is False),
    "unique_exact": len(uniques),
    "duplicates_exact": len(duplicates),
  }
  (reports_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def main() -> int:
  parser = argparse.ArgumentParser(description="Automated dataset inbox ingestion")
  parser.add_argument("--inbox", required=True, help="Input root (contains images/ and zips/)")
  parser.add_argument("--out", required=True, help="Output pipeline root")
  parser.add_argument("--min-width", type=int, default=600)
  parser.add_argument("--min-height", type=int, default=600)
  parser.add_argument("--skip-copy", action="store_true", help="Only produce reports")
  args = parser.parse_args()

  inbox = Path(args.inbox)
  out_root = Path(args.out)
  extracted_root = out_root / "00_extracted"
  deduped_root = out_root / "20_deduped"
  reports_root = out_root / "reports"

  images_root = inbox / "images"
  zips_root = inbox / "zips"

  if not inbox.exists():
    print(f"ERROR: inbox does not exist: {inbox}", file=sys.stderr)
    return 2

  zip_paths = discover_zips(zips_root) if zips_root.exists() else []
  extracted_count, failed_count = extract_zips(zip_paths, extracted_root)

  candidates = build_candidates(images_root, extracted_root)
  validate_images(candidates, min_width=args.min_width, min_height=args.min_height)

  # If PIL is unavailable, treat unknown decode state as acceptable.
  if not HAS_PIL:
    for item in candidates:
      if item.decode_ok is None:
        item.decode_ok = True

  uniques, duplicates = dedupe_exact(candidates)

  if not args.skip_copy:
    copy_uniques(uniques, deduped_root)

  write_reports(reports_root, candidates, uniques, duplicates)

  print("[dataset_ingest] complete")
  print(f"  inbox: {inbox}")
  print(f"  zip_files: {len(zip_paths)}")
  print(f"  zip_extracted: {extracted_count}")
  print(f"  zip_failed: {failed_count}")
  print(f"  candidates: {len(candidates)}")
  print(f"  pil_decode_enabled: {HAS_PIL}")
  print(f"  unique_exact: {len(uniques)}")
  print(f"  duplicates_exact: {len(duplicates)}")
  print(f"  reports: {reports_root}")
  if not args.skip_copy:
    print(f"  deduped_images: {deduped_root}")

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
