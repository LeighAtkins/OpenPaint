#!/usr/bin/env python3
"""Live training dashboard — compares YOLO pose runs.

Usage:
    python scripts/training_dashboard.py [--runs-dir DIR] [--show run1,run2,...] [--highlight run]

Auto-refreshes every 30s while training is in progress.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

try:
    import matplotlib
    matplotlib.use("TkAgg")
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation
except ImportError:
    print("ERROR: matplotlib not installed", file=sys.stderr)
    sys.exit(1)


def read_results(csv_path: Path) -> dict[str, list[float]]:
    """Read a YOLO results.csv into {column: [values]}."""
    data: dict[str, list[float]] = {}
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            for key, val in row.items():
                key = key.strip()
                try:
                    data.setdefault(key, []).append(float(val))
                except (ValueError, TypeError):
                    pass
    return data


# Metrics to plot: (title, csv_column, higher_is_better)
PLOTS = [
    ("Pose mAP50", "metrics/mAP50(P)", True),
    ("Pose mAP50-95", "metrics/mAP50-95(P)", True),
    ("Box mAP50", "metrics/mAP50(B)", True),
    ("Pose Loss (val)", "val/pose_loss", False),
    ("Box Loss (val)", "val/box_loss", False),
    ("Train Pose Loss", "train/pose_loss", False),
]

# Distinct colors that are easy to tell apart
COLORS = {
    "pose_v1":           "#2196F3",  # blue
    "pose_v1_medium":    "#FF9800",  # orange
    "pose_v1_medium2":   "#FF5722",  # red
    "pose_v2_strict":    "#4CAF50",  # green — strict pseudo-labels
    "pose_v2_corrected": "#E040FB",  # magenta — hand-corrected medium model
    "pose_v2_gold":      "#FFD600",  # gold — hand-corrected, unfrozen backbone
    "overfit_test":      "#00E676",  # bright green — overfit sanity check
    "pose_v2_aug6x":     "#9E9E9E",  # grey
    "pose_v2_filtered":  "#9E9E9E",  # grey
    "pose_v2_pseudo":    "#9E9E9E",  # grey
    "pose_v2_unfreeze":  "#9E9E9E",  # grey
}
FALLBACK_COLORS = ["#4CAF50", "#9C27B0", "#00BCD4", "#E91E63", "#8BC34A"]


def draw_dashboard(frame, runs_dir: Path, fig, axes, show_only: set[str] | None, highlight: str | None):
    """Draw/update all subplots (called by FuncAnimation)."""
    run_dirs = sorted(
        [d for d in runs_dir.iterdir() if d.is_dir() and (d / "results.csv").exists()]
    )

    if not run_dirs:
        return

    # Filter to requested runs
    if show_only:
        run_dirs = [d for d in run_dirs if d.name in show_only]

    for ax in axes.flat:
        ax.clear()

    # Clear any previous figure legend
    for legend in fig.legends:
        legend.remove()

    fallback_idx = 0
    for run_dir in run_dirs:
        data = read_results(run_dir / "results.csv")
        if not data:
            continue
        epochs = data.get("epoch", [])
        name = run_dir.name

        color = COLORS.get(name)
        if not color:
            color = FALLBACK_COLORS[fallback_idx % len(FALLBACK_COLORS)]
            fallback_idx += 1

        is_highlighted = (highlight and name == highlight)
        linewidth = 3.0 if is_highlighted else 1.2
        alpha = 1.0 if is_highlighted else 0.5
        zorder = 10 if is_highlighted else 1
        marker_size = 8 if is_highlighted else 4

        for plot_idx, (title, col, higher_better) in enumerate(PLOTS):
            ax = axes.flat[plot_idx]
            values = data.get(col, [])
            if values and epochs:
                n = min(len(epochs), len(values))
                ax.plot(
                    epochs[:n], values[:n],
                    color=color, label=name,
                    linewidth=linewidth, alpha=alpha, zorder=zorder,
                )

                # Mark best value
                if higher_better:
                    best_idx = max(range(n), key=lambda i: values[i])
                else:
                    best_idx = min(range(n), key=lambda i: values[i])
                ax.plot(
                    epochs[best_idx], values[best_idx], "o",
                    color=color, markersize=marker_size, zorder=zorder + 1,
                )

                # Annotate best value for highlighted run
                if is_highlighted:
                    ax.annotate(
                        f"{values[best_idx]:.3f}",
                        (epochs[best_idx], values[best_idx]),
                        textcoords="offset points", xytext=(5, 8),
                        fontsize=8, fontweight="bold", color=color,
                        zorder=zorder + 2,
                    )

    for plot_idx, (title, col, higher_better) in enumerate(PLOTS):
        ax = axes.flat[plot_idx]
        ax.set_title(title, fontsize=11, fontweight="bold")
        ax.set_xlabel("Epoch", fontsize=9)
        ax.grid(True, alpha=0.3)
        ax.tick_params(labelsize=8)

    # Single legend at the bottom — deduplicate labels
    handles, labels = [], []
    seen = set()
    for ax in axes.flat:
        for h, l in zip(*ax.get_legend_handles_labels()):
            if l not in seen:
                seen.add(l)
                handles.append(h)
                labels.append(l)
    if handles:
        fig.legend(handles, labels, loc="lower center", ncol=min(len(handles), 4),
                   fontsize=9, frameon=True, fancybox=True)

    # Build status line with last update time and highlighted run's best metrics
    now = datetime.now().strftime("%H:%M:%S")
    status_parts = [f"Last update: {now}"]

    if highlight:
        hl_dir = runs_dir / highlight
        hl_csv = hl_dir / "results.csv"
        if hl_csv.exists():
            hl_data = read_results(hl_csv)
            hl_epochs = hl_data.get("epoch", [])
            if hl_epochs:
                status_parts.append(f"Epoch: {int(hl_epochs[-1])}/{300}")
            # Show best values for key metrics
            for title, col, higher_better in PLOTS:
                vals = hl_data.get(col, [])
                if vals:
                    best = max(vals) if higher_better else min(vals)
                    # Short label
                    short = title.replace(" (val)", "").replace("Train ", "T/")
                    status_parts.append(f"{short}: {best:.4f}")

    fig.suptitle(f"YOLO Pose Training Runs — {runs_dir.name}", fontsize=13, fontweight="bold", y=0.98)

    # Remove old status text if any
    for txt in getattr(fig, '_status_texts', []):
        txt.remove()
    fig._status_texts = []

    status_line = "   |   ".join(status_parts)
    t = fig.text(0.5, 0.95, status_line, ha="center", va="top", fontsize=9,
                 fontstyle="italic", color="#555555")
    fig._status_texts = [t]

    fig.tight_layout(rect=[0, 0.06, 1, 0.93])


def main() -> int:
    parser = argparse.ArgumentParser(description="Live YOLO training dashboard")
    parser.add_argument(
        "--runs-dir",
        default="/mnt/d/dataset_pipeline/runs/pose_v2",
        help="Directory containing run subdirectories",
    )
    parser.add_argument(
        "--refresh",
        type=int,
        default=30,
        help="Auto-refresh interval in seconds (0 for single snapshot)",
    )
    parser.add_argument(
        "--show",
        default=None,
        help="Comma-separated list of run names to show (default: all)",
    )
    parser.add_argument(
        "--highlight",
        default=None,
        help="Run name to highlight with thick line and annotations",
    )
    args = parser.parse_args()

    runs_dir = Path(args.runs_dir)
    if not runs_dir.exists():
        print(f"ERROR: runs directory not found: {runs_dir}", file=sys.stderr)
        return 1

    show_only = set(args.show.split(",")) if args.show else None
    highlight = args.highlight

    fig, axes = plt.subplots(2, 3, figsize=(14, 8))

    print(f"[dashboard] Watching {runs_dir}")
    if show_only:
        print(f"[dashboard] Showing: {', '.join(sorted(show_only))}")
    if highlight:
        print(f"[dashboard] Highlighting: {highlight}")
    print(f"[dashboard] Refresh every {args.refresh}s (close window to quit)")

    if args.refresh > 0:
        _anim = FuncAnimation(
            fig,
            draw_dashboard,
            fargs=(runs_dir, fig, axes, show_only, highlight),
            interval=args.refresh * 1000,
            cache_frame_data=False,
        )
        plt.show(block=True)
    else:
        draw_dashboard(0, runs_dir, fig, axes, show_only, highlight)
        plt.show(block=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
