/**
 * Visual regression tests for canvas rendering.
 *
 * Each test injects a self-contained HTML page with a <canvas>,
 * draws via page.evaluate(), then compares with toHaveScreenshot().
 * No web server is required.
 */
import { test, expect } from '@playwright/test';

const CANVAS_HTML = `
<!DOCTYPE html>
<html>
<head><style>body{margin:0;background:#fff}</style></head>
<body><canvas id="c" width="800" height="600"></canvas></body>
</html>`;

test.describe('Visual Regression Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(CANVAS_HTML);
  });

  test('should render straight lines consistently', async ({ page }) => {
    await page.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 800, 600);

      const lines: Array<{ from: [number, number]; to: [number, number]; color: string }> = [
        { from: [100, 100], to: [700, 100], color: '#ff0000' },
        { from: [400, 50], to: [400, 550], color: '#00ff00' },
        { from: [100, 500], to: [700, 100], color: '#0000ff' },
      ];

      lines.forEach(({ from, to, color }) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.moveTo(from[0], from[1]);
        ctx.lineTo(to[0], to[1]);
        ctx.stroke();
      });
    });

    const canvas = page.locator('#c');
    await expect(canvas).toHaveScreenshot('straight-lines.png');
  });

  test('should render arrows consistently', async ({ page }) => {
    await page.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 800, 600);

      // Dual-head arrow
      const drawArrow = (
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        color: string,
        size: number,
        startArrow: boolean,
        endArrow: boolean
      ) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const angle = Math.atan2(y2 - y1, x2 - x1);

        if (endArrow) {
          ctx.save();
          ctx.translate(x2, y2);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-size, -size / 2);
          ctx.lineTo(-size, size / 2);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          ctx.restore();
        }

        if (startArrow) {
          ctx.save();
          ctx.translate(x1, y1);
          ctx.rotate(angle + Math.PI);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-size, -size / 2);
          ctx.lineTo(-size, size / 2);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          ctx.restore();
        }
      };

      drawArrow(100, 200, 300, 200, '#ff0000', 15, true, true);
      drawArrow(400, 200, 600, 200, '#00ff00', 20, false, true);
    });

    const canvas = page.locator('#c');
    await expect(canvas).toHaveScreenshot('arrows.png');
  });

  test('should render dotted lines consistently', async ({ page }) => {
    await page.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 800, 600);

      const dashed: Array<{ y: number; width: number; pattern: number[] }> = [
        { y: 100, width: 3, pattern: [3, 3] },
        { y: 200, width: 5, pattern: [10, 5] },
        { y: 300, width: 4, pattern: [2, 4, 10, 4] },
      ];

      dashed.forEach(({ y, width, pattern }) => {
        ctx.beginPath();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = width;
        ctx.setLineDash(pattern);
        ctx.moveTo(100, y);
        ctx.lineTo(700, y);
        ctx.stroke();
      });
    });

    const canvas = page.locator('#c');
    await expect(canvas).toHaveScreenshot('dotted-lines.png');
  });

  test('should render labels with measurements consistently', async ({ page }) => {
    await page.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 800, 600);

      // Lines
      ctx.beginPath();
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 5;
      ctx.moveTo(100, 200);
      ctx.lineTo(400, 200);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 5;
      ctx.moveTo(100, 300);
      ctx.lineTo(400, 400);
      ctx.stroke();

      // Labels
      ctx.fillStyle = '#000';
      ctx.font = '14px Arial';
      ctx.fillText('A1: 24"', 220, 190);
      ctx.fillText('A2: 18 1/2"', 220, 340);
    });

    const canvas = page.locator('#c');
    await expect(canvas).toHaveScreenshot('labels-with-measurements.png');
  });

  test('should render freehand strokes consistently', async ({ page }) => {
    await page.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 800, 600);

      const points = [
        [100, 300],
        [110, 290],
        [125, 285],
        [145, 290],
        [170, 300],
        [200, 320],
        [235, 340],
        [270, 350],
        [300, 345],
        [325, 335],
        [345, 320],
        [360, 300],
      ];

      ctx.beginPath();
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(points[0]![0]!, points[0]![1]!);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i]![0]!, points[i]![1]!);
      }
      ctx.stroke();
    });

    const canvas = page.locator('#c');
    await expect(canvas).toHaveScreenshot('freehand-stroke.png');
  });

  test('should render mixed stroke types consistently', async ({ page }) => {
    await page.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 800, 600);

      // Straight line
      ctx.beginPath();
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 4;
      ctx.setLineDash([]);
      ctx.moveTo(50, 100);
      ctx.lineTo(250, 100);
      ctx.stroke();

      // Bezier curve
      ctx.beginPath();
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 4;
      ctx.moveTo(300, 100);
      ctx.bezierCurveTo(350, 50, 450, 150, 500, 100);
      ctx.stroke();

      // Freehand
      const freehand = [
        [100, 200],
        [120, 180],
        [150, 220],
        [180, 190],
        [220, 210],
      ];
      ctx.beginPath();
      ctx.strokeStyle = '#0000ff';
      ctx.lineWidth = 4;
      ctx.moveTo(freehand[0]![0]!, freehand[0]![1]!);
      for (let i = 1; i < freehand.length; i++) {
        ctx.lineTo(freehand[i]![0]!, freehand[i]![1]!);
      }
      ctx.stroke();
    });

    const canvas = page.locator('#c');
    await expect(canvas).toHaveScreenshot('mixed-stroke-types.png');
  });
});
