/**
 * Quick test of new deployment
 */

const newUrl = 'https://sofapaint-29032zc89-leigh-atkins-projects.vercel.app';

async function testNewDeployment() {
  console.log(`🧪 Testing New Deployment: ${newUrl}\n`);
  
  // Test main page
  try {
    console.log('Testing main page...');
    const response = await fetch(newUrl);
    const html = await response.text();
    
    console.log(`Status: ${response.status}`);
    console.log(`Has fabric references: ${html.includes('fabric')}`);
    console.log(`Page size: ${(html.length / 1024).toFixed(1)} KB`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  // Test health endpoint
  console.log('\nTesting /health endpoint...');
  try {
    const response = await fetch(`${newUrl}/health`);
    const text = await response.text();
    console.log(`Content-Type: ${response.headers.get('content-type')}`);
    console.log(`Is JSON: ${response.headers.get('content-type')?.includes('json')}`);
    console.log(`Response: ${text.substring(0, 100)}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

await testNewDeployment();
