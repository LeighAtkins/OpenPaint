import base64
import io
import logging
import os
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image


logger = logging.getLogger("mos-sam")

app = FastAPI(title="OpenPaint MOS SAM Service", version="0.1.0")

# ---- NN Model (lazy-loaded) ----
_nn_model = None
_nn_model_loaded = False
MOS_MODEL_PATH = os.environ.get("MOS_MODEL_PATH", "")

# V2 keypoint index mapping: role -> (start_kpt_idx, end_kpt_idx)
# 10 roles x 2 endpoints = 20 keypoints, ordered by SVG coverage frequency
NN_ROLE_KPT_INDICES = {
    "B1": (0, 1), "C1": (2, 3), "A1": (4, 5), "A2": (6, 7), "C3": (8, 9),
    "C4": (10, 11), "E1": (12, 13), "D": (14, 15), "B2": (16, 17), "A3": (18, 19),
}
NN_CONFIDENCE_THRESHOLD = 0.3
NN_MIN_ROLES_RATIO = 0.5  # fallback if fewer than half requested roles predicted


def _load_nn_model():
    """Lazy-load the YOLOv8-Pose model. Returns model or None."""
    global _nn_model, _nn_model_loaded
    if _nn_model_loaded:
        return _nn_model

    _nn_model_loaded = True
    model_path = MOS_MODEL_PATH
    if not model_path:
        logger.info("MOS_MODEL_PATH not set, NN inference disabled (heuristic only)")
        return None

    if not os.path.isfile(model_path):
        logger.warning(f"MOS_MODEL_PATH={model_path} not found, falling back to heuristic")
        return None

    try:
        from ultralytics import YOLO
        _nn_model = YOLO(model_path)
        logger.info(f"Loaded NN model from {model_path}")
    except Exception as e:
        logger.warning(f"Failed to load NN model: {e}, falling back to heuristic")
        _nn_model = None

    return _nn_model


