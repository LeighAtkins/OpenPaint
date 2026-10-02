"""Private inference bridge for the reviewed SofaPaint segmentation checkpoint."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import math
import os
from pathlib import Path
import secrets
import threading

import cv2
import numpy as np
from PIL import Image, ImageOps

MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 12_000_000
MAX_SOURCE_PIXELS = 80_000_000
Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS
NAMES = ['physical_left_arm', 'physical_right_arm', 'seat_cushions', 'back_and_base', 'sofa_back']
PRODUCTION_SHA = 'd8b3be861b6abcf0d9656d77432aa23b22b2d3f8f4037061fa41d7ef95658dc1'


def decode_image(raw):
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError('Expected an image no larger than 20 MB.')
    with Image.open(io.BytesIO(raw)) as photo:
        if photo.format not in ('PNG', 'JPEG', 'WEBP') or photo.width * photo.height > MAX_PIXELS:
            raise ValueError('Expected JPEG, PNG or WebP, up to 12 megapixels.')
        if photo.getexif().get(274, 1) != 1:
            raise ValueError('Normalize photo rotation before masking so drawing and mask coordinates agree.')
        return np.asarray(photo.convert('RGB')).copy()


def normalize_photo(raw):
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError('Expected an image no larger than 20 MB.')
    with Image.open(io.BytesIO(raw)) as photo:
        if photo.format not in ('PNG', 'JPEG', 'WEBP') or photo.width * photo.height > MAX_SOURCE_PIXELS:
            raise ValueError('Expected JPEG, PNG or WebP, up to 80 megapixels for normalization.')
        mime = {'PNG': 'image/png', 'JPEG': 'image/jpeg', 'WEBP': 'image/webp'}[photo.format]
        if photo.getexif().get(274, 1) == 1 and photo.width * photo.height <= MAX_PIXELS:
            photo.load()
            return raw, mime
        upright = ImageOps.exif_transpose(photo).convert('RGB')
        if upright.width * upright.height > MAX_PIXELS:
            ratio = math.sqrt(MAX_PIXELS / (upright.width * upright.height))
            upright = upright.resize((max(1, int(upright.width * ratio)), max(1, int(upright.height * ratio))), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        if mime == 'image/jpeg':
            upright.save(output, format='JPEG', quality=95, subsampling=0)
        else:
            upright.save(output, format='PNG')
            mime = 'image/png'
        result = output.getvalue()
        if len(result) > MAX_BYTES:
            raise ValueError('Normalized original photo exceeds 20 MB.')
        return result, mime


def encode_rle(mask):
    """Lossless row-major runs, beginning with the background run."""
    flat = mask.reshape(-1).astype(np.uint8)
    changes = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    counts = np.diff(np.r_[0, changes, len(flat)]).tolist()
    if flat[0]:
        counts.insert(0, 0)
    return {'order': 'row-major', 'counts': counts}


def mask_geometry(mask):
    h, w = mask.shape
    contours, tree = cv2.findContours(mask.astype(np.uint8), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    rings = []
    for index, contour in enumerate(contours):
        points = cv2.approxPolyDP(contour, .5, True).reshape(-1, 2)
        if len(points) < 3:
            continue
        depth, parent = 0, int(tree[0, index, 3])
        while parent >= 0:
            depth += 1
            parent = int(tree[0, parent, 3])
        rings.append({'hole': bool(depth % 2), 'points': [[float(x) / w, float(y) / h] for x, y in points]})
    if sum(len(r['points']) for r in rings) > 20_000:
        raise ValueError('Mask contour exceeds preview complexity limit.')
    ys, xs = np.nonzero(mask)
    bbox = [float(xs.min()) / w, float(ys.min()) / h,
            float(xs.max() + 1 - xs.min()) / w, float(ys.max() + 1 - ys.min()) / h]
    return rings, bbox


class Segmenter:
    def __init__(self, model_path, expected_sha=PRODUCTION_SHA, device='0'):
        from ultralytics import YOLO
        with Path(model_path).open('rb') as checkpoint:
            self.sha = hashlib.file_digest(checkpoint, 'sha256').hexdigest()
        if self.sha != expected_sha:
            raise ValueError('Checkpoint hash differs from the configured reviewed model.')
        self.model = YOLO(str(model_path))
        if self.model.task != 'segment' or [self.model.names[k] for k in sorted(self.model.names)] != NAMES:
            raise ValueError('Checkpoint class schema is incompatible with this bridge.')
        self.device = device

    def analyze(self, raw):
        rgb = decode_image(raw)
        h, w = rgb.shape[:2]
        result = self.model.predict(source=rgb[:, :, ::-1].copy(), imgsz=1024, conf=.25,
                                    retina_masks=True, max_det=100, device=self.device,
                                    verbose=False, save=False)[0]
        instances = []
        if result.masks is not None:
            masks = result.masks.data.cpu().numpy()
            if masks.shape[1:] != (h, w) or len(masks) != len(result.boxes):
                raise ValueError('Model output does not match original photo coordinates.')
            classes, scores = result.boxes.cls.cpu().tolist(), result.boxes.conf.cpu().tolist()
            for index, (bitmap, cid, confidence) in enumerate(zip(masks, classes, scores)):
                mask = bitmap > .5
                if not mask.any():
                    continue
                rings, bbox = mask_geometry(mask)
                instances.append({'id': f'mask_{index + 1}', 'classId': int(cid), 'label': NAMES[int(cid)],
                                  'confidence': float(confidence), 'areaPixels': int(mask.sum()),
                                  'bbox': bbox, 'rings': rings, 'bitmap': encode_rle(mask)})
        return {'schema': 'sofapaint-masks-v1', 'coordinateSystem': 'normalized-full-photo',
                'image': {'width': w, 'height': h, 'sha256': hashlib.sha256(raw).hexdigest()},
                'model': {'id': 'yolo11s-seg_merged_back_base', 'sha256': self.sha, 'classes': NAMES},
                'instances': instances, 'warnings': [
                    'Model proposals require visual checking against the original photo.',
                    'back_and_base is a merged class; infer visible construction from the photo.',
                    'seat_cushions does not establish coverage of every detached or throw cushion.',
                    'Part outlines do not establish internal upholstery seams or dimension values.']}


def make_handler(segmenter, token):
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, data):
            body = json.dumps(data, allow_nan=False, separators=(',', ':')).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != '/health':
                return self.reply(404, {'error': 'Unknown endpoint.'})
            self.reply(200, {'status': 'ready', 'schema': 'sofapaint-masks-v1', 'modelSha256': segmenter.sha})

        def do_POST(self):
            self.connection.settimeout(30)
            if self.path not in ('/segment', '/normalize'):
                return self.reply(404, {'error': 'Unknown endpoint.'})
            if not secrets.compare_digest(self.headers.get('Authorization', ''), f'Bearer {token}'):
                return self.reply(401, {'error': 'Unauthorized.'})
            if not lock.acquire(blocking=False):
                return self.reply(503, {'error': 'Masking is busy. Try again when the current request finishes.'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= MAX_BYTES:
                    return self.reply(413, {'error': 'Invalid or oversized image.'})
                raw = self.rfile.read(size)
                if len(raw) != size:
                    raise ValueError('Incomplete image upload.')
                if self.path == '/normalize':
                    body, mime = normalize_photo(raw)
                    self.send_response(200)
                    self.send_header('Content-Type', mime)
                    self.send_header('Content-Length', str(len(body)))
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.reply(200, segmenter.analyze(raw))
            except (ValueError, OSError) as exc:
                self.reply(400, {'error': str(exc)})
            except Exception:
                self.reply(500, {'error': 'Mask inference failed.'})
            finally:
                lock.release()

        def log_message(self, fmt, *args):
            # Never log authorization headers, photo bytes or request bodies.
            print(fmt % args, flush=True)

    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--model-sha256', default=PRODUCTION_SHA)
    parser.add_argument('--device', default='0')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8091)
    args = parser.parse_args()
    token = os.environ.get('SOFA_MASK_API_TOKEN', '')
    if len(token) < 32:
        raise SystemExit('Set SOFA_MASK_API_TOKEN to a private random secret of at least 32 characters.')
    model = Segmenter(args.model, args.model_sha256, args.device)
    print(f'Masking ready on {args.host}:{args.port}; checkpoint {model.sha}', flush=True)
    ThreadingHTTPServer((args.host, args.port), make_handler(model, token)).serve_forever()
