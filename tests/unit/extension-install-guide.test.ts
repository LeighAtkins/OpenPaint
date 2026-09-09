import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());

describe('Gorgias extension install guide', () => {
  it('exposes the guide from the Project menu with a downloadable package', async () => {
    const html = await readFile(resolve(root, 'index.html'), 'utf8');

    expect(html).toContain('id="gorgiasExtensionGuideBtn"');
    expect(html).toContain('id="gorgiasExtensionDialog"');
    expect(html).toContain('href="/downloads/gorgias-sofapaint-extension.zip"');
    expect(html).toContain('chrome://extensions');
    expect(html).toContain('Load unpacked');
  });

  it('ships the source manifest version in the downloadable extension package', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(root, 'extensions/gorgias-sofapaint/manifest.json'), 'utf8')
    );
    const archive = await readFile(
      resolve(root, 'public/downloads/gorgias-sofapaint-extension.zip')
    );
    const zip = await JSZip.loadAsync(archive);
    const packagedManifest = JSON.parse(await zip.file('manifest.json')!.async('string'));

    expect(packagedManifest.version).toBe(manifest.version);
    expect(archive.byteLength).toBeGreaterThan(10_000);
  });
});