def build_role_geometry_nn(
    image_rgb: np.ndarray,
    width: int,
    height: int,
    requested_roles: List[str],
    anchor_hints: Dict[str, List[Dict[str, float]]],
) -> Optional[Tuple[Dict[str, Dict[str, float]], Dict[str, List[Dict[str, float]]], Dict[str, List[Dict[str, float]]]]]:
    """Run NN keypoint prediction and convert to MOS roleLines format.

    Returns (roleLines, roleCurves, roleAnchors) or None if NN is unavailable
    or results are insufficient (triggers heuristic fallback).
    """
    model = _load_nn_model()
    if model is None:
        return None

    try:
        results = model.predict(image_rgb, imgsz=640, verbose=False)
    except Exception as e:
        logger.warning(f"NN inference failed: {e}")
        return None

    if not results or len(results) == 0:
        return None

    result = results[0]
    if result.keypoints is None or len(result.keypoints) == 0:
        return None

    # Take highest confidence detection
    kpts_data = result.keypoints.data  # (N, num_kpt, 3) pixel coords
    boxes = result.boxes
    if boxes is not None and len(boxes) > 0:
        best_idx = int(boxes.conf.argmax())
        det_conf = float(boxes.conf[best_idx])
    else:
        best_idx = 0
        det_conf = 0.5

    if det_conf < 0.2:
        logger.info(f"NN detection confidence too low ({det_conf:.2f}), fallback to heuristic")
        return None

    kpts_px = kpts_data[best_idx].cpu().numpy()  # (num_kpt, 3)

    normalized_requested = [normalize_role_token(r) for r in requested_roles]
    if not normalized_requested:
        normalized_requested = ["A1", "A2", "A3", "C1", "D"]

    role_lines: Dict[str, Dict[str, float]] = {}
    role_anchors: Dict[str, List[Dict[str, float]]] = {}
    role_curves: Dict[str, List[Dict[str, float]]] = {}

    for role in normalized_requested:
        indices = NN_ROLE_KPT_INDICES.get(role)
        if not indices:
            continue  # Role not in V1 keypoint set (e.g. A3, A4)
        i1, i2 = indices
        if i1 >= kpts_px.shape[0] or i2 >= kpts_px.shape[0]:
            continue

        conf1 = float(kpts_px[i1, 2])
        conf2 = float(kpts_px[i2, 2])

        if conf1 < NN_CONFIDENCE_THRESHOLD or conf2 < NN_CONFIDENCE_THRESHOLD:
            continue

        # Convert pixel coords to MOS 0-1000 space
        x1_mos = round(clamp((float(kpts_px[i1, 0]) / max(1, width)) * 1000.0, 0, 1000), 3)
        y1_mos = round(clamp((float(kpts_px[i1, 1]) / max(1, height)) * 1000.0, 0, 1000), 3)
        x2_mos = round(clamp((float(kpts_px[i2, 0]) / max(1, width)) * 1000.0, 0, 1000), 3)
        y2_mos = round(clamp((float(kpts_px[i2, 1]) / max(1, height)) * 1000.0, 0, 1000), 3)

        role_lines[role] = {"x1": x1_mos, "y1": y1_mos, "x2": x2_mos, "y2": y2_mos}
        role_anchors[role] = [
            {"x": x1_mos, "y": y1_mos},
            {"x": round((x1_mos + x2_mos) / 2.0, 3), "y": round((y1_mos + y2_mos) / 2.0, 3)},
            {"x": x2_mos, "y": y2_mos},
        ]

    # Apply anchor hints (override NN predictions with manual anchors)
    hints = anchor_hints or {}
    anchored_roles: set = set()
    for role_raw, points in hints.items():
        role = normalize_role_token(role_raw)
        if not role or not isinstance(points, list) or len(points) < 2:
            continue
        p1 = points[0] if isinstance(points[0], dict) else None
        p2 = points[-1] if isinstance(points[-1], dict) else None
        if not p1 or not p2:
            continue
        x1, y1 = point_px_from_norm(p1, width, height)
        x2, y2 = point_px_from_norm(p2, width, height)
        if abs(x2 - x1) < 1 and abs(y2 - y1) < 1:
            continue
        role_lines[role] = line_norm((x1, y1, x2, y2), width, height)
        anchored_roles.add(role)
        role_anchors[role] = [
            point_norm((x1, y1), width, height),
            point_norm(((x1 + x2) / 2.0, (y1 + y2) / 2.0), width, height),
            point_norm((x2, y2), width, height),
        ]
        role_curves.pop(role, None)

    if 0 < len(anchored_roles) < 3:
        role_lines = {k: v for k, v in role_lines.items() if k in anchored_roles}
        role_anchors = {k: v for k, v in role_anchors.items() if k in anchored_roles}
        role_curves = {k: v for k, v in role_curves.items() if k in anchored_roles}

    # Check coverage: if too few roles predicted, signal fallback
    nn_roles_requested = [r for r in normalized_requested if r in NN_ROLE_KPT_INDICES]
    if nn_roles_requested and len(role_lines) < len(nn_roles_requested) * NN_MIN_ROLES_RATIO:
        logger.info(
            f"NN predicted {len(role_lines)}/{len(nn_roles_requested)} roles, "
            f"below {NN_MIN_ROLES_RATIO:.0%} threshold, falling back to heuristic"
        )
        return None

    return role_lines, role_curves, role_anchors


class OverlayRequest(BaseModel):
    imageDataUrl: str
    imageWidth: int
    imageHeight: int
    requestedRoles: List[str] = []
    viewId: str = "front"
    anchorHints: Dict[str, List[Dict[str, float]]] = Field(default_factory=dict)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def normalize_role_token(value: str) -> str:
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum() or ch == "-")


def decode_data_url(data_url: str) -> np.ndarray:
    if not data_url or "," not in data_url:
        raise ValueError("Invalid imageDataUrl")
    encoded = data_url.split(",", 1)[1]
    raw = base64.b64decode(encoded)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    return np.array(image)


