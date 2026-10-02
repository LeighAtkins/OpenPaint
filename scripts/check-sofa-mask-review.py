"""Visual QA of the generated static mask preview, with existing Playwright."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('folder', type=Path)
args = parser.parse_args()
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, width, height in [('desktop', 1440, 920), ('mobile', 390, 844)]:
        page = browser.new_page(viewport={'width': width, 'height': height})
        page.goto((args.folder / 'review.html').as_uri())
        page.wait_for_function('Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)')
        check = page.evaluate('''() => ({images: document.images.length,
            broken: Array.from(document.images).filter(i => !i.naturalWidth).length,
            overflow: document.documentElement.scrollWidth > innerWidth,
            figures: document.querySelectorAll('figure').length})''')
        if check['broken'] or check['overflow'] or check['images'] != 24:
            raise ValueError(f'{name}: invalid preview layout: {check}')
        page.screenshot(path=str(args.folder / f'{name}.png'), full_page=False)
        results.append(dict(viewport=name, **check))
        page.close()
    browser.close()
(args.folder / 'visual-check.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results))
