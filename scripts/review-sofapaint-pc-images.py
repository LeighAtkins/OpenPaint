"""Review a private customer-image manifest with the already running PC model."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import html
import importlib.util
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--token-file', type=Path, required=True)
parser.add_argument('--source-cache', type=Path)
parser.add_argument('--refresh-html', action='store_true')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=args.refresh_html)
rows = json.loads(args.input.read_text(encoding='utf-8-sig'))
token = args.token_file.read_text().strip()
expected_sha = 'd8b3be861b6abcf0d9656d77432aa23b22b2d3f8f4037061fa41d7ef95658dc1'
endpoint = 'http://127.0.0.1:8091'
spec = importlib.util.spec_from_file_location('mask_preview', Path(__file__).with_name('sofa-mask-pilot.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
completed, cards = [], []
state = {'status': 'running', 'cases': len(rows), 'modelSha256': expected_sha,
         'inferenceRoute': 'existing-local-RTX-service', 'photos': completed}


def save():
    temporary = args.output / 'results.tmp'
    temporary.write_text(json.dumps(state, indent=2))
    temporary.replace(args.output / 'results.json')
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SofaPaint supplied customer photos</title><style>body{margin:0;background:#f3f5f6;color:#19262a;font:15px system-ui}header{background:white;border-bottom:1px solid #c9d4da;padding:16px 20px}h1{font-size:22px;margin:0}main{max-width:1600px;margin:auto;padding:16px}section{padding:12px 0 22px;border-bottom:1px solid #c9d4da}h2{font-size:17px;margin:0 0 6px}.meta{margin:0 0 10px;color:#46555b;overflow-wrap:anywhere;line-height:1.4}.views{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}img{display:block;width:100%;height:420px;object-fit:contain;background:white}figcaption{padding:8px 0;font-weight:600}@media(max-width:750px){main{padding:10px}.views{grid-template-columns:1fr}img{height:auto;max-height:76vh}}</style></head><body><header><h1>SofaPaint supplied customer photos</h1></header><main>'''
    (args.output / 'review.html').write_text(page + ''.join(cards) + '</main></body></html>', encoding='utf-8')


def photo_card(job, result):
    title = html.escape(result['id'])
    group = html.escape(job['group'].replace('_', ' '))
    note = html.escape(job.get('visual_note', '').replace('_', ' '))
    return f'<section><h2>{title}</h2><p class="meta">{group} | {result["instances"]} regions | {note}</p><div class="views">' + ''.join(
        f'<figure><img loading="lazy" src="{title}/{filename}" alt="{title} {caption}"><figcaption>{caption}</figcaption></figure>'
        for filename, caption in [('original.jpg', 'Original photo'), ('parts.jpg', 'Model part regions'), ('boundaries.png', 'Part boundaries')]) + '</div></section>'


if args.refresh_html:
    state = json.loads((args.output / 'results.json').read_text())
    completed = state['photos']
    by_case = {row['case_id']: row for row in rows}
    cards = [photo_card(by_case[result['caseId']], result) for result in completed]
    save()
    raise SystemExit(0)


def download(job):
    url = urllib.parse.urlsplit(job['url'])
    if url.scheme != 'https' or url.hostname != 's3-us-west-1.amazonaws.com':
        raise ValueError(f"{job['id']}: unexpected image source")
    cached = args.source_cache / job['id'] / 'source.bin' if args.source_cache else None
    if cached and cached.exists():
        raw = cached.read_bytes()
    else:
        with urllib.request.urlopen(job['url'], timeout=60) as response:
            raw = response.read(20 * 1024 * 1024 + 1)
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError(f"{job['id']}: source exceeds 20 MB")
    folder = args.output / job['id']
    folder.mkdir()
    (folder / 'source.bin').write_bytes(raw)
    return raw


def post(route, raw):
    request = urllib.request.Request(endpoint + route, data=raw,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/octet-stream'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


try:
    with urllib.request.urlopen(endpoint + '/health', timeout=5) as response:
        health = json.load(response)
    if health['modelSha256'] != expected_sha:
        raise ValueError('Incorrect production checkpoint')
    jobs = []
    for row in rows:
        if not row['case_id'].startswith('S') or not row['case_id'][1:].isdigit():
            raise ValueError('Invalid case identifier')
        for view in ('front', 'side'):
            if row.get(view + '_url'):
                jobs.append(dict(row, id=row['case_id'] + '-' + view, view=view, url=row[view + '_url']))
    state['requestedPhotos'] = len(jobs)
    save()
    with ThreadPoolExecutor(max_workers=4) as pool:
        downloads = [pool.submit(download, job) for job in jobs]
        for job, future in zip(jobs, downloads):
            started = time.monotonic()
            try:
                raw = future.result()
            except Exception as error:
                raise RuntimeError(job['id'] + ': image download failed') from error
            normalized = post('/normalize', raw)
            evidence = json.loads(post('/segment', normalized))
            if evidence['model']['sha256'] != expected_sha or evidence['image']['sha256'] != hashlib.sha256(normalized).hexdigest():
                raise ValueError(job['id'] + ': model or photo hash mismatch')
            image = cv2.imdecode(np.frombuffer(normalized, np.uint8), cv2.IMREAD_COLOR)
            if image is None or image.shape[:2] != (evidence['image']['height'], evidence['image']['width']):
                raise ValueError(job['id'] + ': image coordinate mismatch')
            folder = args.output / job['id']
            (folder / 'evidence.json').write_text(json.dumps(evidence))
            for instance in evidence['instances']:
                counts = instance['bitmap']['counts']
                if sum(counts) != image.shape[0] * image.shape[1] or sum(counts[1::2]) != instance['areaPixels']:
                    raise ValueError(job['id'] + ': invalid bitmap area')
            module.preview(image, evidence, folder)
            for filename in ('original.jpg', 'parts.jpg', 'boundaries.png'):
                bitmap = cv2.imread(str(folder / filename))
                scale = min(1, 1400 / max(bitmap.shape[:2]))
                if scale < 1:
                    bitmap = cv2.resize(bitmap, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
                    if not cv2.imwrite(str(folder / filename), bitmap):
                        raise ValueError('Cannot write display preview')
            result = {'id': job['id'], 'caseId': job['case_id'], 'view': job['view'],
                      'group': job['group'], 'instances': len(evidence['instances']),
                      'sourceSha256': hashlib.sha256(raw).hexdigest(),
                      'normalizedSha256': evidence['image']['sha256'],
                      'seconds': round(time.monotonic() - started, 3)}
            completed.append(result)
            cards.append(photo_card(job, result))
            save()
            print(json.dumps({key: result[key] for key in ('id', 'group', 'instances', 'seconds')}), flush=True)
    state['status'] = 'completed'
    save()
except Exception as error:
    state['status'] = 'failed'
    state['error'] = type(error).__name__ + ': ' + str(error).replace(token, '[redacted]')
    save()
    raise
