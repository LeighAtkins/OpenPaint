#!/usr/bin/env python3
"""Auto-match furniture photos to guide codes/views with factorized taxonomy.

Round-1 goal: produce review-only predictions (no auto-accept), sorted by confidence.

Inputs:
- A directory of photos (recursively scanned)
- Existing manual matches JSON with known code/view pairs

Outputs:
- Detailed predictions with top-k candidates and factorized labels
- Queue files sorted by confidence and by uncertainty margin
- Optional prefill file for guide-matcher.html progress loading
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


@dataclass(frozen=True)
class GuideLabel:
    code: str
    view: str

    @property
    def key(self) -> str:
        return f"{self.view}|{self.code}"


def load_matches(matches_path: Path) -> dict[str, dict[str, str]]:
    data = json.loads(matches_path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "matches" in data and isinstance(data["matches"], dict):
        payload = data["matches"]
    elif isinstance(data, dict):
        payload = data
    else:
        raise ValueError("Unsupported matches JSON structure")

    out: dict[str, dict[str, str]] = {}
    for stem, val in payload.items():
        if not isinstance(val, dict):
            continue
        code = str(val.get("code", "")).strip()
        view = str(val.get("view", "")).strip().lower()
        out[stem] = {"code": code, "view": view}
    return out


def collect_images(photo_dir: Path) -> dict[str, Path]:
    stem_to_path: dict[str, Path] = {}
    collisions = Counter()
    for p in sorted(photo_dir.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in IMAGE_EXTS:
            continue
        stem = p.stem
        if stem in stem_to_path:
            collisions[stem] += 1
            continue
        stem_to_path[stem] = p
    if collisions:
        print(f"[auto_match] WARN: {len(collisions)} duplicate stems ignored (first path kept)")
    return stem_to_path


def trailing_int(stem: str) -> int | None:
    num = ""
    for ch in reversed(stem):
        if ch.isdigit():
            num = ch + num
        else:
            break
    if not num:
        return None
    try:
        return int(num)
    except ValueError:
        return None


def build_id_index(stem_to_path: dict[str, Path]) -> dict[int, Path]:
    id_to_path: dict[int, Path] = {}
    collisions = 0
    for stem, p in stem_to_path.items():
        idx = trailing_int(stem)
        if idx is None:
            continue
        if idx in id_to_path:
            collisions += 1
            continue
        id_to_path[idx] = p
    if collisions:
        print(f"[auto_match] WARN: {collisions} numeric-id collisions in photo index")
    return id_to_path


def resolve_photo_path(stem: str, stem_to_path: dict[str, Path], id_to_path: dict[int, Path]) -> Path | None:
    p = stem_to_path.get(stem)
    if p is not None:
        return p
    idx = trailing_int(stem)
    if idx is None:
        return None
    return id_to_path.get(idx)


def image_descriptor(path: Path) -> np.ndarray | None:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        return None

    # Standardized canvas
    img_small = cv2.resize(img, (224, 224), interpolation=cv2.INTER_AREA)

    # Color histogram (HSV): coarse global appearance
    hsv = cv2.cvtColor(img_small, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [12, 8, 8], [0, 180, 0, 256, 0, 256])
    hist = cv2.normalize(hist, hist).flatten().astype(np.float32)

    # Gradient/orientation descriptor via HOG on grayscale
    gray = cv2.cvtColor(img_small, cv2.COLOR_BGR2GRAY)
    hog = cv2.HOGDescriptor(
        _winSize=(224, 224),
        _blockSize=(32, 32),
        _blockStride=(16, 16),
        _cellSize=(16, 16),
        _nbins=9,
    )
    hog_vec_raw = hog.compute(gray)
    if hog_vec_raw is None:
        return None
    hog_vec = np.asarray(hog_vec_raw, dtype=np.float32).reshape(-1)

    # Light dimensionality reduction by striding HOG vector.
    # Keeps runtime/memory manageable for kNN over thousands of photos.
    hog_stride = hog_vec[::12]

    vec = np.concatenate([hist, hog_stride], axis=0)
    norm = float(np.linalg.norm(vec))
    if norm <= 1e-8:
        return None
    return (vec / norm).astype(np.float32)


def cosine_knn_predict(
    query_vec: np.ndarray,
    train_mat: np.ndarray,
    train_labels: list[str],
    k: int,
) -> tuple[str, float, float, list[tuple[str, float]], list[tuple[int, float]]]:
    sims = train_mat @ query_vec
    if sims.ndim != 1 or sims.size == 0:
        return "", 0.0, 0.0, [], []

    k_eff = min(max(1, k), sims.size)
    top_idx = np.argpartition(-sims, k_eff - 1)[:k_eff]
    top_idx = top_idx[np.argsort(-sims[top_idx])]

    # Weighted vote by shifted cosine similarity (>=0)
    label_scores: dict[str, float] = defaultdict(float)
    for idx in top_idx:
        sim = float(sims[idx])
        weight = max(0.0, (sim + 1.0) / 2.0)
        label_scores[train_labels[int(idx)]] += weight

    ranked = sorted(label_scores.items(), key=lambda x: x[1], reverse=True)
    if not ranked:
        return "", 0.0, 0.0, [], []

    winner = ranked[0][0]
    total = sum(v for _, v in ranked)
    confidence = ranked[0][1] / total if total > 0 else 0.0
    margin = ranked[0][1] - (ranked[1][1] if len(ranked) > 1 else 0.0)

    neighbors = [(int(i), float(sims[i])) for i in top_idx]
    return winner, float(confidence), float(margin), ranked, neighbors


def parse_code_factors(code: str, view: str) -> dict[str, Any]:
    code = (code or "").strip().upper()
    view = (view or "none").strip().lower()
    parts = code.split("-") if code else []
    base = parts[0] if parts else ""
    suffix_lr = parts[-1] if parts and parts[-1] in {"L", "R"} else ""

    # Primary family
    family = "sofa"
    if code.startswith("CSS"):
        family = "ignore"
    elif code.startswith("CCL") or code.startswith("CC-") or code.startswith("CC"):
        family = "cushion"
    elif code.startswith("CSAP"):
        family = "arm_only"
    elif code.startswith("CSDC"):
        family = "dining_chair"
    elif code.startswith("CA-X"):
        family = "sofa_bed"
    elif code.startswith("CS4"):
        family = "return"
    elif code.startswith("CS0") or code.startswith("CS5"):
        family = "ottoman"

    # Panel length by CS* suffix convention
    panel_length = "none"
    if base.endswith("L"):
        panel_length = "long"
    elif base.endswith("B"):
        panel_length = "short"

    # Part family refinement
    if family in {"cushion", "arm_only", "ignore", "dining_chair", "ottoman", "return", "sofa_bed"}:
        part_family = family if family in {"cushion", "arm_only"} else "base"
    else:
        part_family = "base"

    if "NX" in base:
        part_family = "no_arm"

    arm_tokens_vocab = {
        "WA", "WA2", "SA", "SA2", "RA", "RA2", "LA", "SRA", "SLA",
        "SSA", "SSA2", "SSLA", "SSLA2", "SWA", "SWA2", "ERA",
    }
    token_set = set(parts)
    arm_tokens = sorted(t for t in token_set if t in arm_tokens_vocab)
    if arm_tokens and part_family not in {"cushion", "arm_only", "no_arm"}:
        part_family = "arm"

    # Laterality
    if suffix_lr == "L":
        laterality = "left"
    elif suffix_lr == "R":
        laterality = "right"
    else:
        has_left = any(t in token_set for t in {"LA", "SLA", "SSLA"})
        has_right = any(t in token_set for t in {"RA", "SRA", "ERA"})
        if has_left and not has_right:
            laterality = "left"
        elif has_right and not has_left:
            laterality = "right"
        else:
            laterality = "bilateral_or_none"

    cushion_subtype = "none"
    if code.startswith("CC-BK"):
        cushion_subtype = "back_cushion"
    elif code.startswith("CC-ST"):
        cushion_subtype = "seat_cushion"
    elif code.startswith("CCL-CH"):
        cushion_subtype = "chaise_cushion"

    return {
        "code_raw": code,
        "view": view,
        "family": family,
        "part_family": part_family,
        "panel_length": panel_length,
        "laterality": laterality,
        "arm_tokens": arm_tokens,
        "cushion_subtype": cushion_subtype,
        "excluded": family == "ignore",
    }


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto-match photos to guide code/view")
    parser.add_argument("--photo-dir", default="/mnt/d/dataset_pipeline/20_deduped")
    parser.add_argument("--matches", default="/mnt/d/dataset_pipeline/photo_guide_matches.json")
    parser.add_argument(
        "--train-photo-dir",
        default="",
        help="Optional image directory for labeled training stems (defaults to --photo-dir)",
    )
    parser.add_argument("--output-dir", default="/mnt/d/dataset_pipeline/reports/auto_match_round1")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--knn-k", type=int, default=15)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    np.random.seed(args.seed)

    photo_dir = Path(args.photo_dir)
    train_photo_dir = Path(args.train_photo_dir) if args.train_photo_dir else photo_dir
    matches_path = Path(args.matches)
    out_dir = Path(args.output_dir)
    ensure_dir(out_dir)

    if not photo_dir.exists():
        raise SystemExit(f"ERROR: photo dir not found: {photo_dir}")
    if not matches_path.exists():
        raise SystemExit(f"ERROR: matches file not found: {matches_path}")
    if not train_photo_dir.exists():
        raise SystemExit(f"ERROR: train photo dir not found: {train_photo_dir}")

    matches = load_matches(matches_path)
    infer_stem_to_path = collect_images(photo_dir)
    infer_id_to_path = build_id_index(infer_stem_to_path)
    train_stem_to_path = collect_images(train_photo_dir)
    train_id_to_path = build_id_index(train_stem_to_path)
    print(f"[auto_match] inference photos discovered: {len(infer_stem_to_path)}")
    print(f"[auto_match] training-photo pool discovered: {len(train_stem_to_path)}")

    # Build labeled training set from known matches
    train_items: list[tuple[str, Path, GuideLabel]] = []
    missing_train = 0
    for stem, m in matches.items():
        code = m.get("code", "")
        view = m.get("view", "")
        if code in {"", "__NONE__"}:
            continue
        if view not in {"front", "side", "back"}:
            continue
        p = resolve_photo_path(stem, train_stem_to_path, train_id_to_path)
        if p is None:
            missing_train += 1
            continue
        train_items.append((stem, p, GuideLabel(code=code, view=view)))

    if not train_items:
        raise SystemExit("ERROR: no train items available from manual matches")

    print(f"[auto_match] train items: {len(train_items)} (missing paths: {missing_train})")

    # Descriptors for train items
    train_vecs: list[np.ndarray] = []
    train_labels: list[str] = []
    train_label_to_obj: dict[str, GuideLabel] = {}
    bad_train = 0
    for _, p, label in train_items:
        vec = image_descriptor(p)
        if vec is None:
            bad_train += 1
            continue
        train_vecs.append(vec)
        train_labels.append(label.key)
        train_label_to_obj[label.key] = label

    if not train_vecs:
        raise SystemExit("ERROR: failed to produce any training descriptors")

    train_mat = np.stack(train_vecs, axis=0)
    print(f"[auto_match] train descriptors: {train_mat.shape[0]} (failed: {bad_train})")

    # Inference targets = photos not already matched to a non-none code
    known_non_none = {k for k, v in matches.items() if v.get("code") not in {"", "__NONE__"}}
    if train_photo_dir.resolve() == photo_dir.resolve():
        infer_stems = [s for s in sorted(infer_stem_to_path.keys()) if s not in known_non_none]
    else:
        infer_stems = sorted(infer_stem_to_path.keys())
    print(f"[auto_match] inference targets: {len(infer_stems)}")

    detailed: dict[str, Any] = {}
    prefill_matches: dict[str, dict[str, str]] = {}
    high_conf_queue: list[tuple[str, float, float]] = []
    low_margin_queue: list[tuple[str, float, float]] = []

    for i, stem in enumerate(infer_stems, start=1):
        p = infer_stem_to_path[stem]
        q = image_descriptor(p)
        if q is None:
            continue

        winner_key, conf, margin, ranked, neighbors = cosine_knn_predict(
            q, train_mat, train_labels, args.knn_k
        )
        if not winner_key:
            continue

        winner = train_label_to_obj[winner_key]
        factors = parse_code_factors(winner.code, winner.view)

        topk = []
        for lbl, score in ranked[: max(1, args.top_k)]:
            g = train_label_to_obj[lbl]
            topk.append(
                {
                    "code": g.code,
                    "view": g.view,
                    "label_key": lbl,
                    "score": round(float(score), 6),
                    "factors": parse_code_factors(g.code, g.view),
                }
            )

        # Keep prefill prediction regardless of confidence (review-only run).
        prefill_matches[stem] = {"code": winner.code, "view": winner.view}

        detailed[stem] = {
            "image_path": str(p),
            "prediction": {
                "code": winner.code,
                "view": winner.view,
                "confidence": round(conf, 6),
                "margin": round(margin, 6),
                "factors": factors,
            },
            "top_k": topk,
            "neighbors": [
                {
                    "train_stem": train_items[idx][0] if 0 <= idx < len(train_items) else "",
                    "label_key": train_labels[idx] if 0 <= idx < len(train_labels) else "",
                    "similarity": round(sim, 6),
                }
                for idx, sim in neighbors[: min(8, len(neighbors))]
            ],
        }

        high_conf_queue.append((stem, conf, margin))
        low_margin_queue.append((stem, conf, margin))

        if i % 400 == 0:
            print(f"[auto_match] processed {i}/{len(infer_stems)}")

    # Sort queues
    high_conf_queue.sort(key=lambda x: (-x[1], -x[2], x[0]))
    low_margin_queue.sort(key=lambda x: (x[2], -x[1], x[0]))

    # Summary stats
    pred_family = Counter()
    pred_view = Counter()
    pred_laterality = Counter()
    excluded_count = 0
    for d in detailed.values():
        f = d["prediction"]["factors"]
        pred_family[f["family"]] += 1
        pred_view[f["view"]] += 1
        pred_laterality[f["laterality"]] += 1
        if f["excluded"]:
            excluded_count += 1

    summary = {
        "photo_dir": str(photo_dir),
        "train_photo_dir": str(train_photo_dir),
        "matches_path": str(matches_path),
        "train_examples": int(train_mat.shape[0]),
        "inference_targets": len(infer_stems),
        "predictions_written": len(detailed),
        "excluded_css_predictions": excluded_count,
        "predicted_family_counts": dict(pred_family),
        "predicted_view_counts": dict(pred_view),
        "predicted_laterality_counts": dict(pred_laterality),
        "notes": [
            "Round-1 is review-only: no auto-accept threshold applied.",
            "Use high_conf_queue first for manual verification.",
            "CSS family is marked excluded by taxonomy rules.",
        ],
    }

    # Write files
    (out_dir / "auto_matches_detailed.json").write_text(
        json.dumps({"summary": summary, "predictions": detailed}, indent=2),
        encoding="utf-8",
    )
    (out_dir / "auto_matches_prefill_progress.json").write_text(
        json.dumps({"matches": prefill_matches, "skipped": [], "photoIdx": 0}, indent=2),
        encoding="utf-8",
    )
    (out_dir / "auto_matches_prefill_export.json").write_text(
        json.dumps(prefill_matches, indent=2),
        encoding="utf-8",
    )
    (out_dir / "review_queue_high_conf.json").write_text(
        json.dumps(
            [{"stem": s, "confidence": round(c, 6), "margin": round(m, 6)} for s, c, m in high_conf_queue],
            indent=2,
        ),
        encoding="utf-8",
    )
    (out_dir / "review_queue_low_margin.json").write_text(
        json.dumps(
            [{"stem": s, "confidence": round(c, 6), "margin": round(m, 6)} for s, c, m in low_margin_queue],
            indent=2,
        ),
        encoding="utf-8",
    )
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"[auto_match] predictions: {len(detailed)}")
    print(f"[auto_match] output dir: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
