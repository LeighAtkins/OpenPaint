import fs from 'fs';
import path from 'path';

const GUIDES_DIR = 'public/measurement-guides';
const MANIFEST_FILE = path.join(GUIDES_DIR, 'manifest.json');
const MANIFEST_DIR_NAME = 'Modular MT ';
const MANIFEST_DIR = path.join(GUIDES_DIR, MANIFEST_DIR_NAME);

function buildTree(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => {
    // Dirs first, then files, alphabetical
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const files = [];
  const folders = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const subtree = buildTree(fullPath);
      if (subtree) {
        folders.push({
          name: entry.name,
          type: 'folder',
          ...subtree,
        });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.svg' || ext === '.pdf' || ext === '.jpg') {
        const relPath = path.relative(process.cwd(), fullPath);
        files.push({
          name: entry.name,
          type: ext.slice(1),
          path: relPath,
        });
      }
    }
  }

  // Only return non-empty nodes
  if (files.length === 0 && folders.length === 0) return null;

  const filtered = folders.filter(Boolean);
  const node = {};
  if (files.length) node.files = files;
  if (filtered.length) node.children = filtered;
  return node;
}

function main() {
  if (!fs.existsSync(MANIFEST_DIR)) {
    console.error(`Directory not found: ${MANIFEST_DIR}`);
    process.exit(1);
  }

  const tree = buildTree(MANIFEST_DIR);

  const manifest = {
    'modular-mt': {
      displayName: 'Modular MT',
      type: 'tree',
      tree: tree,
    },
  };

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${MANIFEST_FILE}`);

  // Print summary
  function countFiles(node) {
    if (!node) return 0;
    let n = node.files?.length || 0;
    if (node.children) {
      for (const c of node.children) n += countFiles(c);
    }
    return n;
  }
  console.log(`Total files: ${countFiles(tree)}`);
}

main();
