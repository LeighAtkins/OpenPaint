#!/usr/bin/env python3
"""Train a binary arm/no-arm image classifier with Ultralytics YOLO."""

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
    parser = argparse.ArgumentParser(description="Train arm/no-arm classifier")
    parser.add_argument(
        "--data",
        default="/mnt/d/dataset_pipeline/yolo_arm_binary/images",
        help="Classification dataset root containing train/val(/test) folders",
    )
    parser.add_argument(
        "--model",
        default="yolov8n-cls.pt",
        help="Base classification model",
    )
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--imgsz", type=int, default=224, help="Input size")
    parser.add_argument("--batch", type=int, default=64, help="Batch size")
    parser.add_argument(
        "--project",
        default="/mnt/d/dataset_pipeline/runs/arm_cls",
        help="Project directory for runs",
    )
    parser.add_argument("--name", default="arm_vs_no_arm_v1", help="Run name")
    parser.add_argument("--patience", type=int, default=15, help="Early stopping patience")
    parser.add_argument("--device", default="0", help="Training device, e.g. 0 or cpu")
    args = parser.parse_args()

    data_path = Path(args.data)
    if not (data_path / "train").exists() or not (data_path / "val").exists():
        print(f"ERROR: dataset folders missing under: {data_path}", file=sys.stderr)
        print("Expected: train/ and val/ with class subfolders", file=sys.stderr)
        return 1

    print(f"[train-arm] Loading model: {args.model}")
    model = YOLO(args.model)

    print("[train-arm] Starting training")
    print(f"  data:    {data_path}")
    print(f"  epochs:  {args.epochs}")
    print(f"  imgsz:   {args.imgsz}")
    print(f"  batch:   {args.batch}")
    print(f"  project: {args.project}/{args.name}")

    model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
        exist_ok=True,
        patience=args.patience,
        optimizer="AdamW",
        lr0=0.001,
        lrf=0.01,
        fliplr=0.5,
        device=args.device,
        workers=4,
        save=True,
        verbose=True,
    )

    run_dir = Path(args.project) / args.name
    config = {
        "data": str(data_path),
        "base_model": args.model,
        "epochs": args.epochs,
        "imgsz": args.imgsz,
        "batch": args.batch,
        "optimizer": "AdamW",
        "lr0": 0.001,
        "lrf": 0.01,
        "patience": args.patience,
        "device": args.device,
    }
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "train_config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")

    best_weights = run_dir / "weights" / "best.pt"
    print("\n[train-arm] Training complete")
    print(f"  best weights: {best_weights}")
    print(f"  config:       {run_dir / 'train_config.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
