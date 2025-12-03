/**
 * Final deployment verification
 */

const newUrl = 'https://sofapaint-7n3ocksdj-leigh-atkins-projects.vercel.app';

async function testFinalDeployment() {
  console.log(`🧪 Testing Final Deployment: ${newUrl}\n`);
  
  // Test main page
  try {
    console.log('Testing main page...');
    const response = await fetch(newUrl);
    console.log(`Status: ${response.status}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  // Test a previously 404'd JS file
  console.log('\nTesting previously missing JS files...');
  const testFiles = [
    '/js/toolbar-layout.js',
    '/js/toolbar-init.js',
    '/js/panel-management.js'
  ];
  
  for (const file of testFiles) {
    try {
      const response = await fetch(`${newUrl}${file}`);
      console.log(`${file}: ${response.status} ${response.status === 200 ? '✅' : '❌'}`);
    } catch (error) {
      console.log(`${file}: Error - ${error.message}`);
    }
  }
}

await testFinalDeployment();
