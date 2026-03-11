#!/usr/bin/env python3
"""Train YOLOv8-Pose for furniture measurement keypoints.

Configuration tuned for:
- 685 images (143 corrected val + 542 train), 20 keypoints, single class
- RTX 4070 (12GB VRAM)
- Supports yolov8s-pose.pt (small) and yolov8m-pose.pt (medium)

Expected training time: ~2-3 hours (small), ~6-8 hours (medium, 300 epochs).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from ultralytics import YOLO
except ImportError:
    print("ERROR: ultralytics not installed. Run: pip install ultralytics", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Train YOLOv8-Pose furniture keypoints")
    parser.add_argument(
        "--data",
        default="/mnt/d/dataset_pipeline/yolo_pose_v1/dataset.yaml",
        help="Path to dataset.yaml",
    )
    parser.add_argument(
        "--model",
        default="yolov8s-pose.pt",
        help="Base model (will be downloaded if not present)",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=150,
        help="Training epochs",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Input image size",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=8,
        help="Batch size (8 fits 12GB VRAM with 20 keypoints)",
    )
    parser.add_argument(
        "--project",
        default="/mnt/d/dataset_pipeline/runs",
        help="Project directory for runs",
    )
    parser.add_argument(
        "--name",
        default="pose_v1",
        help="Run name",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from last checkpoint",
    )
    parser.add_argument(
        "--freeze",
        type=int,
        default=10,
        help="Number of backbone layers to freeze for transfer learning",
    )
    parser.add_argument(
        "--patience",
        type=int,
        default=40,
        help="Early stopping patience (0 to disable)",
    )
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        print(f"ERROR: dataset.yaml not found: {data_path}", file=sys.stderr)
        print("Run prepare_dataset.py first.", file=sys.stderr)
        return 1

    print(f"[train] Loading base model: {args.model}")
    model = YOLO(args.model)

    print(f"[train] Starting training:")
    print(f"  data:    {args.data}")
    print(f"  epochs:  {args.epochs}")
    print(f"  imgsz:   {args.imgsz}")
    print(f"  batch:   {args.batch}")
    print(f"  freeze:  {args.freeze}")
    print(f"  project: {args.project}/{args.name}")

    results = model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
        exist_ok=True,
        # Transfer learning: freeze backbone
        freeze=args.freeze,
        # Optimizer
        optimizer="AdamW",
        lr0=0.001,
        lrf=0.01,
        warmup_epochs=5,
        # Early stopping
        patience=args.patience,
        # Augmentation: conservative for furniture keypoints
        fliplr=0.0,       # No horizontal flip — symmetry mapping not verified
        mosaic=0.5,        # Reduced mosaic to preserve keypoint context
        degrees=5.0,       # Small rotation — furniture is usually upright
        translate=0.1,
        scale=0.3,
        shear=2.0,
        perspective=0.0001,
        hsv_h=0.015,
        hsv_s=0.4,
        hsv_v=0.3,
        # Loss weights
        pose=12.0,         # Emphasize keypoint regression
        box=7.5,
        cls=0.5,
        # Device
        device=0,          # GPU 0 (RTX 4070)
        # Workers
        workers=4,
        # Save
        save=True,
        save_period=25,    # Checkpoint every 25 epochs
        # Misc
        verbose=True,
        resume=args.resume,
    )

    # Save training config for reproducibility
    config = {
        "data": str(data_path),
        "base_model": args.model,
        "epochs": args.epochs,
        "imgsz": args.imgsz,
        "batch": args.batch,
        "freeze": args.freeze,
        "optimizer": "AdamW",
        "lr0": 0.001,
        "lrf": 0.01,
        "warmup_epochs": 5,
        "patience": args.patience,
        "augmentation": {
            "fliplr": 0.0,
            "mosaic": 0.5,
            "degrees": 5.0,
            "translate": 0.1,
            "scale": 0.3,
        },
        "loss_weights": {
            "pose": 12.0,
            "box": 7.5,
            "cls": 0.5,
        },
    }

    config_path = Path(args.project) / args.name / "train_config.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    print(f"\n[train] Training complete.")
    print(f"  Best weights: {args.project}/{args.name}/weights/best.pt")
    print(f"  Config saved: {config_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
