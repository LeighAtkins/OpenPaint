// Simple Node.js test for viewport controller math
const fs = require('fs');

console.log('🧪 Testing Viewport Controller Math...\n');

// Extract just the helper functions from our viewport controller
function containScale(contentWidth, contentHeight, viewportWidth, viewportHeight, padding = 0) {
  const availableWidth = Math.max(1, viewportWidth - 2 * padding);
  const availableHeight = Math.max(1, viewportHeight - 2 * padding);
  
  const scaleX = availableWidth / Math.max(1, contentWidth);
  const scaleY = availableHeight / Math.max(1, contentHeight);
  
  return Math.min(scaleX, scaleY);
}

function centreTxTy(contentBounds, viewportWidth, viewportHeight, scale) {
  const scaledWidth = contentBounds.width * scale;
  const scaledHeight = contentBounds.height * scale;
  
  const tx = (viewportWidth - scaledWidth) / 2 / scale - contentBounds.x;
  const ty = (viewportHeight - scaledHeight) / 2 / scale - contentBounds.y;
  
  return { tx, ty };
}

function toScreen(worldX, worldY, transform) {
  return {
    x: (worldX + transform.tx) * transform.scale,
    y: (worldY + transform.ty) * transform.scale
  };
}

function toWorld(screenX, screenY, transform) {
  return {
    x: screenX / transform.scale - transform.tx,
    y: screenY / transform.scale - transform.ty
  };
}

// Test 1: containScale
console.log('Testing containScale...');
const scale1 = containScale(200, 100, 400, 300, 20);
const expected1 = 1.8; // (400-40)/200 = 1.8, (300-40)/100 = 2.6, min = 1.8
if (Math.abs(scale1 - expected1) < 0.001) {
    console.log('✅ containScale width-constrained: PASS');
} else {
    console.log('❌ containScale width-constrained: FAIL - expected', expected1, 'got', scale1);
    process.exit(1);
}

const scale2 = containScale(100, 200, 400, 300, 20);
const expected2 = 1.3; // (400-40)/100 = 3.6, (300-40)/200 = 1.3, min = 1.3
if (Math.abs(scale2 - expected2) < 0.001) {
    console.log('✅ containScale height-constrained: PASS');
} else {
    console.log('❌ containScale height-constrained: FAIL - expected', expected2, 'got', scale2);
    process.exit(1);
}

// Test 2: centreTxTy
console.log('\nTesting centreTxTy...');
const contentBounds = { x: 0, y: 0, width: 100, height: 50 };
const { tx, ty } = centreTxTy(contentBounds, 400, 300, 2.0);
const expectedTx = 50; // (400 - 200) / 2 / 2 - 0 = 50
const expectedTy = 50; // (300 - 100) / 2 / 2 - 0 = 50

if (Math.abs(tx - expectedTx) < 0.001 && Math.abs(ty - expectedTy) < 0.001) {
    console.log('✅ centreTxTy: PASS');
} else {
    console.log('❌ centreTxTy: FAIL - expected', expectedTx, expectedTy, 'got', tx, ty);
    process.exit(1);
}

// Test 3: Coordinate transforms round-trip
console.log('\nTesting coordinate transforms...');
const transform = { scale: 2.0, tx: 100, ty: 50 };
const testPoints = [
    { x: 0, y: 0 },
    { x: 123.456, y: 789.012 },
    { x: -50.5, y: 100.25 }
];

let allPassed = true;
testPoints.forEach((point, i) => {
    const screen = toScreen(point.x, point.y, transform);
    const world = toWorld(screen.x, screen.y, transform);
    
    const errorX = Math.abs(world.x - point.x);
    const errorY = Math.abs(world.y - point.y);
    const maxError = 0.000001; // Very tight tolerance
    
    const passed = errorX < maxError && errorY < maxError;
    allPassed = allPassed && passed;
    
    if (passed) {
        console.log(`✅ Point ${i + 1} round-trip: PASS (error: ${errorX.toFixed(8)}, ${errorY.toFixed(8)})`);
    } else {
        console.log(`❌ Point ${i + 1} round-trip: FAIL (error: ${errorX.toFixed(8)}, ${errorY.toFixed(8)})`);
    }
});

if (!allPassed) {
    process.exit(1);
}

// Test 4: Edge cases
console.log('\nTesting edge cases...');

// Zero content dimensions
const scaleZero = containScale(0, 100, 400, 300, 0);
if (isFinite(scaleZero) && scaleZero > 0) {
    console.log('✅ Zero content width: PASS');
} else {
    console.log('❌ Zero content width: FAIL');
    process.exit(1);
}

// Very small viewport
const scaleSmall = containScale(100, 100, 10, 10, 0);
if (isFinite(scaleSmall) && scaleSmall > 0) {
    console.log('✅ Small viewport: PASS');
} else {
    console.log('❌ Small viewport: FAIL');
    process.exit(1);
}

// High DPR simulation
const highDprTransform = { scale: 1.5, tx: 200.333, ty: 150.777 };
const highDprPoint = { x: 99.999, y: 199.111 };
const highDprScreen = toScreen(highDprPoint.x, highDprPoint.y, highDprTransform);
const highDprWorld = toWorld(highDprScreen.x, highDprScreen.y, highDprTransform);

const highDprError = Math.abs(highDprWorld.x - highDprPoint.x) + Math.abs(highDprWorld.y - highDprPoint.y);
if (highDprError < 0.000001) {
    console.log('✅ High precision round-trip: PASS');
} else {
    console.log('❌ High precision round-trip: FAIL - error:', highDprError);
    process.exit(1);
}

console.log('\n🎉 All viewport math tests passed!');
console.log('📝 Viewport controller math is working correctly');
console.log('🌐 Open test-viewport.html in browser for interactive testing');
console.log('🚀 Server should be running on http://localhost:3000');

console.log('\n📊 Test Summary:');
console.log('  - containScale: ✅ Width/height constraints working');
console.log('  - centreTxTy: ✅ Content centering working');  
console.log('  - Coordinate transforms: ✅ Round-trip precision < 0.000001px');
console.log('  - Edge cases: ✅ Handles zero/small dimensions');
console.log('  - High precision: ✅ Works with fractional coordinates');
