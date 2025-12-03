/**
 * Test specific endpoint with fetch
 */

async function testHealthEndpoint() {
  const url = 'https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app/health';
  
  console.log(`Testing ${url}...\n`);
  
  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type');
    const text = await response.text();
    
    console.log('Status:', response.status);
    console.log('Content-Type:', contentType);
    console.log('Response length:', text.length);
    console.log('First 200 chars:', text.substring(0, 200));
    console.log('\nIs HTML?', text.includes('<!DOCTYPE') || text.includes('<html'));
    console.log('Is JSON?', contentType?.includes('json'));
    
    if (contentType?.includes('json')) {
      try {
        const json = JSON.parse(text);
        console.log('\nParsed JSON:', json);
      } catch (e) {
        console.log('\nFailed to parse as JSON:', e.message);
      }
    }
  } catch (error) {
    console.log('Error:', error.message);
  }
}

await testHealthEndpoint();
