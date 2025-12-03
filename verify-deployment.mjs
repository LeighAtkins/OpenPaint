/**
 * Simple deployment verification script
 * Tests both local and Vercel deployments
 */

async function testEndpoint(baseUrl, endpoint = '/health') {
  try {
    console.log(`\n🔍 Testing: ${baseUrl}${endpoint}`);
    const response = await fetch(`${baseUrl}${endpoint}`);
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, data);
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.log(`   ❌ Error:`, error.message);
    return { ok: false, error: error.message };
  }
}

async function testDeployment(baseUrl, name) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Testing ${name}: ${baseUrl}`);
  console.log('='.repeat(60));
  
  // Test 1: Health endpoint
  await testEndpoint(baseUrl, '/health');
  
  // Test 2: Main page
  try {
    console.log(`\n🔍 Testing: ${baseUrl}/`);
    const response = await fetch(`${baseUrl}/`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);
    const text = await response.text();
    const hasCanvas = text.includes('canvas') || text.includes('Canvas');
    const hasOpenPaint = text.includes('OpenPaint') || text.includes('openpaint');
    console.log(`   Contains canvas elements: ${hasCanvas}`);
    console.log(`   Contains OpenPaint: ${hasOpenPaint}`);
  } catch (error) {
    console.log(`   ❌ Error:`, error.message);
  }
  
  // Test 3: Static files
  await testEndpoint(baseUrl, '/js/paint_final.js');
  
  console.log('\n');
}

// Run tests
const vercelUrl = 'https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app';
const localUrl = 'http://localhost:3000';

console.log('🧪 OpenPaint Deployment Verification\n');

// Test Vercel first
await testDeployment(vercelUrl, 'VERCEL');

// Test local if available
console.log('\n💡 Testing local deployment (if server is running)...');
try {
  await testDeployment(localUrl, 'LOCAL');
} catch (error) {
  console.log(`\n⚠️  Local server not accessible at ${localUrl}`);
  console.log('   To test local: Start server with `npm start` in another terminal\n');
}

console.log('✅ Verification complete!\n');
