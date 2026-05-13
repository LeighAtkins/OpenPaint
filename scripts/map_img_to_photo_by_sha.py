#!/usr/bin/env python3
"""Strictly map img_* stems to photo_* stems using exact SHA256 matches."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


IMAGE_EXTS = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif"
}


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def gather_stems_by_hash(root: Path, stem_prefix: str | None = None) -> tuple[dict[str, list[str]], int]:
    out: dict[str, list[str]] = {}
    total = 0
    for p in sorted(root.iterdir()):
        if not p.is_file() or p.suffix.lower() not in IMAGE_EXTS:
            continue
        stem = p.stem
        if stem_prefix and not stem.startswith(stem_prefix):
            continue
        try:
            digest = sha256_file(p)
        except Exception:
            continue
        out.setdefault(digest, []).append(stem)
        total += 1
    return out, total


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def remap_entries(entries: dict[str, dict], img_to_photo: dict[str, str]) -> tuple[dict[str, dict], dict]:
    out: dict[str, dict] = {}
    unmapped: list[str] = []
    collisions: list[dict] = []

    for img_stem, entry in entries.items():
        if not isinstance(entry, dict):
            continue
        photo_stem = img_to_photo.get(img_stem)
        if not photo_stem:
            unmapped.append(img_stem)
            continue
        prev = out.get(photo_stem)
        if prev is None:
            out[photo_stem] = entry
            continue
        if prev != entry:
            collisions.append(
                {
                    "photo_stem": photo_stem,
                    "img_stem": img_stem,
                    "existing": prev,
                    "incoming": entry,
                }
            )

    return out, {
        "input_count": len(entries),
        "output_count": len(out),
        "unmapped_count": len(unmapped),
        "collision_count": len(collisions),
        "unmapped_sample": unmapped[:25],
        "collision_sample": collisions[:10],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Map img_* to photo_* by exact SHA256")
    parser.add_argument("--deduped-dir", default="/mnt/d/dataset_pipeline/20_deduped")
    parser.add_argument("--customer-dir", default="/mnt/d/customer-photos")
    parser.add_argument("--matches-json", default="")
    parser.add_argument("--progress-json", default="")
    parser.add_argument("--output-dir", default="/mnt/d/dataset_pipeline/reports/reconstructed_mapping_sha")
    args = parser.parse_args()

    deduped_dir = Path(args.deduped_dir)
    customer_dir = Path(args.customer_dir)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not deduped_dir.exists():
        raise SystemExit(f"ERROR: deduped dir not found: {deduped_dir}")
    if not customer_dir.exists():
        raise SystemExit(f"ERROR: customer dir not found: {customer_dir}")

    deduped_hashes, deduped_total = gather_stems_by_hash(deduped_dir, stem_prefix="img_")
    customer_hashes, customer_total = gather_stems_by_hash(customer_dir, stem_prefix="photo_")

    img_to_photo: dict[str, str] = {}
    ambiguous = 0
    for digest, img_stems in deduped_hashes.items():
        photo_stems = customer_hashes.get(digest)
        if not photo_stems:
            continue
        if len(img_stems) != 1 or len(photo_stems) != 1:
            ambiguous += 1
            continue
        img_to_photo[img_stems[0]] = photo_stems[0]

    (out_dir / "img_to_photo_strict.json").write_text(json.dumps(img_to_photo, indent=2), encoding="utf-8")

    summary: dict[str, object] = {
        "deduped_total_files_hashed": deduped_total,
        "customer_total_files_hashed": customer_total,
        "deduped_unique_hashes": len(deduped_hashes),
        "customer_unique_hashes": len(customer_hashes),
        "strict_mapped_count": len(img_to_photo),
        "ambiguous_hash_groups": ambiguous,
    }

    if args.matches_json:
        mpath = Path(args.matches_json)
        raw = load_json(mpath)
        src = raw.get("matches", raw) if isinstance(raw, dict) else {}
        remapped, stats = remap_entries(src, img_to_photo)
        (out_dir / "photo_guide_matches_remapped.json").write_text(json.dumps(remapped, indent=2), encoding="utf-8")
        summary["matches_remap"] = stats

    if args.progress_json:
        ppath = Path(args.progress_json)
        raw = load_json(ppath)
        src = raw.get("matches", {}) if isinstance(raw, dict) else {}
        remapped_matches, stats = remap_entries(src, img_to_photo)
        remapped_skipped = []
        for s in raw.get("skipped", []) if isinstance(raw, dict) else []:
            mapped = img_to_photo.get(str(s))
            if mapped:
                remapped_skipped.append(mapped)
        progress_out = {
            "matches": remapped_matches,
            "skipped": sorted(set(remapped_skipped)),
            "photoIdx": 0,
        }
        (out_dir / "guide_match_progress_remapped.json").write_text(json.dumps(progress_out, indent=2), encoding="utf-8")
        summary["progress_remap"] = {
            **stats,
            "skipped_input_count": len(raw.get("skipped", [])) if isinstance(raw, dict) else 0,
            "skipped_output_count": len(progress_out["skipped"]),
        }

    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"[sha-map] strict mapped: {len(img_to_photo)}")
    print(f"[sha-map] output: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
