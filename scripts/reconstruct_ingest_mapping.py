#!/usr/bin/env python3
"""Reconstruct strict img_* -> photo_* mapping from ingestion inventory.

This recovers the deduped-name bridge created by dataset_ingest.py, then remaps
guide matching JSON files from img_* stems onto photo_* stems.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def read_inventory_first_seen(inventory_csv: Path) -> list[tuple[str, str]]:
    first_seen: dict[str, str] = {}
    with inventory_csv.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            digest = (row.get("sha256") or "").strip()
            src = (row.get("source_path") or "").strip()
            decode_ok = (row.get("decode_ok") or "").strip().lower()
            if not digest or not src:
                continue
            if decode_ok == "false":
                continue
            if digest not in first_seen:
                first_seen[digest] = src
    return [(digest, src) for digest, src in first_seen.items()]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def remap_matches(
    src_matches: dict[str, dict],
    img_to_photo: dict[str, str],
) -> tuple[dict[str, dict], dict]:
    out: dict[str, dict] = {}
    unmapped: list[str] = []
    collisions: list[dict] = []

    for img_stem, entry in src_matches.items():
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

    stats = {
        "input_count": len(src_matches),
        "output_count": len(out),
        "unmapped_count": len(unmapped),
        "collision_count": len(collisions),
        "unmapped_sample": unmapped[:25],
        "collision_sample": collisions[:10],
    }
    return out, stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconstruct strict img->photo mapping")
    parser.add_argument("--inventory-csv", default="/mnt/d/dataset_pipeline/reports/inventory.csv")
    parser.add_argument("--deduped-dir", default="/mnt/d/dataset_pipeline/20_deduped")
    parser.add_argument("--customer-dir", default="/mnt/d/customer-photos")
    parser.add_argument("--matches-json", default="")
    parser.add_argument("--progress-json", default="")
    parser.add_argument("--output-dir", default="/mnt/d/dataset_pipeline/reports/reconstructed_mapping")
    parser.add_argument("--verify-sha", action="store_true")
    args = parser.parse_args()

    inventory_csv = Path(args.inventory_csv)
    deduped_dir = Path(args.deduped_dir)
    customer_dir = Path(args.customer_dir)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not inventory_csv.exists():
        raise SystemExit(f"ERROR: inventory CSV not found: {inventory_csv}")
    if not deduped_dir.exists():
        raise SystemExit(f"ERROR: deduped dir not found: {deduped_dir}")
    if not customer_dir.exists():
        raise SystemExit(f"ERROR: customer dir not found: {customer_dir}")

    first_seen = read_inventory_first_seen(inventory_csv)
    img_to_src: dict[str, str] = {}
    img_to_photo: dict[str, str] = {}
    src_to_img: dict[str, str] = {}
    strict_skipped = 0
    verified = 0
    verify_fail = 0

    for idx, (digest, src) in enumerate(first_seen, start=1):
        img_stem = f"img_{idx:06d}"
        src_path = Path(src)
        img_to_src[img_stem] = src
        src_to_img[src] = img_stem

        try:
            rel = src_path.relative_to(customer_dir)
            in_customer = True
        except ValueError:
            in_customer = False

        if not in_customer:
            strict_skipped += 1
            continue
        if len(rel.parts) != 1:
            strict_skipped += 1
            continue
        if not src_path.stem.startswith("photo_"):
            strict_skipped += 1
            continue

        # Optional strict SHA verification between deduped file and recorded digest.
        if args.verify_sha:
            deduped_match = list(deduped_dir.glob(f"{img_stem}.*"))
            if len(deduped_match) != 1:
                verify_fail += 1
                continue
            got = sha256_file(deduped_match[0])
            if got != digest:
                verify_fail += 1
                continue
            verified += 1

        img_to_photo[img_stem] = src_path.stem

    (out_dir / "img_to_source.json").write_text(json.dumps(img_to_src, indent=2), encoding="utf-8")
    (out_dir / "img_to_photo_strict.json").write_text(
        json.dumps(img_to_photo, indent=2), encoding="utf-8"
    )

    summary = {
        "inventory_rows_first_seen": len(first_seen),
        "img_to_source_count": len(img_to_src),
        "img_to_photo_strict_count": len(img_to_photo),
        "strict_skipped": strict_skipped,
        "sha_verification_enabled": bool(args.verify_sha),
        "sha_verified_ok": verified,
        "sha_verification_failed": verify_fail,
    }

    # Optional remap: matches json (plain dict)
    if args.matches_json:
        matches_path = Path(args.matches_json)
        data = load_json(matches_path)
        if "matches" in data and isinstance(data["matches"], dict):
            src_matches = data["matches"]
        else:
            src_matches = data
        remapped, stats = remap_matches(src_matches, img_to_photo)
        (out_dir / "photo_guide_matches_remapped.json").write_text(
            json.dumps(remapped, indent=2), encoding="utf-8"
        )
        summary["matches_remap"] = stats

    # Optional remap: progress json ({matches, skipped, photoIdx})
    if args.progress_json:
        progress_path = Path(args.progress_json)
        progress = load_json(progress_path)
        src_matches = progress.get("matches", {}) if isinstance(progress, dict) else {}
        remapped_matches, stats = remap_matches(src_matches, img_to_photo)

        remapped_skipped = []
        for s in progress.get("skipped", []) if isinstance(progress, dict) else []:
            photo = img_to_photo.get(str(s))
            if photo:
                remapped_skipped.append(photo)

        remapped_progress = {
            "matches": remapped_matches,
            "skipped": sorted(set(remapped_skipped)),
            "photoIdx": 0,
        }
        (out_dir / "guide_match_progress_remapped.json").write_text(
            json.dumps(remapped_progress, indent=2), encoding="utf-8"
        )
        summary["progress_remap"] = {
            **stats,
            "skipped_input_count": len(progress.get("skipped", [])) if isinstance(progress, dict) else 0,
            "skipped_output_count": len(remapped_progress["skipped"]),
        }

    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"[map] strict img->photo mappings: {len(img_to_photo)}")
    print(f"[map] output: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
