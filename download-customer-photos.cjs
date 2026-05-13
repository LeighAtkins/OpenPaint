const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { URL } = require('url');

// Configuration
const INPUT_FILE = '/mnt/c/Users/Leigh Atkins/Documents/customer-photos.txt';
const OUTPUT_DIR = '/home/leigh_atkins/customer-photos-downloaded';
const MAX_CONCURRENT = 10; // Parallel downloads
const TIMEOUT_MS = 30000; // 30 second timeout per download

// Statistics
const stats = {
  total: 0,
  jpeg: 0,
  png: 0,
  other: 0,
  downloaded: 0,
  failed: 0,
  expired: 0,
  skipped: 0
};

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Extract extension from URL
function getExtension(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();

    if (pathname.includes('.jpg') || pathname.includes('.jpeg')) return 'jpeg';
    if (pathname.includes('.png')) return 'png';
    if (pathname.includes('.webp')) return 'webp';
    if (pathname.includes('.heic')) return 'heic';

    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

// Download a single file
function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, TIMEOUT_MS);

    protocol.get(url, (response) => {
      clearTimeout(timeout);

      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, filepath)
          .then(resolve)
          .catch(reject);
        return;
      }

      // Handle errors
      if (response.statusCode === 403) {
        reject(new Error('Expired/Forbidden'));
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      // Write to file
      const fileStream = fs.createWriteStream(filepath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(filepath, () => {}); // Clean up partial file
        reject(err);
      });

    }).on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Process a single URL
async function processUrl(url, index) {
  const ext = getExtension(url);

  // Generate filename
  const filename = `photo_${String(index).padStart(6, '0')}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const filepath = path.join(OUTPUT_DIR, filename);

  // Skip if already downloaded
  if (fs.existsSync(filepath)) {
    stats.skipped++;
    return { success: true, skipped: true };
  }

  try {
    await downloadFile(url, filepath);
    stats.downloaded++;
    return { success: true, ext };
  } catch (err) {
    if (err.message.includes('Expired') || err.message.includes('Forbidden')) {
      stats.expired++;
    } else {
      stats.failed++;
    }
    return { success: false, error: err.message };
  }
}

// Main function
async function main() {
  console.log('Reading URLs from file...');

  // Read and parse URLs
  const content = fs.readFileSync(INPUT_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const urls = [];

  for (const line of lines) {
    // Extract URL (remove quotes if present)
    let url = line.trim();
    url = url.replace(/^["']|["']$/g, ''); // Remove leading/trailing quotes

    if (url.startsWith('http')) {
      const ext = getExtension(url);
      urls.push({ url, ext, index: urls.length + 1 });
      stats.total++;

      if (ext === 'jpeg') stats.jpeg++;
      else if (ext === 'png') stats.png++;
      else stats.other++;
    }
  }

  console.log(`\nFound ${stats.total} URLs:`);
  console.log(`  - JPEG: ${stats.jpeg}`);
  console.log(`  - PNG: ${stats.png}`);
  console.log(`  - Other: ${stats.other}`);
  console.log(`\nOutput directory: ${OUTPUT_DIR}`);
  console.log(`Max concurrent downloads: ${MAX_CONCURRENT}\n`);

  // Sort: Most recent first (reverse order), then by extension priority
  urls.sort((a, b) => {
    // First sort by index (descending - most recent first)
    const indexDiff = b.index - a.index;
    if (indexDiff !== 0) return indexDiff;

    // Then by extension priority
    const priority = { jpeg: 0, png: 1, webp: 2, heic: 3, unknown: 4 };
    return priority[a.ext] - priority[b.ext];
  });

  console.log('Starting downloads (prioritizing most recent URLs, then JPEG/PNG)...\n');

  // Process with concurrency limit
  const queue = [...urls];
  const active = new Set();
  let completed = 0;
  let lastUpdate = Date.now();

  while (queue.length > 0 || active.size > 0) {
    // Fill up to max concurrent
    while (active.size < MAX_CONCURRENT && queue.length > 0) {
      const item = queue.shift();
      const promise = processUrl(item.url, item.index)
        .then(result => {
          active.delete(promise);
          completed++;

          // Update progress every second
          const now = Date.now();
          if (now - lastUpdate > 1000) {
            lastUpdate = now;
            const percent = ((completed / stats.total) * 100).toFixed(1);
            process.stdout.write(`\rProgress: ${completed}/${stats.total} (${percent}%) | Downloaded: ${stats.downloaded} | Expired: ${stats.expired} | Failed: ${stats.failed} | Skipped: ${stats.skipped}`);
          }

          return result;
        })
        .catch(err => {
          active.delete(promise);
          completed++;
          stats.failed++;
        });

      active.add(promise);
    }

    // Wait for at least one to complete
    if (active.size > 0) {
      await Promise.race(active);
    }
  }

  // Final stats
  console.log('\n\n=== Download Complete ===');
  console.log(`Total URLs: ${stats.total}`);
  console.log(`Successfully downloaded: ${stats.downloaded}`);
  console.log(`Expired/Forbidden: ${stats.expired}`);
  console.log(`Failed (other errors): ${stats.failed}`);
  console.log(`Skipped (already exists): ${stats.skipped}`);
  console.log(`\nFiles saved to: ${OUTPUT_DIR}`);
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
