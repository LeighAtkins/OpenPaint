#!/usr/bin/env bash
set -euo pipefail

DEFAULT_LABELS_DIR="/mnt/d/dataset_pipeline/yolo_pose_v2_pseudo_strict/labels/train"
DEFAULT_DOWNLOADS_DIR="/mnt/c/Users/Memory is RAM/Downloads"
SCRIPT_PATH="/home/leigh/projects/OpenPaint/scripts/apply_corrections.py"

labels_dir="$DEFAULT_LABELS_DIR"
downloads_dir="$DEFAULT_DOWNLOADS_DIR"
corrections_path=""
write_mode=0

usage() {
  cat <<'EOF'
Usage:
  scripts/apply_strict_corrections.sh [--run] [--corrections PATH] [--labels-dir PATH] [--downloads-dir PATH]

Options:
  --run                Write changes (default is dry-run)
  --corrections PATH   Path to merged_labels.json (or merged_labels (*.json))
  --labels-dir PATH    YOLO label directory (default strict labels dir)
  --downloads-dir PATH Downloads folder to auto-find latest merged_labels*.json
  -h, --help           Show this help

Examples:
  scripts/apply_strict_corrections.sh
  scripts/apply_strict_corrections.sh --run
  scripts/apply_strict_corrections.sh --corrections "/mnt/c/Users/Memory is RAM/Downloads/merged_labels (3).json" --run
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)
      write_mode=1
      shift
      ;;
    --corrections)
      corrections_path="${2:-}"
      if [[ -z "$corrections_path" ]]; then
        echo "Error: --corrections requires a path"
        exit 1
      fi
      shift 2
      ;;
    --labels-dir)
      labels_dir="${2:-}"
      if [[ -z "$labels_dir" ]]; then
        echo "Error: --labels-dir requires a path"
        exit 1
      fi
      shift 2
      ;;
    --downloads-dir)
      downloads_dir="${2:-}"
      if [[ -z "$downloads_dir" ]]; then
        echo "Error: --downloads-dir requires a path"
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "Error: apply script not found: $SCRIPT_PATH"
  exit 1
fi

if [[ ! -d "$labels_dir" ]]; then
  echo "Error: labels dir not found: $labels_dir"
  exit 1
fi

if [[ -z "$corrections_path" ]]; then
  latest_match=""
  shopt -s nullglob
  candidates=("$downloads_dir"/merged_labels*.json)
  shopt -u nullglob
  if [[ ${#candidates[@]} -eq 0 ]]; then
    echo "Error: no merged_labels*.json found in $downloads_dir"
    exit 1
  fi
  latest_match=$(ls -1t "${candidates[@]}" | head -n 1)
  corrections_path="$latest_match"
fi

if [[ ! -f "$corrections_path" ]]; then
  echo "Error: corrections file not found: $corrections_path"
  exit 1
fi

python_bin="python"
if ! command -v "$python_bin" >/dev/null 2>&1; then
  python_bin="python3"
fi

if [[ $write_mode -eq 1 ]]; then
  echo "Applying corrections"
  "$python_bin" "$SCRIPT_PATH" \
    --labels-dir "$labels_dir" \
    --corrections "$corrections_path"
else
  echo "Dry run (add --run to write files)"
  "$python_bin" "$SCRIPT_PATH" \
    --labels-dir "$labels_dir" \
    --corrections "$corrections_path" \
    --dry-run
fi