def find_primary_contour(image_rgb: np.ndarray) -> Tuple[np.ndarray, Tuple[int, int, int, int], float]:
    height, width = image_rgb.shape[:2]
    cx = width / 2.0
    cy = height / 2.0

    def score(contour: np.ndarray) -> float:
        x, y, w, h = cv2.boundingRect(contour)
        area = float(cv2.contourArea(contour))
        if area <= 0:
            return -1e9
        center_x = x + w / 2.0
        center_y = y + h / 2.0
        dist = abs(center_x - cx) + abs(center_y - cy)
        touches_border = x <= 2 or y <= 2 or (x + w) >= (width - 2) or (y + h) >= (height - 2)
        border_penalty = area * 0.35 if touches_border else 0.0
        oversized_penalty = area * 0.2 if (w > width * 0.95 or h > height * 0.95) else 0.0
        return area - (dist * 150.0) - border_penalty - oversized_penalty

    # Try foreground segmentation first; this is much less noisy than global Canny edges.
    try:
        image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
        mask = np.zeros((height, width), np.uint8)
        bgd_model = np.zeros((1, 65), np.float64)
        fgd_model = np.zeros((1, 65), np.float64)
        margin_x = max(8, int(width * 0.08))
        margin_y = max(8, int(height * 0.08))
        rect = (margin_x, margin_y, max(1, width - margin_x * 2), max(1, height - margin_y * 2))
        cv2.grabCut(image_bgr, mask, rect, bgd_model, fgd_model, 3, cv2.GC_INIT_WITH_RECT)
        fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype("uint8")
        kernel = np.ones((5, 5), np.uint8)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            best = max(contours, key=score)
            x, y, w, h = cv2.boundingRect(best)
            area_ratio = float(cv2.contourArea(best)) / float(max(1, width * height))
            if 0.05 <= area_ratio <= 0.92:
                return best, (x, y, x + w, y + h), area_ratio
    except Exception:
        pass

    # Fallback to Canny contour extraction.
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 40, 130)
    kernel = np.ones((5, 5), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=2)
    edges = cv2.erode(edges, kernel, iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        best = max(contours, key=score)
        x, y, w, h = cv2.boundingRect(best)
        area_ratio = float(cv2.contourArea(best)) / float(max(1, width * height))
        return best, (x, y, x + w, y + h), area_ratio

    fallback = np.array([[[0, 0]], [[width - 1, 0]], [[width - 1, height - 1]], [[0, height - 1]]])
    return fallback, (0, 0, width - 1, height - 1), 1.0


def span_at_y(contour: np.ndarray, y_value: int, fallback: Tuple[int, int], tolerance: int = 6) -> Tuple[int, int]:
    pts = contour.reshape(-1, 2)
    candidates = pts[np.abs(pts[:, 1] - y_value) <= tolerance]
    if candidates.shape[0] < 2:
        return fallback
    return int(candidates[:, 0].min()), int(candidates[:, 0].max())


def line_norm(line_px: Tuple[float, float, float, float], width: int, height: int) -> Dict[str, float]:
    x1, y1, x2, y2 = line_px
    return {
        "x1": round(clamp((x1 / max(1, width)) * 1000.0, 0, 1000), 3),
        "y1": round(clamp((y1 / max(1, height)) * 1000.0, 0, 1000), 3),
        "x2": round(clamp((x2 / max(1, width)) * 1000.0, 0, 1000), 3),
        "y2": round(clamp((y2 / max(1, height)) * 1000.0, 0, 1000), 3),
    }


def point_norm(point_px: Tuple[float, float], width: int, height: int) -> Dict[str, float]:
    x, y = point_px
    return {
        "x": round(clamp((x / max(1, width)) * 1000.0, 0, 1000), 3),
        "y": round(clamp((y / max(1, height)) * 1000.0, 0, 1000), 3),
    }


def point_px_from_norm(point_norm_in: Dict[str, float], width: int, height: int) -> Tuple[float, float]:
    x = float(point_norm_in.get("x", 0.0))
    y = float(point_norm_in.get("y", 0.0))
    px = clamp((x / 1000.0) * width, 0.0, float(width))
    py = clamp((y / 1000.0) * height, 0.0, float(height))
    return px, py


def sample_side_profile(
    contour: np.ndarray,
    y_start: int,
    y_end: int,
    side: str,
    x_fallback: int,
    samples: int = 8,
    tolerance: int = 8,
) -> List[Tuple[float, float]]:
    pts = contour.reshape(-1, 2)
    if samples < 2:
        samples = 2
    ys = np.linspace(y_start, y_end, samples)
    out: List[Tuple[float, float]] = []

    for yv in ys:
        y_int = int(round(float(yv)))
        candidates = pts[np.abs(pts[:, 1] - y_int) <= tolerance]
        if candidates.shape[0] == 0:
            x_val = x_fallback
        elif side == "left":
            x_val = int(candidates[:, 0].min())
        else:
            x_val = int(candidates[:, 0].max())
        out.append((float(x_val), float(y_int)))

    return out


def smooth_profile(
    points: List[Tuple[float, float]],
    max_dx: float,
    max_dy: float,
    passes: int = 2,
) -> List[Tuple[float, float]]:
    if len(points) < 3:
        return points

    smoothed = list(points)
    for _ in range(max(1, passes)):
        next_points: List[Tuple[float, float]] = [smoothed[0]]
        for i in range(1, len(smoothed) - 1):
            x = (smoothed[i - 1][0] + smoothed[i][0] + smoothed[i + 1][0]) / 3.0
            y = (smoothed[i - 1][1] + smoothed[i][1] + smoothed[i + 1][1]) / 3.0
            next_points.append((x, y))
        next_points.append(smoothed[-1])
        smoothed = next_points

    clamped: List[Tuple[float, float]] = [smoothed[0]]
    for i in range(1, len(smoothed)):
        px, py = clamped[-1]
        x, y = smoothed[i]
        dx = x - px
        dy = y - py
        if abs(dx) > max_dx:
            x = px + (max_dx if dx > 0 else -max_dx)
        if abs(dy) > max_dy:
            y = py + (max_dy if dy > 0 else -max_dy)
        clamped.append((x, y))
    return clamped


def sample_profile_by_x(
    contour: np.ndarray,
    x_start: int,
    x_end: int,
    boundary: str,
    y_fallback: int,
    samples: int = 12,
    tolerance: int = 8,
) -> List[Tuple[float, float]]:
    pts = contour.reshape(-1, 2)
    if samples < 2:
        samples = 2
    xs = np.linspace(x_start, x_end, samples)
    out: List[Tuple[float, float]] = []

    for xv in xs:
        x_int = int(round(float(xv)))
        candidates = pts[np.abs(pts[:, 0] - x_int) <= tolerance]
        if candidates.shape[0] == 0:
            y_val = y_fallback
        elif boundary == "bottom":
            y_val = int(candidates[:, 1].max())
        else:
            y_val = int(candidates[:, 1].min())
        out.append((float(x_int), float(y_val)))

    return out


def classify_arm_profile(
    right_profile_full: List[Tuple[float, float]],
    width_span: float,
) -> str:
    """Classify arm side profile shape using contour curvature.

    Returns:
      - "roll": visibly rounded side contour
      - "square": mostly straight side contour
    """
    if len(right_profile_full) < 4:
        return "square"

    x0, y0 = right_profile_full[0]
    x1, y1 = right_profile_full[-1]
    dy = y1 - y0
    if abs(dy) < 1e-3:
        return "square"

    # Compare measured x(y) against a straight-line profile.
    outward_deltas: List[float] = []
    for x, y in right_profile_full:
        t = (y - y0) / dy
        x_linear = x0 + (x1 - x0) * t
        outward_deltas.append(x - x_linear)

    max_outward = float(max(outward_deltas))
    curvature_threshold = max(8.0, width_span * 0.035)
    return "roll" if max_outward >= curvature_threshold else "square"


def build_role_geometry(
    contour: np.ndarray,
    bbox: Tuple[int, int, int, int],
    width: int,
    height: int,
    requested_roles: List[str],
    anchor_hints: Dict[str, List[Dict[str, float]]],
) -> Tuple[Dict[str, Dict[str, float]], Dict[str, List[Dict[str, float]]], Dict[str, List[Dict[str, float]]]]:
    x_min, y_min, x_max, y_max = bbox
    w = max(1.0, float(x_max - x_min))
    h = max(1.0, float(y_max - y_min))

    y_top = int(y_min + h * 0.12)
    y_upper = int(y_min + h * 0.28)
    y_mid = int(y_min + h * 0.48)
    y_seat = int(y_min + h * 0.60)
    y_bottom = int(y_min + h * 0.90)

    top_l, top_r = span_at_y(contour, y_top, (x_min, x_max))
    upper_l, upper_r = span_at_y(contour, y_upper, (x_min, x_max))
    mid_l, mid_r = span_at_y(contour, y_mid, (x_min, x_max))
    seat_l, seat_r = span_at_y(contour, y_seat, (x_min, x_max))
    bot_l, bot_r = span_at_y(contour, y_bottom, (x_min, x_max))

    cx = (x_min + x_max) / 2.0
    right_band_x = x_min + (w * 0.82)
    inner_right_x = x_min + (w * 0.70)
    left_band_x = x_min + (w * 0.18)

    primitives_px = {
        "A1": (top_l, y_top, top_r, y_top),
        "A2": (seat_l, y_seat, seat_r, y_seat),
        "A3": (cx, y_top, cx, y_seat),
        "A4": (upper_l + (upper_r - upper_l) * 0.12, y_mid, upper_r - (upper_r - upper_l) * 0.12, y_mid),
        "B1": (seat_r - w * 0.06, y_seat - h * 0.02, x_max - w * 0.18, y_mid),
        "B2": (top_r - w * 0.08, y_top + h * 0.02, x_max - w * 0.02, y_upper),
        "C1": (x_max - w * 0.20, y_mid, x_max, y_mid),
        "C2": (x_max - w * 0.16, y_seat, x_max, y_seat),
        "C3": (right_band_x, y_upper, right_band_x, y_bottom),
        "C4": (inner_right_x, y_seat + h * 0.02, inner_right_x, y_bottom),
        "D": (bot_l, y_bottom, bot_r, y_bottom),
        "E1": (left_band_x, y_upper, left_band_x, y_seat),
        "E2": (left_band_x, y_seat, left_band_x, y_bottom),
        "W": (bot_l, y_bottom, bot_r, y_bottom),
        "H": (cx, y_top, cx, y_bottom),
    }

    role_lines: Dict[str, Dict[str, float]] = {}
    role_curves: Dict[str, List[Dict[str, float]]] = {}
    role_anchors: Dict[str, List[Dict[str, float]]] = {}
    normalized_roles = [normalize_role_token(role) for role in requested_roles]

    if not normalized_roles:
        normalized_roles = ["A1", "A2", "A3", "C1", "D"]

    for role in normalized_roles:
        primitive = primitives_px.get(role)
        if not primitive:
            continue
        role_lines[role] = line_norm(primitive, width, height)

        x1, y1, x2, y2 = primitive
        mid_x = (x1 + x2) / 2.0
        mid_y = (y1 + y2) / 2.0
        role_anchors[role] = [
            point_norm((x1, y1), width, height),
            point_norm((mid_x, mid_y), width, height),
            point_norm((x2, y2), width, height),
        ]

    # Curved/contour guides derived from detected silhouette profile.
    left_profile = sample_side_profile(contour, y_upper, y_seat, "left", int(left_band_x), samples=7)
    right_profile_full = sample_side_profile(
        contour, y_upper, y_bottom, "right", int(right_band_x), samples=8
    )
    right_profile_lower = sample_side_profile(
        contour, y_seat, y_bottom, "right", int(inner_right_x), samples=6
    )
    top_x_start = int(x_min + w * 0.12)
    top_x_end = int(x_max - w * 0.12)
    bottom_x_start = int(x_min + w * 0.08)
    bottom_x_end = int(x_max - w * 0.08)
    if top_x_start >= top_x_end:
        top_x_start, top_x_end = top_l, top_r
    if bottom_x_start >= bottom_x_end:
        bottom_x_start, bottom_x_end = bot_l, bot_r
    top_profile = sample_profile_by_x(
        contour, top_x_start, top_x_end, "top", y_top, samples=9, tolerance=max(6, int(w * 0.01))
    )
    bottom_profile = sample_profile_by_x(
        contour,
        bottom_x_start,
        bottom_x_end,
        "bottom",
        y_bottom,
        samples=9,
        tolerance=max(6, int(w * 0.01)),
    )

    left_profile = smooth_profile(left_profile, max_dx=w * 0.06, max_dy=h * 0.22)
    right_profile_full = smooth_profile(right_profile_full, max_dx=w * 0.06, max_dy=h * 0.18)
    right_profile_lower = smooth_profile(right_profile_lower, max_dx=w * 0.05, max_dy=h * 0.2)
    top_profile = smooth_profile(top_profile, max_dx=w * 0.22, max_dy=h * 0.05)
    bottom_profile = smooth_profile(bottom_profile, max_dx=w * 0.22, max_dy=h * 0.05)

    arm_profile_kind = classify_arm_profile(right_profile_full, w)

    # Override key line roles with contour-derived endpoints for better photo alignment.
    if "A1" in role_lines and len(top_profile) >= 2:
        y1 = top_profile[0][1]
        y2 = top_profile[-1][1]
        if abs(y2 - y1) > h * 0.06:
            y_flat = (y1 + y2) / 2.0
            y1 = y_flat
            y2 = y_flat
        role_lines["A1"] = line_norm((top_profile[0][0], y1, top_profile[-1][0], y2), width, height)
    if "D" in role_lines and len(bottom_profile) >= 2:
        y1 = bottom_profile[0][1]
        y2 = bottom_profile[-1][1]
        if abs(y2 - y1) > h * 0.06:
            y_flat = (y1 + y2) / 2.0
            y1 = y_flat
            y2 = y_flat
        role_lines["D"] = line_norm((bottom_profile[0][0], y1, bottom_profile[-1][0], y2), width, height)
    if "E1" in role_lines and len(right_profile_full) >= 2:
        # E1 tracks arm height on side view and should stay coupled to arm contour.
        e1_top = right_profile_full[0]
        e1_mid = right_profile_full[min(3, len(right_profile_full) - 1)]
        x1 = e1_top[0]
        x2 = e1_mid[0]
        y1 = e1_top[1]
        y2 = e1_mid[1]
        if arm_profile_kind == "square" and abs(x2 - x1) > w * 0.05:
            x_flat = (x1 + x2) / 2.0
            x1 = x_flat
            x2 = x_flat
        role_lines["E1"] = line_norm((x1, y1, x2, y2), width, height)

    if "E2" in role_lines and len(right_profile_full) >= 4:
        # E2 captures lower arm curve continuation for rolled arms.
        e2_start = right_profile_full[min(3, len(right_profile_full) - 1)]
        e2_end = right_profile_full[-1]
        x1, y1 = e2_start
        x2, y2 = e2_end
        if arm_profile_kind == "square" and abs(x2 - x1) > w * 0.05:
            x_flat = (x1 + x2) / 2.0
            x1 = x_flat
            x2 = x_flat
        role_lines["E2"] = line_norm((x1, y1, x2, y2), width, height)
    if "C3" in role_lines and len(right_profile_full) >= 2:
        x1 = right_profile_full[0][0]
        x2 = right_profile_full[-1][0]
        if abs(x2 - x1) > w * 0.07:
            x_flat = (x1 + x2) / 2.0
            x1 = x_flat
            x2 = x_flat
        role_lines["C3"] = line_norm(
            (x1, right_profile_full[0][1], x2, right_profile_full[-1][1]),
            width,
            height,
        )
    if "C4" in role_lines and len(right_profile_lower) >= 2:
        x_vals = [p[0] for p in right_profile_lower]
        x_center = sum(x_vals) / len(x_vals)
        role_lines["C4"] = line_norm(
            (x_center, right_profile_lower[0][1], x_center, right_profile_lower[-1][1]),
            width,
            height,
        )

    if "B1" in role_lines and len(right_profile_lower) >= 3:
        b1_start_x = seat_r - (w * 0.04)
        b1_start_y = y_seat - (h * 0.01)
        b1_end_x, b1_end_y = right_profile_lower[min(2, len(right_profile_lower) - 1)]
        if (b1_end_x - b1_start_x) < (w * 0.06):
            b1_end_x = b1_start_x + (w * 0.14)
        if (b1_end_y - b1_start_y) < (h * 0.08):
            b1_end_y = b1_start_y + (h * 0.14)
        # Keep B1 in the upper-lower arm transition, not too close to floor.
        b1_end_y = min(b1_end_y, y_seat + (h * 0.28))
        b1_end_x = clamp(b1_end_x, x_min, x_max)
        b1_end_y = clamp(b1_end_y, y_min, y_max)
        role_lines["B1"] = line_norm((b1_start_x, b1_start_y, b1_end_x, b1_end_y), width, height)

    if "B2" in role_lines and len(right_profile_full) >= 3:
        b2_start_x = top_r - (w * 0.04)
        b2_start_y = y_top + (h * 0.02)
        b2_end_x, b2_end_y = right_profile_full[min(2, len(right_profile_full) - 1)]
        if (b2_end_x - b2_start_x) < (w * 0.05):
            b2_end_x = b2_start_x + (w * 0.12)
        if (b2_end_y - b2_start_y) < (h * 0.06):
            b2_end_y = b2_start_y + (h * 0.11)
        # Keep B2 in upper-arm region; avoid dropping into lower side profile.
        b2_end_y = min(b2_end_y, y_top + (h * 0.18))
        b2_end_x = clamp(b2_end_x, x_min, x_max)
        b2_end_y = clamp(b2_end_y, y_min, y_max)
        role_lines["B2"] = line_norm((b2_start_x, b2_start_y, b2_end_x, b2_end_y), width, height)

    # Use contour-driven right-arm spans for C1/C2 so these stay on the arm,
    # not the scene boundary.
    if "C1" in role_lines:
        c_candidates: List[float] = [float(mid_r), float(seat_r)]
        if len(right_profile_full) >= 3:
            c_candidates.extend([p[0] for p in right_profile_full[:3]])
        c_outer = float(np.median(np.array(c_candidates, dtype=np.float64)))
        c_outer = min(c_outer, x_max - (w * 0.04))
        c_inner = c_outer - (w * 0.14)
        c_inner = clamp(c_inner, x_min, c_outer - 1)
        c1_y = y_mid
        role_lines["C1"] = line_norm((c_inner, c1_y, c_outer, c1_y), width, height)

    if "C2" in role_lines:
        c_candidates: List[float] = [float(mid_r), float(seat_r)]
        if len(right_profile_lower) >= 2:
            c_candidates.extend([p[0] for p in right_profile_lower[:2]])
        c_outer = float(np.median(np.array(c_candidates, dtype=np.float64)))
        c_outer = min(c_outer, x_max - (w * 0.04))
        c_inner = c_outer - (w * 0.11)
        c_inner = clamp(c_inner, x_min, c_outer - 1)
        c2_y = y_seat
        role_lines["C2"] = line_norm((c_inner, c2_y, c_outer, c2_y), width, height)

    # Rebuild anchors from final line geometry.
    role_anchors = {}
    for role, ln in role_lines.items():
        role_anchors[role] = [
            {"x": ln["x1"], "y": ln["y1"]},
            {"x": round((ln["x1"] + ln["x2"]) / 2.0, 3), "y": round((ln["y1"] + ln["y2"]) / 2.0, 3)},
            {"x": ln["x2"], "y": ln["y2"]},
        ]

    if "E1" in role_lines:
        if arm_profile_kind == "roll":
            role_curves["E1"] = [
                point_norm(p, width, height) for p in right_profile_full[: max(4, len(right_profile_full) // 2)]
            ]
        else:
            role_curves.pop("E1", None)
    if "E2" in role_lines:
        if arm_profile_kind == "roll":
            role_curves["E2"] = [
                point_norm(p, width, height)
                for p in right_profile_full[max(2, len(right_profile_full) // 2 - 1) :]
            ]
        else:
            role_curves.pop("E2", None)
    if "C3" in role_lines:
        role_curves["C3"] = [point_norm(p, width, height) for p in right_profile_full]
    # Keep C4 visual clean (line-only) to reduce right-side scribble.
    # A1 and D are intentionally kept as clean line-only roles for readability.

    # Diagonal helpers for B roles; keeps model geometry explicit.
    if "B1" in role_lines:
        b1 = role_lines["B1"]
        role_curves["B1"] = [
            {"x": b1["x1"], "y": b1["y1"]},
            {
                "x": round((b1["x1"] + b1["x2"]) / 2.0 + 6, 3),
                "y": round((b1["y1"] + b1["y2"]) / 2.0 - 24, 3),
            },
            {"x": b1["x2"], "y": b1["y2"]},
        ]
    if "B2" in role_lines:
        b2 = role_lines["B2"]
        role_curves["B2"] = [
            {"x": b2["x1"], "y": b2["y1"]},
            {
                "x": round((b2["x1"] + b2["x2"]) / 2.0 + 8, 3),
                "y": round((b2["y1"] + b2["y2"]) / 2.0 - 18, 3),
            },
            {"x": b2["x2"], "y": b2["y2"]},
        ]

    # Manual anchor hints override role endpoints (anchor-first mode).
    hints = anchor_hints or {}
    anchored_roles: set[str] = set()
    for role_raw, points in hints.items():
        role = normalize_role_token(role_raw)
        if not role or not isinstance(points, list) or len(points) < 2:
            continue
        p1 = points[0] if isinstance(points[0], dict) else None
        p2 = points[-1] if isinstance(points[-1], dict) else None
        if not p1 or not p2:
            continue

        x1, y1 = point_px_from_norm(p1, width, height)
        x2, y2 = point_px_from_norm(p2, width, height)
        if abs(x2 - x1) < 1 and abs(y2 - y1) < 1:
            continue

        role_lines[role] = line_norm((x1, y1, x2, y2), width, height)
        anchored_roles.add(role)
        role_anchors[role] = [
            point_norm((x1, y1), width, height),
            point_norm(((x1 + x2) / 2.0, (y1 + y2) / 2.0), width, height),
            point_norm((x2, y2), width, height),
        ]
        role_curves.pop(role, None)

    # Accuracy-first behavior: if only a few manual anchors are provided,
    # return just those anchored roles instead of noisy unconstrained guesses.
    if 0 < len(anchored_roles) < 3:
        role_lines = {k: v for k, v in role_lines.items() if k in anchored_roles}
        role_anchors = {k: v for k, v in role_anchors.items() if k in anchored_roles}
        role_curves = {k: v for k, v in role_curves.items() if k in anchored_roles}

    return role_lines, role_curves, role_anchors


@app.get("/health")
def health() -> Dict[str, object]:
    return {"ok": True, "service": "mos-sam", "version": "0.1.0"}


@app.post("/v1/generate-overlay")
def generate_overlay(payload: OverlayRequest) -> Dict[str, object]:
    try:
        image = decode_data_url(payload.imageDataUrl)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid imageDataUrl: {exc}")

    h, w = image.shape[:2]
    inference_method = "heuristic"

    # Try NN inference first
    nn_result = build_role_geometry_nn(
        image, w, h, payload.requestedRoles, payload.anchorHints or {}
    )

    if nn_result is not None:
        role_lines, role_curves, role_anchors = nn_result
        inference_method = "nn"
        # Still need contour for debug info
        contour, bbox, area_ratio = find_primary_contour(image)
    else:
        # Fallback to heuristic
        contour, bbox, area_ratio = find_primary_contour(image)
        role_lines, role_curves, role_anchors = build_role_geometry(
            contour, bbox, w, h, payload.requestedRoles, payload.anchorHints or {}
        )

    requested = [normalize_role_token(role) for role in payload.requestedRoles]
    applied = list(role_lines.keys())
    anchored_roles = [
        normalize_role_token(role)
        for role, points in (payload.anchorHints or {}).items()
        if isinstance(points, list) and len(points) >= 2
    ]
    anchored_roles = [r for r in anchored_roles if r]
    x_min, y_min, x_max, y_max = bbox
    arm_debug_profile = classify_arm_profile(
        sample_side_profile(
            contour,
            int(y_min + (y_max - y_min) * 0.28),
            y_max,
            "right",
            x_max,
            samples=8,
        ),
        float(max(1, x_max - x_min)),
    )

    return {
        "success": len(applied) > 0,
        "roleLines": role_lines,
        "roleCurves": role_curves,
        "roleAnchors": role_anchors,
        "debug": {
            "requestedRoles": requested,
            "appliedRoles": applied,
            "bbox": {
                "x1": bbox[0],
                "y1": bbox[1],
                "x2": bbox[2],
                "y2": bbox[3],
            },
            "contourAreaRatio": round(area_ratio, 4),
            "imageSize": {"width": w, "height": h},
            "anchoredRoles": anchored_roles,
            "anchorMode": "anchors-only" if 0 < len(anchored_roles) < 3 else "hybrid",
            "inferenceMethod": inference_method,
            "armProfileKind": arm_debug_profile,
        },
    }
