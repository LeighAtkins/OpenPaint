#!/usr/bin/env python3
"""Generate YOLO-Pose V2 labels from hand-crafted SVG measurement guides.

For each matched photo+SVG pair:
1. Load matches JSON, skip __NONE__ entries
2. Parse SVG viewBox for coordinate normalization
3. Find <g> elements with id matching m{ROLE}{units} pattern
4. Extract line endpoints from <line> and <polyline> children
5. Normalize to [0, 1] space via viewBox dimensions
6. Map role tokens to V2 keypoint indices
7. Compute bbox from convex hull of all measurement endpoints
8. Write YOLO-Pose format .txt labels

Output format per line:
  0 cx cy w h x0 y0 v0 x1 y1 v1 ... x19 y19 v19  (65 tokens)
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# V2 role order: 10 roles x 2 endpoints = 20 keypoints
V2_ROLES = ["B1", "C1", "A1", "A2", "C3", "C4", "E1", "D", "B2", "A3"]
V2_ROLE_KPT_INDICES: Dict[str, Tuple[int, int]] = {
    role: (i * 2, i * 2 + 1) for i, role in enumerate(V2_ROLES)
}
NUM_KEYPOINTS = 20

# Regex to parse measurement group IDs: m{ROLE}{UNIT}
MEAS_GROUP_RE = re.compile(r"^m(.+?)(cm|in|mm)$", re.IGNORECASE)


def normalize_role_token(value: str) -> str:
    """Uppercase, strip non-alphanumeric (matches mos-sam/app.py)."""
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum() or ch == "-")


def parse_viewbox(svg_root: ET.Element) -> Tuple[float, float, float, float]:
    """Extract viewBox as (min_x, min_y, width, height)."""
    vb = svg_root.get("viewBox", "")
    if not vb:
        raise ValueError("SVG has no viewBox attribute")
    parts = vb.replace(",", " ").split()
    if len(parts) != 4:
        raise ValueError(f"Invalid viewBox: {vb}")
    return float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])


def parse_polyline_points(points_str: str) -> List[Tuple[float, float]]:
    """Parse SVG polyline points attribute into coordinate pairs."""
    # Points can be "x1,y1 x2,y2 ..." or "x1 y1 x2 y2 ..."
    # Clean up whitespace and split
    cleaned = points_str.strip().replace(",", " ")
    tokens = cleaned.split()
    coords = []
    for i in range(0, len(tokens) - 1, 2):
        try:
            coords.append((float(tokens[i]), float(tokens[i + 1])))
        except (ValueError, IndexError):
            continue
    return coords


def extract_endpoints_from_group(group: ET.Element) -> Optional[Tuple[float, float, float, float]]:
    """Extract measurement line endpoints (x1, y1, x2, y2) from a <g> element.

    Searches direct children and one level of nested <g> for <line> and <polyline>.
    Skips <polygon> (arrowheads) and <text> elements.
    """
    lines: List[Tuple[float, float, float, float]] = []
    polylines: List[List[Tuple[float, float]]] = []

    def scan_element(el: ET.Element) -> None:
        for child in el:
            tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
            if tag == "line":
                try:
                    x1 = float(child.get("x1", "0"))
                    y1 = float(child.get("y1", "0"))
                    x2 = float(child.get("x2", "0"))
                    y2 = float(child.get("y2", "0"))
                    lines.append((x1, y1, x2, y2))
                except (ValueError, TypeError):
                    pass
            elif tag == "polyline":
                pts_str = child.get("points", "")
                if pts_str:
                    pts = parse_polyline_points(pts_str)
                    if len(pts) >= 2:
                        polylines.append(pts)
            elif tag == "g":
                # One level of nesting (common in these SVGs)
                scan_element(child)

    scan_element(group)

    # Prefer line elements (direct endpoints), fall back to polyline first+last
    if lines:
        # Use the first line found (measurement groups typically have one)
        return lines[0]
    elif polylines:
        # Use first + last point of the first polyline
        pts = polylines[0]
        return (pts[0][0], pts[0][1], pts[-1][0], pts[-1][1])

    return None


def process_svg(
    svg_path: Path,
    vb_min_x: float,
    vb_min_y: float,
    vb_w: float,
    vb_h: float,
) -> Dict[str, Tuple[float, float, float, float]]:
    """Parse SVG and return {role: (x1_norm, y1_norm, x2_norm, y2_norm)} in [0,1] space."""
    tree = ET.parse(svg_path)
    root = tree.getroot()

    # Handle namespace
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    roles: Dict[str, Tuple[float, float, float, float]] = {}

    for g in root.iter(f"{ns}g"):
        gid = g.get("id", "")
        m = MEAS_GROUP_RE.match(gid)
        if not m:
            continue

        role_raw = m.group(1)
        role = normalize_role_token(role_raw)
        if not role:
            continue

        endpoints = extract_endpoints_from_group(g)
        if endpoints is None:
            continue

        x1, y1, x2, y2 = endpoints

        # Normalize to [0, 1] using viewBox
        x1_n = (x1 - vb_min_x) / vb_w
        y1_n = (y1 - vb_min_y) / vb_h
        x2_n = (x2 - vb_min_x) / vb_w
        y2_n = (y2 - vb_min_y) / vb_h

        # Clamp to [0, 1]
        x1_n = max(0.0, min(1.0, x1_n))
        y1_n = max(0.0, min(1.0, y1_n))
        x2_n = max(0.0, min(1.0, x2_n))
        y2_n = max(0.0, min(1.0, y2_n))

        roles[role] = (x1_n, y1_n, x2_n, y2_n)

    return roles


def compute_bbox(points: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
    """Compute bounding box (cx, cy, w, h) in [0,1] space from a list of points."""
    if not points:
        return (0.5, 0.5, 1.0, 1.0)

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]

    x_min = min(xs)
    x_max = max(xs)
    y_min = min(ys)
    y_max = max(ys)

    # Add padding (5% of span, min 2% of image)
    pad_x = max(0.02, (x_max - x_min) * 0.05)
    pad_y = max(0.02, (y_max - y_min) * 0.05)

    x_min = max(0.0, x_min - pad_x)
    x_max = min(1.0, x_max + pad_x)
    y_min = max(0.0, y_min - pad_y)
    y_max = min(1.0, y_max + pad_y)

    cx = (x_min + x_max) / 2.0
    cy = (y_min + y_max) / 2.0
    w = x_max - x_min
    h = y_max - y_min

    return (cx, cy, w, h)


def format_label_line(
    bbox: Tuple[float, float, float, float],
    keypoints: List[Tuple[float, float, int]],
) -> str:
    """Format a YOLO-Pose label line: class cx cy w h kpt0_x kpt0_y kpt0_v ..."""
    parts = ["0"]  # class_id = 0 (furniture)
    parts.extend(f"{v:.6f}" for v in bbox)
    for x, y, vis in keypoints:
        parts.append(f"{x:.6f}")
        parts.append(f"{y:.6f}")
        parts.append(str(vis))
    return " ".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate YOLO-Pose V2 labels from SVG measurement guides"
    )
    parser.add_argument(
        "--matches",
        default="/mnt/d/dataset_pipeline/photo_guide_matches.json",
        help="Photo-to-SVG matching JSON",
    )
    parser.add_argument(
        "--svg-dir",
        default="/mnt/d/dataset_pipeline/guide_svgs",
        help="Directory containing guide SVGs",
    )
    parser.add_argument(
        "--output",
        default="/mnt/d/dataset_pipeline/yolo_pose_v2/labels_svg",
        help="Output directory for YOLO-Pose labels",
    )
    args = parser.parse_args()

    matches_path = Path(args.matches)
    svg_dir = Path(args.svg_dir)
    output_dir = Path(args.output)

    if not matches_path.exists():
        print(f"ERROR: matches file not found: {matches_path}", file=sys.stderr)
        return 1
    if not svg_dir.exists():
        print(f"ERROR: SVG directory not found: {svg_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    # Load matches
    import json

    data = json.loads(matches_path.read_text(encoding="utf-8"))
    matches = data.get("matches", {})

    # Filter to real matches (not __NONE__)
    real_matches = {
        k: v for k, v in matches.items()
        if v.get("code", "") not in ("__NONE__", "")
    }

    print(f"[labels_from_svgs] {len(real_matches)} matched images to process")
    print(f"[labels_from_svgs] V2 roles: {V2_ROLES}")

    total_written = 0
    total_skipped = 0
    missing_svgs = 0
    role_coverage = Counter()
    roles_per_image: List[int] = []

    for photo_name, match_info in sorted(real_matches.items()):
        code = match_info["code"]
        view = match_info["view"]
        svg_name = f"{view}_{code}.svg"
        svg_path = svg_dir / svg_name

        if not svg_path.exists():
            print(f"  WARN: SVG not found: {svg_name} (for {photo_name})")
            missing_svgs += 1
            total_skipped += 1
            continue

        # Parse viewBox
        try:
            tree = ET.parse(svg_path)
            root = tree.getroot()
            vb_min_x, vb_min_y, vb_w, vb_h = parse_viewbox(root)
        except Exception as e:
            print(f"  WARN: Failed to parse {svg_name}: {e}")
            total_skipped += 1
            continue

        # Extract roles from SVG
        svg_roles = process_svg(svg_path, vb_min_x, vb_min_y, vb_w, vb_h)

        # Map to V2 keypoints
        keypoints: List[Tuple[float, float, int]] = [(0.0, 0.0, 0)] * NUM_KEYPOINTS
        all_points: List[Tuple[float, float]] = []
        mapped_count = 0

        for role, (x1, y1, x2, y2) in svg_roles.items():
            if role not in V2_ROLE_KPT_INDICES:
                continue

            idx_start, idx_end = V2_ROLE_KPT_INDICES[role]
            keypoints[idx_start] = (x1, y1, 2)  # 2 = visible
            keypoints[idx_end] = (x2, y2, 2)
            all_points.extend([(x1, y1), (x2, y2)])
            role_coverage[role] += 1
            mapped_count += 1

        if mapped_count == 0:
            total_skipped += 1
            continue

        roles_per_image.append(mapped_count)

        # Compute bbox from all measurement endpoints
        bbox = compute_bbox(all_points)

        # Write label
        label_line = format_label_line(bbox, keypoints)
        label_path = output_dir / f"{photo_name}.txt"
        label_path.write_text(label_line + "\n", encoding="utf-8")
        total_written += 1

    # Summary
    print(f"\n[labels_from_svgs] === Summary ===")
    print(f"  Labels written: {total_written}")
    print(f"  Skipped: {total_skipped}")
    print(f"  Missing SVGs: {missing_svgs}")
    if roles_per_image:
        avg_roles = sum(roles_per_image) / len(roles_per_image)
        print(f"  Avg roles/image: {avg_roles:.1f}")
    print(f"\n  V2 Role coverage ({total_written} images):")
    for role in V2_ROLES:
        count = role_coverage.get(role, 0)
        pct = (count / max(1, total_written)) * 100
        print(f"    {role:4s}: {count:4d} ({pct:5.1f}%)")

    # Write summary JSON
    summary = {
        "total_written": total_written,
        "total_skipped": total_skipped,
        "missing_svgs": missing_svgs,
        "v2_roles": V2_ROLES,
        "role_coverage": {role: role_coverage.get(role, 0) for role in V2_ROLES},
    }
    summary_path = output_dir.parent / "labels_svg_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n  Summary JSON: {summary_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
