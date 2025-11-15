# Test Fixtures

This directory contains test fixtures used across the test suite.

## Image Fixtures

- `front.jpg` - Sample front view image for furniture measurement testing
- `side.jpg` - Sample side view image for furniture measurement testing  
- `back.jpg` - Sample back view image for furniture measurement testing
- `test-furniture.jpg` - Generic furniture image for general testing

## Data Fixtures

- `sample-measurements.json` - Sample measurement data for testing
- `sample-strokes.json` - Sample stroke data for testing
- `sample-project.json` - Sample project export data for testing

## Usage

These fixtures are used by:
- Unit tests for data processing
- Integration tests for workflow testing
- E2E tests for complete user scenarios
- Visual regression tests for rendering consistency

## Adding New Fixtures

When adding new fixtures:
1. Use descriptive filenames
2. Keep file sizes reasonable for CI/CD performance
3. Add appropriate documentation
4. Ensure fixtures represent realistic test scenarios