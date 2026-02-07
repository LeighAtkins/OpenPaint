// Visual regression tests require a real canvas + jest-image-snapshot.
// Skipped until Playwright-based visual testing is set up.
describe.skip('Visual Regression Tests', () => {
  let canvas, ctx;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    ctx = canvas.getContext('2d');

    // Setup globals
    window.canvas = canvas;
    window.ctx = ctx;
    window.currentImageLabel = 'visual_test';
    window.vectorStrokesByImage = { visual_test: {} };
    window.lineStrokesByImage = { visual_test: [] };
    window.strokeVisibilityByImage = { visual_test: {} };
    window.imageScaleByLabel = { visual_test: 1 };
    window.imagePositionByLabel = { visual_test: { x: 0, y: 0 } };

    // TODO: These tests need rewriting — paint.js was split into manager classes in src/modules/
  });

  test('should render straight lines consistently', async () => {
    // Draw test pattern
    const strokes = {
      horizontal: {
        points: [
          { x: 100, y: 100 },
          { x: 700, y: 100 },
        ],
        type: 'straight',
        color: '#ff0000',
        width: 5,
      },
      vertical: {
        points: [
          { x: 400, y: 50 },
          { x: 400, y: 550 },
        ],
        type: 'straight',
        color: '#00ff00',
        width: 5,
      },
      diagonal: {
        points: [
          { x: 100, y: 500 },
          { x: 700, y: 100 },
        ],
        type: 'straight',
        color: '#0000ff',
        width: 5,
      },
    };

    window.vectorStrokesByImage.visual_test = strokes;
    window.lineStrokesByImage.visual_test = Object.keys(strokes);
    Object.keys(strokes).forEach(key => {
      window.strokeVisibilityByImage.visual_test[key] = true;
    });

    // Render
    if (window.redrawCanvasWithVisibility) {
      window.redrawCanvasWithVisibility();
    } else {
      // Fallback manual rendering
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      Object.entries(strokes).forEach(([label, stroke]) => {
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
        ctx.stroke();
      });
    }

    // Convert to image and compare
    const imageData = canvas.toDataURL('image/png');
    expect(imageData).toMatchImageSnapshot({
      customSnapshotIdentifier: 'straight-lines',
      failureThreshold: 0.01,
      failureThresholdType: 'percent',
    });
  });

  test('should render arrows consistently', async () => {
    const arrowStrokes = {
      arrow_both: {
        points: [
          { x: 100, y: 200 },
          { x: 300, y: 200 },
        ],
        type: 'arrow',
        color: '#ff0000',
        width: 5,
        arrowSettings: {
          startArrow: true,
          endArrow: true,
          arrowSize: 15,
          arrowStyle: 'triangular',
        },
      },
      arrow_end: {
        points: [
          { x: 400, y: 200 },
          { x: 600, y: 200 },
        ],
        type: 'arrow',
        color: '#00ff00',
        width: 5,
        arrowSettings: {
          startArrow: false,
          endArrow: true,
          arrowSize: 20,
          arrowStyle: 'triangular',
        },
      },
    };

    window.vectorStrokesByImage.visual_test = arrowStrokes;
    window.lineStrokesByImage.visual_test = Object.keys(arrowStrokes);
    Object.keys(arrowStrokes).forEach(key => {
      window.strokeVisibilityByImage.visual_test[key] = true;
    });

    // Render arrows (fallback if redraw function not available)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.entries(arrowStrokes).forEach(([label, stroke]) => {
      // Draw line
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
      ctx.stroke();

      // Draw arrow heads (simplified)
      if (stroke.arrowSettings && stroke.arrowSettings.endArrow) {
        const p1 = stroke.points[0];
        const p2 = stroke.points[1];
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const arrowSize = stroke.arrowSettings.arrowSize || 15;

        ctx.save();
        ctx.translate(p2.x, p2.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowSize, -arrowSize / 2);
        ctx.lineTo(-arrowSize, arrowSize / 2);
        ctx.closePath();
        ctx.fillStyle = stroke.color;
        ctx.fill();
        ctx.restore();
      }
    });

    const imageData = canvas.toDataURL('image/png');
    expect(imageData).toMatchImageSnapshot({
      customSnapshotIdentifier: 'arrows',
      failureThreshold: 0.01,
      failureThresholdType: 'percent',
    });
  });

  test('should render dotted lines consistently', async () => {
    const dottedStrokes = {
      dotted_small: {
        points: [
          { x: 100, y: 100 },
          { x: 700, y: 100 },
        ],
        type: 'straight',
        color: '#000000',
        width: 3,
        dashSettings: {
          enabled: true,
          style: 'small',
          pattern: [3, 3],
        },
      },
      dotted_medium: {
        points: [
          { x: 100, y: 200 },
          { x: 700, y: 200 },
        ],
        type: 'straight',
        color: '#000000',
        width: 5,
        dashSettings: {
          enabled: true,
          style: 'medium',
          pattern: [10, 5],
        },
      },
      dot_dash: {
        points: [
          { x: 100, y: 300 },
          { x: 700, y: 300 },
        ],
        type: 'straight',
        color: '#000000',
        width: 4,
        dashSettings: {
          enabled: true,
          style: 'dot-dash',
          pattern: [2, 4, 10, 4],
        },
      },
    };

    window.vectorStrokesByImage.visual_test = dottedStrokes;
    window.lineStrokesByImage.visual_test = Object.keys(dottedStrokes);
    Object.keys(dottedStrokes).forEach(key => {
      window.strokeVisibilityByImage.visual_test[key] = true;
    });

    // Render dotted lines
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.entries(dottedStrokes).forEach(([label, stroke]) => {
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;

      if (stroke.dashSettings && stroke.dashSettings.enabled) {
        ctx.setLineDash(stroke.dashSettings.pattern);
      } else {
        ctx.setLineDash([]);
      }

      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
      ctx.stroke();
    });

    const imageData = canvas.toDataURL('image/png');
    expect(imageData).toMatchImageSnapshot({
      customSnapshotIdentifier: 'dotted-lines',
      failureThreshold: 0.01,
      failureThresholdType: 'percent',
    });
  });

  test('should render labels with measurements consistently', async () => {
    // Setup strokes with measurements
    const labeledStrokes = {
      A1: {
        points: [
          { x: 100, y: 200 },
          { x: 400, y: 200 },
        ],
        type: 'straight',
        color: '#ff0000',
        width: 5,
      },
      A2: {
        points: [
          { x: 100, y: 300 },
          { x: 400, y: 400 },
        ],
        type: 'straight',
        color: '#00ff00',
        width: 5,
      },
    };

    window.vectorStrokesByImage.visual_test = labeledStrokes;
    window.lineStrokesByImage.visual_test = ['A1', 'A2'];
    window.strokeMeasurements = {
      visual_test: {
        A1: { inchWhole: 24, inchFraction: 0, cm: 60.96 },
        A2: { inchWhole: 18, inchFraction: 0.5, cm: 46.99 },
      },
    };
    window.strokeLabelVisibility = {
      visual_test: { A1: true, A2: true },
    };
    Object.keys(labeledStrokes).forEach(key => {
      window.strokeVisibilityByImage.visual_test[key] = true;
    });

    // Render strokes and labels
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw strokes
    Object.entries(labeledStrokes).forEach(([label, stroke]) => {
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
      ctx.stroke();
    });

    // Draw labels (simplified)
    ctx.fillStyle = '#000';
    ctx.font = '14px Arial';
    ctx.fillText('A1: 24"', 220, 190);
    ctx.fillText('A2: 18 1/2"', 220, 340);

    const imageData = canvas.toDataURL('image/png');
    expect(imageData).toMatchImageSnapshot({
      customSnapshotIdentifier: 'labels-with-measurements',
      failureThreshold: 0.02,
      failureThresholdType: 'percent',
    });
  });

  test('should render freehand strokes consistently', async () => {
    const freehandStroke = {
      freehand_1: {
        points: [
          { x: 100, y: 300 },
          { x: 110, y: 290 },
          { x: 125, y: 285 },
          { x: 145, y: 290 },
          { x: 170, y: 300 },
          { x: 200, y: 320 },
          { x: 235, y: 340 },
          { x: 270, y: 350 },
          { x: 300, y: 345 },
          { x: 325, y: 335 },
          { x: 345, y: 320 },
          { x: 360, y: 300 },
        ],
        type: 'freehand',
        color: '#333333',
        width: 6,
      },
    };

    window.vectorStrokesByImage.visual_test = freehandStroke;
    window.lineStrokesByImage.visual_test = Object.keys(freehandStroke);
    Object.keys(freehandStroke).forEach(key => {
      window.strokeVisibilityByImage.visual_test[key] = true;
    });

    // Render freehand stroke
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const stroke = freehandStroke.freehand_1;

    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();

    const imageData = canvas.toDataURL('image/png');
    expect(imageData).toMatchImageSnapshot({
      customSnapshotIdentifier: 'freehand-stroke',
      failureThreshold: 0.02,
      failureThresholdType: 'percent',
    });
  });

  test('should render mixed stroke types consistently', async () => {
    const mixedStrokes = {
      straight_1: {
        points: [
          { x: 50, y: 100 },
          { x: 250, y: 100 },
        ],
        type: 'straight',
        color: '#ff0000',
        width: 4,
      },
      curved_1: {
        points: [
          { x: 300, y: 100 },
          { x: 350, y: 50 },
          { x: 450, y: 150 },
          { x: 500, y: 100 },
        ],
        type: 'curved',
        color: '#00ff00',
        width: 4,
      },
      freehand_1: {
        points: [
          { x: 100, y: 200 },
          { x: 120, y: 180 },
          { x: 150, y: 220 },
          { x: 180, y: 190 },
          { x: 220, y: 210 },
        ],
        type: 'freehand',
        color: '#0000ff',
        width: 4,
      },
    };

    window.vectorStrokesByImage.visual_test = mixedStrokes;
    window.lineStrokesByImage.visual_test = Object.keys(mixedStrokes);
    Object.keys(mixedStrokes).forEach(key => {
      window.strokeVisibilityByImage.visual_test[key] = true;
    });

    // Render mixed strokes
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    Object.entries(mixedStrokes).forEach(([label, stroke]) => {
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;

      if (stroke.type === 'straight') {
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
      } else if (stroke.type === 'curved' && stroke.points.length >= 4) {
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        ctx.bezierCurveTo(
          stroke.points[1].x,
          stroke.points[1].y,
          stroke.points[2].x,
          stroke.points[2].y,
          stroke.points[3].x,
          stroke.points[3].y
        );
      } else if (stroke.type === 'freehand') {
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
      }

      ctx.stroke();
    });

    const imageData = canvas.toDataURL('image/png');
    expect(imageData).toMatchImageSnapshot({
      customSnapshotIdentifier: 'mixed-stroke-types',
      failureThreshold: 0.02,
      failureThresholdType: 'percent',
    });
  });
});
