/**
 * Test script to verify Docker integration and background removal functionality
 * Run this after starting the Docker container to test the integration
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Testing OpenPaint Docker Integration...\n');

// Check if we're in a Docker environment
const isDocker = process.env.NODE_ENV === 'production' && fs.existsSync('/.dockerenv');
console.log(`📦 Running in Docker: ${isDocker ? '✅' : '❌'}`);

// Check if uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
const uploadsExists = fs.existsSync(uploadsDir);
console.log(`📁 Uploads directory exists: ${uploadsExists ? '✅' : '❌'}`);

// Check if Python is available
const { spawn } = require('child_process');

function checkPython() {
    return new Promise((resolve) => {
        const pythonProcess = spawn('python3', ['--version'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`🐍 Python available: ✅ (${output.trim()})`);
                resolve(true);
            } else {
                console.log('🐍 Python available: ❌');
                resolve(false);
            }
        });

        pythonProcess.on('error', () => {
            console.log('🐍 Python available: ❌');
            resolve(false);
        });
    });
}

// Check if rembg is available
function checkRembg() {
    return new Promise((resolve) => {
        const testScript = `
import sys
try:
    import rembg
    print("rembg version available")
    sys.exit(0)
except ImportError:
    print("rembg not available")
    sys.exit(1)
`;

        const tempScriptPath = path.join(__dirname, 'test_rembg.py');
        fs.writeFileSync(tempScriptPath, testScript);

        const pythonProcess = spawn('python3', [tempScriptPath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        pythonProcess.on('close', (code) => {
            // Clean up temp file
            try {
                if (fs.existsSync(tempScriptPath)) {
                    fs.unlinkSync(tempScriptPath);
                }
            } catch (e) {
                // Ignore cleanup errors
            }

            if (code === 0 && output.includes('rembg version available')) {
                console.log('🎨 Rembg library available: ✅');
                resolve(true);
            } else {
                console.log('🎨 Rembg library available: ❌');
                resolve(false);
            }
        });

        pythonProcess.on('error', () => {
            // Clean up temp file
            try {
                if (fs.existsSync(tempScriptPath)) {
                    fs.unlinkSync(tempScriptPath);
                }
            } catch (e) {
                // Ignore cleanup errors
            }
            console.log('🎨 Rembg library available: ❌');
            resolve(false);
        });
    });
}

// Check package.json dependencies
function checkDependencies() {
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        const hasCors = packageJson.dependencies && packageJson.dependencies.cors;
        const hasExpress = packageJson.dependencies && packageJson.dependencies.express;
        const hasMulter = packageJson.dependencies && packageJson.dependencies.multer;

        console.log(`📦 CORS dependency: ${hasCors ? '✅' : '❌'}`);
        console.log(`📦 Express dependency: ${hasExpress ? '✅' : '❌'}`);
        console.log(`📦 Multer dependency: ${hasMulter ? '✅' : '❌'}`);
    } catch (error) {
        console.log('📦 Package.json check: ❌ (Error reading file)');
    }
}

// Run all checks
async function runChecks() {
    console.log('🔍 Running system checks...\n');

    checkDependencies();

    console.log('');

    await checkPython();
    await checkRembg();

    console.log('\n✅ Docker integration test completed!');
    console.log('💡 If all checks passed, the Docker integration is working correctly.');
    console.log('🚀 You can now use the background removal feature in OpenPaint.');
}

runChecks().catch(console.error);
