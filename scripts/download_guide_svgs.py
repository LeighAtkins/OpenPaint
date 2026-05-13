#!/usr/bin/env python3
"""Download all measurement guide SVGs from the Cloudflare Worker.

Fetches the code list, then downloads front/back/side SVGs for each code.
Saves to a local directory for use in the annotation matching tool.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests


def main() -> int:
    parser = argparse.ArgumentParser(description="Download guide SVGs from R2 via Worker")
    parser.add_argument(
        "--output",
        default="/mnt/d/dataset_pipeline/guide_svgs",
        help="Output directory for SVGs",
    )
    parser.add_argument(
        "--worker-url",
        default=os.environ.get(
            "MEASUREMENT_GUIDE_WORKER_URL",
            "https://sofapaint-api.sofapaint-api.workers.dev",
        ),
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get(
            "MEASUREMENT_GUIDE_WORKER_API_KEY",
            "8xUxyWJDc3JYbInXAwSbfxTUix0uxR68vtdXLqihAK2aK9J3HwgEUBhyJcY5oOGk",
        ),
    )
    args = parser.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    base_url = args.worker_url.rstrip("/")

    # 1. Fetch code list
    print("[download] Fetching guide code list...")
    resp = requests.get(
        f"{base_url}/measurement-guides/codes",
        headers={"x-api-key": args.api_key, "Accept": "application/json"},
    )
    resp.raise_for_status()
    data = resp.json()

    codes = data.get("codes", [])
    views_by_code = data.get("viewsByCode", {})
    print(f"[download] Found {len(codes)} codes")

    # 2. Download SVGs for each code+view
    total = 0
    skipped = 0
    failed = 0
    manifest = {}

    for code in codes:
        views = views_by_code.get(code, ["front"])
        manifest[code] = {"views": views, "files": {}}

        for view in views:
            filename = f"{view}_{code}.svg"
            out_path = out_dir / filename

            if out_path.exists() and out_path.stat().st_size > 100:
                manifest[code]["files"][view] = filename
                skipped += 1
                continue

            svg_url = f"{base_url}/measurement-guides/svg?code={code}&view={view}"
            try:
                svg_resp = requests.get(
                    svg_url,
                    headers={
                        "x-api-key": args.api_key,
                        "Accept": "image/svg+xml,application/json",
                    },
                    timeout=15,
                )
                if not svg_resp.ok:
                    failed += 1
                    continue

                svg_data = svg_resp.content
                if len(svg_data) < 50:
                    failed += 1
                    continue

                out_path.write_bytes(svg_data)
                manifest[code]["files"][view] = filename
                total += 1
            except Exception as e:
                print(f"  WARN: {code}/{view}: {e}")
                failed += 1

            time.sleep(0.05)

        if (total + skipped) % 20 == 0 and (total + skipped) > 0:
            print(f"[download] {total} downloaded, {skipped} cached, {failed} failed")

    # Save manifest
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"\n[download] Done: {total} new, {skipped} cached, {failed} failed")
    print(f"[download] SVGs: {out_dir}")
    print(f"[download] Manifest: {manifest_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
