/**
 * Helper script to populate KV with initial stroke exemplars
 * Run with: node scripts/populate-kv.js
 */

const { execSync } = require('child_process');

// Example stroke data - normalized coordinates (0-1)
const exemplarStrokes = [
    {
        key: 'stroke:A1:front-center',
        data: {
            id: 'exemplar-a1-front-center-1',
            measurementCode: 'A1',
            viewpoint: 'front-center',
            armShape: 'round-arm',
            backHeight: 'high-back',
            direction: 'horizontal',
            priority: 1,
            points: [
                { x: 0.1, y: 0.2, t: 0 },
                { x: 0.3, y: 0.2, t: 100 },
                { x: 0.5, y: 0.2, t: 200 },
                { x: 0.7, y: 0.2, t: 300 },
                { x: 0.9, y: 0.2, t: 400 }
            ],
            width: 0.002,
            confidence: 0.8
        }
    },
    {
        key: 'stroke:A2:front-arm',
        data: {
            id: 'exemplar-a2-front-arm-1',
            measurementCode: 'A2',
            viewpoint: 'front-arm',
            armShape: 'round-arm',
            backHeight: 'high-back',
            direction: 'vertical',
            priority: 1,
            points: [
                { x: 0.2, y: 0.1, t: 0 },
                { x: 0.2, y: 0.3, t: 100 },
                { x: 0.2, y: 0.5, t: 200 },
                { x: 0.2, y: 0.7, t: 300 }
            ],
            width: 0.002,
            confidence: 0.75
        }
    },
    {
        key: 'stroke:A4:front-arm',
        data: {
            id: 'exemplar-a4-front-arm-1',
            measurementCode: 'A4',
            viewpoint: 'front-arm',
            armShape: 'round-arm',
            backHeight: 'high-back',
            direction: 'diagonal',
            priority: 1,
            points: [
                { x: 0.1, y: 0.3, t: 0 },
                { x: 0.2, y: 0.4, t: 100 },
                { x: 0.3, y: 0.5, t: 200 },
                { x: 0.4, y: 0.6, t: 300 },
                { x: 0.5, y: 0.7, t: 400 }
            ],
            width: 0.002,
            confidence: 0.7
        }
    }
];

function populateKV() {
    console.log('Populating KV with exemplar strokes...\n');

    exemplarStrokes.forEach(({ key, data }) => {
        try {
            const jsonData = JSON.stringify(data);
            const tempFile = `temp_${Date.now()}.json`;
            
            // Write to temp file
            require('fs').writeFileSync(tempFile, jsonData);
            
            // Use wrangler to put the key
            console.log(`Adding: ${key}`);
            execSync(`npx wrangler kv key put --binding=SOFA_TAGS "${key}" --path="${tempFile}"`, {
                stdio: 'inherit'
            });
            
            // Clean up temp file
            require('fs').unlinkSync(tempFile);
            
            console.log(`✓ Added ${key}\n`);
        } catch (error) {
            console.error(`✗ Failed to add ${key}:`, error.message);
        }
    });

    // Update manifest
    try {
        const manifest = exemplarStrokes.map(s => s.key);
        const manifestFile = `temp_manifest_${Date.now()}.json`;
        require('fs').writeFileSync(manifestFile, JSON.stringify(manifest));
        
        execSync(`npx wrangler kv key put --binding=SOFA_TAGS "exemplar:manifest" --path="${manifestFile}"`, {
            stdio: 'inherit'
        });
        
        require('fs').unlinkSync(manifestFile);
        console.log('✓ Updated exemplar manifest\n');
    } catch (error) {
        console.error('✗ Failed to update manifest:', error.message);
    }

    console.log('Done!');
}

// Run if called directly
if (require.main === module) {
    populateKV();
}

module.exports = { populateKV, exemplarStrokes };

