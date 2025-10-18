/**
 * End-to-End AI Integration Test
 * Tests the complete flow: Frontend → Express → Worker
 */

// Test data
const testPayload = {
    image: { width: 800, height: 600 },
    units: { name: "cm", pxPerUnit: 37.8 },
    strokes: [
        {
            id: "A1",
            type: "straight", 
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            color: "#000000",
            width: 2
        },
        {
            id: "A2",
            type: "arrow",
            points: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
            color: "#0B84F3", 
            width: 3,
            arrowSettings: { endArrow: true }
        }
    ]
};

console.log('🧪 AI Integration Test Suite');
console.log('============================');

// Test 1: Worker Health Check
async function testWorkerHealth() {
    console.log('\n1️⃣ Testing Worker Health...');
    try {
        const response = await fetch('https://openpaint-ai-worker.sofapaint-api.workers.dev/health');
        const data = await response.json();
        console.log('✅ Worker Health:', data);
        return data.status === 'ok';
    } catch (error) {
        console.log('❌ Worker Health Failed:', error.message);
        return false;
    }
}

// Test 2: Worker Auth Rejection
async function testWorkerAuthRejection() {
    console.log('\n2️⃣ Testing Worker Auth Rejection...');
    try {
        const response = await fetch('https://openpaint-ai-worker.sofapaint-api.workers.dev/generate-svg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload)
        });
        const data = await response.json();
        console.log('✅ Worker Auth Rejection:', data);
        return data.error === 'Unauthorized';
    } catch (error) {
        console.log('❌ Worker Auth Test Failed:', error.message);
        return false;
    }
}

// Test 3: Express Relay (should work without API key)
async function testExpressRelay() {
    console.log('\n3️⃣ Testing Express Relay...');
    try {
        const response = await fetch('https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app/ai/generate-svg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload)
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Express Relay Success:', {
                svgLength: data.svg?.length || 0,
                vectorCount: data.vectors?.length || 0,
                hasSummary: !!data.summary
            });
            return true;
        } else {
            console.log('❌ Express Relay Failed:', response.status, response.statusText);
            return false;
        }
    } catch (error) {
        console.log('❌ Express Relay Error:', error.message);
        return false;
    }
}

// Test 4: Frontend Integration (if running in browser)
async function testFrontendIntegration() {
    console.log('\n4️⃣ Testing Frontend Integration...');
    
    if (typeof window === 'undefined') {
        console.log('⏭️ Skipping frontend test (not in browser)');
        return true;
    }
    
    try {
        // Check if AI export functions are available
        const hasExportFunction = typeof window.exportAIEnhancedSVG === 'function';
        const hasModal = !!document.getElementById('aiPreviewModal');
        const hasButton = !!document.getElementById('exportAISVG');
        
        console.log('✅ Frontend Components:', {
            exportFunction: hasExportFunction,
            previewModal: hasModal,
            exportButton: hasButton
        });
        
        return hasExportFunction && hasModal && hasButton;
    } catch (error) {
        console.log('❌ Frontend Test Failed:', error.message);
        return false;
    }
}

// Test 5: Mock Worker (local development)
async function testMockWorker() {
    console.log('\n5️⃣ Testing Mock Worker...');
    
    if (typeof window === 'undefined') {
        console.log('⏭️ Skipping mock test (not in browser)');
        return true;
    }
    
    try {
        // Check if mock worker is available
        const mockAvailable = typeof window.MockAIWorker !== 'undefined';
        console.log('✅ Mock Worker Available:', mockAvailable);
        return mockAvailable;
    } catch (error) {
        console.log('❌ Mock Worker Test Failed:', error.message);
        return false;
    }
}

// Run all tests
async function runAllTests() {
    const results = {
        workerHealth: await testWorkerHealth(),
        workerAuth: await testWorkerAuthRejection(),
        expressRelay: await testExpressRelay(),
        frontendIntegration: await testFrontendIntegration(),
        mockWorker: await testMockWorker()
    };
    
    console.log('\n📊 Test Results Summary');
    console.log('========================');
    Object.entries(results).forEach(([test, passed]) => {
        console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASS' : 'FAIL'}`);
    });
    
    const allPassed = Object.values(results).every(Boolean);
    console.log(`\n🎯 Overall Result: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
    
    return results;
}

// Export for use in browser or Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runAllTests, testPayload };
} else if (typeof window !== 'undefined') {
    window.AITestSuite = { runAllTests, testPayload };
}

// Auto-run if in browser
if (typeof window !== 'undefined') {
    console.log('🚀 Auto-running AI Integration Tests...');
    runAllTests();
}
