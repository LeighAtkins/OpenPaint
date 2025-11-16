/**
 * Backfill script to create feedback manifest from existing index keys
 * Run with: node scripts/backfill-manifest.js
 */

const indexKeys = [
  'feedback:index:A1:unknown',
  'feedback:index:A2:unknown',
  'feedback:index:A3:unknown',
  'feedback:index:A4:unknown',
  'feedback:index:D:unknown'
];

const manifest = {
  indexKeys: indexKeys,
  lastUpdated: new Date().toISOString(),
  createdBy: 'backfill-script'
};

console.log('Manifest to create:', JSON.stringify(manifest, null, 2));
console.log('\nTo create this manifest, run:');
console.log(`npx wrangler kv key put --binding=SOFA_TAGS "feedback:manifest" --value='${JSON.stringify(manifest)}' --config wrangler.feedback.toml`);

