"""Launch the private PC service once and save eight real-photo mask previews."""
import argparse
import base64
import hashlib
import html
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.request

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = Path('/mnt/c/dataset_pipeline_seg')
MODEL = DATA / 'runs/yolo11s-seg_merged_back_base/weights/best.pt'
IDS = ['al1_r2_0251', 'al1_r2_0786', 'al1_r2_0810', 'al1_r2_0817',
       'al2_r2_0334', 'al3_r2_0700', 'al3_r2_0821', 'gold_img_000706']


def preview(image, evidence, folder):
    colors = [(255, 38, 79), (80, 255, 0), (0, 140, 255), (255, 230, 0), (255, 0, 237)]
    labels = ['Left arm', 'Right arm', 'Seat cushion', 'Merged body', 'Sofa back']
    h, w = image.shape[:2]
    overlay = image.copy()
    lines = np.full_like(image, 255)
    for item in evidence['instances']:
        flat = np.zeros(h * w, bool)
        offset = 0
        for i, count in enumerate(item['bitmap']['counts']):
            if i % 2:
                flat[offset:offset + count] = True
            offset += count
        if offset != h * w:
            raise ValueError('Invalid bitmap size in pilot response')
        mask = flat.reshape(h, w)
        bgr = tuple(reversed(colors[item['classId']]))
        overlay[mask] = (.55 * overlay[mask] + .45 * np.array(bgr)).astype(np.uint8)
        contours = [np.array([[round(x * w), round(y * h)] for x, y in r['points']], np.int32)
                    for r in item['rings']]
        cv2.polylines(overlay, contours, True, bgr, max(1, w // 650))
        cv2.polylines(lines, contours, True, (35, 35, 35), max(1, w // 900))
        x, y, _, _ = item['bbox']
        text = f"#{item['id'].replace('mask_', '')} {labels[item['classId']]} {item['confidence']:.0%}"
        scale = max(.45, w / 2400)
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
        origin = (max(0, min(round(x * w), w - tw - 2)), min(h - 5, max(th + 4, round(y * h))))
        cv2.putText(overlay, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 4)
        cv2.putText(overlay, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 1)
    for name, bitmap in [('original.jpg', image), ('parts.jpg', overlay), ('boundaries.png', lines)]:
        if not cv2.imwrite(str(folder / name), bitmap):
            raise ValueError('Cannot save pilot preview')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8091)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', args.port))
    with MODEL.open('rb') as stream:
        before = hashlib.file_digest(stream, 'sha256').hexdigest()
    token = secrets.token_hex(32)
    secret = args.output / 'api-token.secret'
    secret.write_text(token)
    secret.chmod(0o600)
    environment = os.environ.copy()
    environment.update(SOFA_MASK_API_TOKEN=token, YOLO_AUTOINSTALL='false')
    with (args.output / 'service.log').open('x') as log:
        child = subprocess.Popen([sys.executable, '-u', str(ROOT / 'services/sofa-mask/service.py'),
            '--model', str(MODEL), '--port', str(args.port)], env=environment,
            stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    success = False
    try:
        endpoint = f'http://127.0.0.1:{args.port}'
        deadline = time.monotonic() + 60
        while True:
            if child.poll() is not None:
                raise RuntimeError('Service startup failed; inspect service.log')
            try:
                with urllib.request.urlopen(endpoint + '/health', timeout=1) as response:
                    health = json.load(response)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise TimeoutError('Service startup deadline exceeded')
                time.sleep(.25)
        if health['modelSha256'] != before:
            raise ValueError('Service is using the wrong checkpoint')
        manifest = json.loads((DATA / 'real_bitmap_v2/manifest.json').read_text())
        by_id = {r['id']: r for r in manifest['images']}
        rows, cards = [], []
        for sid in IDS:
            entry = by_id[sid]
            if entry['split'] != 'dev':
                raise ValueError(f'{sid} is not a frozen development photo')
            raw = Path(entry['image']).read_bytes()
            normalize = urllib.request.Request(endpoint + '/normalize', data=raw,
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/octet-stream'})
            with urllib.request.urlopen(normalize, timeout=20) as response:
                raw = response.read()
            request = urllib.request.Request(endpoint + '/segment', data=raw,
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/octet-stream'})
            started = time.monotonic()
            with urllib.request.urlopen(request, timeout=60) as response:
                evidence = json.load(response)
            if evidence['image']['sha256'] != hashlib.sha256(raw).hexdigest():
                raise ValueError('Wrong photo in inference response')
            folder = args.output / sid
            folder.mkdir()
            (folder / 'evidence.json').write_text(json.dumps(evidence, indent=1))
            original = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            preview(original, evidence, folder)
            row = {'id': sid, 'instances': len(evidence['instances']), 'seconds': time.monotonic() - started}
            rows.append(row)
            print(json.dumps(row), flush=True)
            cards.append(f'<section><h2>{html.escape(sid)}</h2><div class="views">' +
                ''.join(f'<figure><img src="{sid}/{file}" alt="{title}"><figcaption>{title}</figcaption></figure>'
                for file, title in [('original.jpg', 'Original photo'), ('parts.jpg', 'Model part regions'),
                                    ('boundaries.png', 'Part boundary draft')]) + '</div></section>')
        page = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SofaPaint mask pilot</title><style>body{margin:0;background:#f2f4f5;color:#182328;font:15px system-ui}header{padding:18px 24px;background:white;border-bottom:1px solid #ccd5da}h1{font-size:22px;margin:0}main{max-width:1600px;margin:auto;padding:20px}section{border-bottom:1px solid #ccd5da;padding:12px 0 24px}h2{font-size:16px}.views{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}img{display:block;width:100%;height:360px;object-fit:contain;background:white}figcaption{padding:8px 0;font-weight:600}@media(max-width:750px){main{padding:12px}.views{grid-template-columns:1fr}img{height:auto;max-height:74vh}}</style></head><body><header><h1>SofaPaint · reviewed masking pilot</h1></header><main>' + ''.join(cards) + '</main></body></html>'
        (args.output / 'review.html').write_text(page, encoding='utf-8')
        with MODEL.open('rb') as stream:
            unchanged = hashlib.file_digest(stream, 'sha256').hexdigest() == before
        if not unchanged:
            raise ValueError('Production checkpoint changed')
        result = {'status': 'ready', 'pid': child.pid, 'endpoint': endpoint,
                  'modelSha256': before, 'productionUnchanged': unchanged, 'photos': rows,
                  'review': str(args.output / 'review.html'), 'tokenFile': str(secret),
                  'hostedConnectionReady': False}
        (args.output / 'pilot.json').write_text(json.dumps(result, indent=2))
        print(json.dumps({k: v for k, v in result.items() if k != 'tokenFile'}), flush=True)
        success = True
    finally:
        if not success and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


if __name__ == '__main__':
    main()
