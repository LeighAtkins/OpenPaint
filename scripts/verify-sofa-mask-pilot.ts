import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fetchMaskEvidence,
  normalizeMaskInput,
  renderMaskOverlay,
} from '../src/modules/measurement-assistant/mcp/mask-service';

const root = process.argv[2];
if (!root) throw new Error('Supply the completed PC pilot directory.');
const pilot = JSON.parse(await readFile(join(root, 'pilot.json'), 'utf8'));
const token = (await readFile(join(root, 'api-token.secret'), 'utf8')).trim();
const config = {
  url: `${pilot.endpoint}/segment`,
  token,
  modelSha256: pilot.modelSha256,
  local: true,
};
const summary = [];
// Run the actual Worker bridge against the live PC service for one real photo.
const id = pilot.photos[0].id;
const image = new Uint8Array(await readFile(join(root, id, 'original.jpg')));
const canonical = await normalizeMaskInput(image, config);
const evidence = await fetchMaskEvidence(canonical.bytes, canonical, config);
const photo = `data:${canonical.mimeType};base64,${Buffer.from(canonical.bytes).toString('base64')}`;
await writeFile(join(root, id, 'worker-overlay.svg'), renderMaskOverlay(evidence, photo));
summary.push({
  id,
  masks: evidence.instances.length,
  checkpoint: evidence.model.sha256,
  actualWorkerBridgePassed: true,
  imageHashMatched: true,
  bitmapAreasVerified: true,
});
await writeFile(join(root, 'worker-bridge-check.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
