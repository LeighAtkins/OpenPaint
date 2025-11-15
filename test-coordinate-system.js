/**
 * Test suite for the new coordinate system
 * Validates Transform T, geometry functions, and coordinate stability
 */
(function() {
    'use strict';

    // Test results
    const testResults = {
        passed: 0,
        failed: 0,
        tests: []
    };

    function logTest(name, success, message, details = null) {
        testResults.tests.push({ name, success, message, details });
        if (success) {
            testResults.passed++;
            console.log(`✅ PASS: ${name} - ${message}`);
        } else {
            testResults.failed++;
            console.error(`❌ FAIL: ${name} - ${message}`, details);
        }
    }

    function runTests() {
        console.log('🧪 Running coordinate system tests...');
        testResults.tests = [];
        testResults.passed = 0;
        testResults.failed = 0;

        // Test 1: Transform T initialization
        testTransformInitialization();

        // Test 2: Coordinate space conversions
        testCoordinateConversions();

        // Test 3: Normalized offset calculations
        testNormalizedOffsets();

        // Test 4: Anchor center computation
        testAnchorCenters();

        // Test 5: Deterministic fit calculations
        testFitCalculations();

        // Test 6: Persistence guard
        testPersistenceGuard();

        // Test 7: Migration system
        testMigration();

        // Summary
        console.log(`\n📊 Test Results: ${testResults.passed} passed, ${testResults.failed} failed`);
        if (testResults.failed === 0) {
            console.log('🎉 All tests passed!');
        } else {
            console.warn('⚠️  Some tests failed. Check the details above.');
        }

        return testResults;
    }

    function testTransformInitialization() {
        try {
            if (!window.getCurrentTransform) {
                logTest('Transform T', false, 'getCurrentTransform not available');
                return;
            }

            const T = window.getCurrentTransform();
            const requiredFields = ['scale', 'panX', 'panY', 'dpr'];
            const missing = requiredFields.filter(field => !(field in T));

            if (missing.length > 0) {
                logTest('Transform T', false, `Missing fields: ${missing.join(', ')}`);
                return;
            }

            // Check reasonable values
            if (T.scale <= 0 || T.dpr <= 0) {
                logTest('Transform T', false, 'Invalid scale or dpr values');
                return;
            }

            logTest('Transform T', true, 'Initialization successful', T);
        } catch (e) {
            logTest('Transform T', false, `Exception: ${e.message}`, e);
        }
    }

    function testCoordinateConversions() {
        try {
            if (!window.toCanvas || !window.toImage) {
                logTest('Coordinate Conversions', false, 'Conversion functions not available');
                return;
            }

            const T = { scale: 2.0, panX: 10, panY: 20, dpr: 1 };
            const testPoint = { x: 100, y: 50 };

            // Test toCanvas
            const canvasPoint = window.toCanvas(testPoint, T);
            if (!canvasPoint || typeof canvasPoint.x !== 'number') {
                logTest('Coordinate Conversions', false, 'toCanvas failed');
                return;
            }

            // Test roundtrip
            const roundtrip = window.toImage(canvasPoint, T);
            const error = Math.hypot(roundtrip.x - testPoint.x, roundtrip.y - testPoint.y);

            if (error > 0.1) {
                logTest('Coordinate Conversions', false, `Roundtrip error too high: ${error}`);
                return;
            }

            logTest('Coordinate Conversions', true, `Roundtrip error: ${error.toFixed(3)}px`);
        } catch (e) {
            logTest('Coordinate Conversions', false, `Exception: ${e.message}`, e);
        }
    }

    function testNormalizedOffsets() {
        try {
            if (!window.pixelOffsetToNorm || !window.normToPixelOffset) {
                logTest('Normalized Offsets', false, 'Normalization functions not available');
                return;
            }

            const normRef = { w: 800, h: 600 };
            const pixelOffset = { dx: 40, dy: -30 };

            // Test pixel to normalized
            const normOffset = window.pixelOffsetToNorm(pixelOffset.dx, pixelOffset.dy, normRef);
            if (!normOffset || typeof normOffset.dx_norm !== 'number') {
                logTest('Normalized Offsets', false, 'pixelOffsetToNorm failed');
                return;
            }

            // Test roundtrip
            const backToPixel = window.normToPixelOffset(normOffset.dx_norm, normOffset.dy_norm, normRef);
            const errorX = Math.abs(backToPixel.dx - pixelOffset.dx);
            const errorY = Math.abs(backToPixel.dy - pixelOffset.dy);

            if (errorX > 0.01 || errorY > 0.01) {
                logTest('Normalized Offsets', false, `Roundtrip error: dx=${errorX}, dy=${errorY}`);
                return;
            }

            logTest('Normalized Offsets', true, 'Normalization roundtrip successful');
        } catch (e) {
            logTest('Normalized Offsets', false, `Exception: ${e.message}`, e);
        }
    }

    function testAnchorCenters() {
        try {
            if (!window.computeAnchorCenterImage) {
                logTest('Anchor Centers', false, 'computeAnchorCenterImage not available');
                return;
            }

            // Create a mock stroke
            const mockStroke = {
                points: [
                    { x: 100, y: 100 },
                    { x: 200, y: 100 },
                    { x: 200, y: 200 },
                    { x: 100, y: 200 }
                ]
            };

            const anchor = window.computeAnchorCenterImage(mockStroke);
            if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number') {
                logTest('Anchor Centers', false, 'Anchor computation failed');
                return;
            }

            // For a square, center should be at (150, 150)
            const expectedX = 150;
            const expectedY = 150;
            const error = Math.hypot(anchor.x - expectedX, anchor.y - expectedY);

            if (error > 0.1) {
                logTest('Anchor Centers', false, `Incorrect center: got (${anchor.x}, ${anchor.y}), expected (${expectedX}, ${expectedY})`);
                return;
            }

            logTest('Anchor Centers', true, `Center computed: (${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)})`);
        } catch (e) {
            logTest('Anchor Centers', false, `Exception: ${e.message}`, e);
        }
    }

    function testFitCalculations() {
        try {
            if (!window.computeScaleForFit) {
                logTest('Fit Calculations', false, 'computeScaleForFit not available');
                return;
            }

            const imageNatural = { w: 800, h: 600 };
            const viewportCss = { w: 400, h: 300 };

            const scale = window.computeScaleForFit(imageNatural, viewportCss, 'contain');
            if (typeof scale !== 'number' || scale <= 0) {
                logTest('Fit Calculations', false, 'Invalid scale result');
                return;
            }

            // For contain mode, scale should be min(400/800, 300/600) = min(0.5, 0.5) = 0.5
            const expected = 0.5;
            const error = Math.abs(scale - expected);

            if (error > 0.001) {
                logTest('Fit Calculations', false, `Incorrect scale: got ${scale}, expected ${expected}`);
                return;
            }

            logTest('Fit Calculations', true, `Scale computed: ${scale}`);
        } catch (e) {
            logTest('Fit Calculations', false, `Exception: ${e.message}`, e);
        }
    }

    function testPersistenceGuard() {
        try {
            if (!window.canPersistOffsets || !window.getTransformSession) {
                logTest('Persistence Guard', false, 'Persistence functions not available');
                return;
            }

            const session = window.getTransformSession();
            const canPersist = window.canPersistOffsets(session);

            // This should work regardless of current state
            if (typeof canPersist !== 'boolean') {
                logTest('Persistence Guard', false, 'Invalid return type');
                return;
            }

            logTest('Persistence Guard', true, `Persistence check: ${canPersist ? 'allowed' : 'blocked'} (${session.phase})`);
        } catch (e) {
            logTest('Persistence Guard', false, `Exception: ${e.message}`, e);
        }
    }

    function testMigration() {
        try {
            if (!window.isLegacyOffset || !window.migratePixelOffsetToNorm) {
                logTest('Migration System', false, 'Migration functions not available');
                return;
            }

            // Test legacy detection
            const legacyOffset = { x: 10, y: -20 };
            const modernOffset = { kind: 'norm', dx_norm: 0.0125, dy_norm: -0.0333, normRef: { w: 800, h: 600 }, version: 2 };

            const isLegacy = window.isLegacyOffset(legacyOffset);
            const isModern = !window.isLegacyOffset(modernOffset);

            if (!isLegacy || !isModern) {
                logTest('Migration System', false, 'Legacy detection failed');
                return;
            }

            // Test migration
            const natural = { w: 800, h: 600 };
            const migrated = window.migratePixelOffsetToNorm(legacyOffset, natural);

            if (!migrated || migrated.kind !== 'norm') {
                logTest('Migration System', false, 'Migration failed');
                return;
            }

            logTest('Migration System', true, 'Migration successful');
        } catch (e) {
            logTest('Migration System', false, `Exception: ${e.message}`, e);
        }
    }

    // Export test runner
    window.runCoordinateSystemTests = runTests;
    window.getTestResults = () => testResults;

    console.log('🧪 Coordinate system test suite loaded. Run window.runCoordinateSystemTests() to execute tests.');

})();
