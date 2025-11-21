/**
 * Test Vercel AI Integration Deployment
 * Verifies that the Express relay endpoints are working correctly
 */

const testPayload = {
  image: { width: 800, height: 600 },
  units: { name: 'cm', pxPerUnit: 37.8 },
  strokes: [
    {
      id: 'A1',
      type: 'straight',
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: '#000000',
      width: 2
    },
    {
      id: 'A2', 
      type: 'arrow',
      points: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
      color: '#0B84F3',
      width: 3,
      arrowSettings: { endArrow: true }
    }
  ]
};

async function testVercelDeployment(baseUrl) {
  console.log(`🧪 Testing Vercel AI Integration: ${baseUrl}`);
  console.log('='.repeat(50));
    
  const results = {
    health: false,
    generateSvg: false,
    assistMeasurement: false,
    enhancePlacement: false
  };
    
  // Test 1: Health endpoint
  console.log('\n1️⃣ Testing Health Endpoint...');
  try {
    const response = await fetch(`${baseUrl}/health`);
    const data = await response.json();
    console.log('✅ Health Response:', data);
    results.health = response.ok && (data.ok === true || data.status === 'ok');
  } catch (error) {
    console.log('❌ Health Failed:', error.message);
  }
    
  // Test 2: Generate SVG endpoint
  console.log('\n2️⃣ Testing Generate SVG Endpoint...');
  try {
    const response = await fetch(`${baseUrl}/ai/generate-svg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });
        
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Generate SVG Success:', {
        svgLength: data.svg?.length || 0,
        vectorCount: data.vectors?.length || 0,
        hasSummary: !!data.summary
      });
      results.generateSvg = true;
    } else {
      const errorText = await response.text();
      console.log('❌ Generate SVG Failed:', response.status, errorText);
    }
  } catch (error) {
    console.log('❌ Generate SVG Error:', error.message);
  }
    
  // Test 3: Assist Measurement endpoint
  console.log('\n3️⃣ Testing Assist Measurement Endpoint...');
  try {
    const measurementPayload = {
      units: { name: 'cm', pxPerUnit: 37.8 },
      stroke: {
        id: 'A1',
        type: 'straight',
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        color: '#000',
        width: 2
      }
    };
        
    const response = await fetch(`${baseUrl}/ai/assist-measurement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(measurementPayload)
    });
        
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Assist Measurement Success:', data);
      results.assistMeasurement = true;
    } else {
      const errorText = await response.text();
      console.log('❌ Assist Measurement Failed:', response.status, errorText);
    }
  } catch (error) {
    console.log('❌ Assist Measurement Error:', error.message);
  }
    
  // Test 4: Enhance Placement endpoint
  console.log('\n4️⃣ Testing Enhance Placement Endpoint...');
  try {
    const placementPayload = {
      image: { width: 800, height: 600 },
      strokes: testPayload.strokes
    };
        
    const response = await fetch(`${baseUrl}/ai/enhance-placement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(placementPayload)
    });
        
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Enhance Placement Success:', data);
      results.enhancePlacement = true;
    } else {
      const errorText = await response.text();
      console.log('❌ Enhance Placement Failed:', response.status, errorText);
    }
  } catch (error) {
    console.log('❌ Enhance Placement Error:', error.message);
  }
    
  // Summary
  console.log('\n📊 Test Results Summary');
  console.log('='.repeat(30));
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASS' : 'FAIL'}`);
  });
    
  const allPassed = Object.values(results).every(Boolean);
  console.log(`\n🎯 Overall Result: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
    
  if (!allPassed) {
    console.log('\n🔧 Troubleshooting:');
    if (!results.health) {
      console.log('- Health endpoint failed: Check if app.js is properly deployed');
    }
    if (!results.generateSvg) {
      console.log('- Generate SVG failed: Check AI_WORKER_URL and AI_WORKER_KEY environment variables');
    }
    if (!results.assistMeasurement) {
      console.log('- Assist Measurement failed: Check Worker authentication');
    }
    if (!results.enhancePlacement) {
      console.log('- Enhance Placement failed: Check Worker endpoint');
    }
  }
    
  return results;
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testVercelDeployment, testPayload };
} else if (typeof window !== 'undefined') {
  window.VercelTestSuite = { testVercelDeployment, testPayload };
}

// Auto-run if called directly
if (require.main === module) {
  const baseUrl = process.argv[2] || 'https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app';
  testVercelDeployment(baseUrl);
}
