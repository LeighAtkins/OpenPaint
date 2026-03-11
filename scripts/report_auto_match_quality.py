#!/usr/bin/env python3
"""Generate a compact quality report for auto_match_guides outputs."""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = int(max(0, min(len(sorted_vals) - 1, round((len(sorted_vals) - 1) * p))))
    return float(sorted_vals[idx])


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize auto-match run quality")
    parser.add_argument("--run-dir", required=True, help="Directory with auto-match output files")
    args = parser.parse_args()

    run_dir = Path(args.run_dir)
    if not run_dir.exists():
        raise SystemExit(f"ERROR: run dir not found: {run_dir}")

    summary_path = run_dir / "summary.json"
    detailed_path = run_dir / "auto_matches_detailed.json"
    highq_path = run_dir / "review_queue_high_conf.json"
    lowq_path = run_dir / "review_queue_low_margin.json"

    if not summary_path.exists() or not detailed_path.exists() or not highq_path.exists() or not lowq_path.exists():
        raise SystemExit("ERROR: required output files missing in run dir")

    summary = load_json(summary_path)
    detailed = load_json(detailed_path).get("predictions", {})
    high_q = load_json(highq_path)
    low_q = load_json(lowq_path)

    conf = [float(x.get("confidence", 0.0)) for x in high_q if isinstance(x, dict)]
    margins = [float(x.get("margin", 0.0)) for x in low_q if isinstance(x, dict)]
    conf_sorted = sorted(conf)
    margin_sorted = sorted(margins)

    top100 = high_q[:100]
    top300 = high_q[:300]
    top500 = high_q[:500]

    def avg_conf(rows):
        vals = [float(r.get("confidence", 0.0)) for r in rows if isinstance(r, dict)]
        return float(sum(vals) / len(vals)) if vals else 0.0

    # Family/view distribution in top 300
    fam_top300: dict[str, int] = {}
    view_top300: dict[str, int] = {}
    for r in top300:
        stem = r.get("stem")
        if stem not in detailed:
            continue
        pred = detailed[stem].get("prediction", {})
        f = pred.get("factors", {}).get("family", "unknown")
        v = pred.get("view", "unknown")
        fam_top300[f] = fam_top300.get(f, 0) + 1
        view_top300[v] = view_top300.get(v, 0) + 1

    report = {
        "run_dir": str(run_dir),
        "train_examples": summary.get("train_examples"),
        "inference_targets": summary.get("inference_targets"),
        "predictions_written": summary.get("predictions_written"),
        "predicted_family_counts": summary.get("predicted_family_counts", {}),
        "predicted_view_counts": summary.get("predicted_view_counts", {}),
        "confidence": {
            "count": len(conf),
            "max": max(conf) if conf else 0.0,
            "p95": percentile(conf_sorted, 0.95),
            "p75": percentile(conf_sorted, 0.75),
            "median": statistics.median(conf) if conf else 0.0,
            "p25": percentile(conf_sorted, 0.25),
            "avg_top100": avg_conf(top100),
            "avg_top300": avg_conf(top300),
            "avg_top500": avg_conf(top500),
        },
        "margin": {
            "count": len(margins),
            "min": min(margins) if margins else 0.0,
            "p10": percentile(margin_sorted, 0.10),
            "median": statistics.median(margins) if margins else 0.0,
        },
        "top300_distribution": {
            "family": fam_top300,
            "view": view_top300,
        },
        "recommendation": {
            "review_first": "prefill_top300_non_cushion (if generated) else high_conf top300",
            "then": "high_conf remainder, then low_margin",
        },
    }

    out_json = run_dir / "quality_report.json"
    out_txt = run_dir / "quality_report.txt"
    out_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    txt_lines = [
        f"Run: {run_dir}",
        f"Train examples: {report['train_examples']}",
        f"Inference targets: {report['inference_targets']}",
        f"Predictions written: {report['predictions_written']}",
        "",
        f"Confidence median: {report['confidence']['median']:.4f}",
        f"Confidence p95: {report['confidence']['p95']:.4f}",
        f"Avg confidence top100: {report['confidence']['avg_top100']:.4f}",
        f"Avg confidence top300: {report['confidence']['avg_top300']:.4f}",
        f"Margin min: {report['margin']['min']:.4f}",
        f"Margin p10: {report['margin']['p10']:.4f}",
        "",
        f"Pred family counts: {report['predicted_family_counts']}",
        f"Pred view counts: {report['predicted_view_counts']}",
        f"Top300 family: {report['top300_distribution']['family']}",
        f"Top300 view: {report['top300_distribution']['view']}",
        "",
        "Review order:",
        "1) non-cushion high-confidence first",
        "2) remaining high-confidence",
        "3) low-margin last",
    ]
    out_txt.write_text("\n".join(txt_lines) + "\n", encoding="utf-8")

    print(f"[quality] wrote: {out_json}")
    print(f"[quality] wrote: {out_txt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
