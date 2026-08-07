import { expect, test, waitForApp } from './fixtures';

const PRESETS = [
  { id: 'sofa', label: '3-seat' },
  { id: 'two-seat', label: '2-seat' },
  { id: 'chaise', label: 'Chaise' },
  { id: 'corner', label: 'L-shape' },
  { id: 'l-chaise', label: 'L+Chaise' },
  { id: 'ottoman-set', label: '+Ottoman' },
] as const;

const VIEWS = [
  { id: 'front-left', label: 'Left 45°' },
  { id: 'front-right', label: 'Right 45°' },
] as const;

type RenderAudit = {
  preset: string;
  view: string;
  markup: string;
  imageDataUrl: string;
  bounds: { width: number; height: number };
  pieces: Array<{
    id: string;
    kind: string;
    rotation: number;
    layers: string[];
    structuralBacks: number;
    looseBacks: number;
    seatCushions: number;
    armFaces: number;
    armEnds: number;
    armCaps: number;
  }>;
};

test.describe('Sectional Builder 45-degree visual contract', () => {
  test('all presets remain coherent from both product angles', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto('/');
    await waitForApp(page);

    await page.locator('#projectMenuToggle').click();
    await page.locator('#sectionalBuilderBtn').click();
    await expect(page.locator('#sectionalBuilderDialog')).toBeVisible();

    const preview = page.locator('#sbProductPreview');
    const audits: RenderAudit[] = [];

    for (const preset of PRESETS) {
      await page.locator(`[data-sb-preset="${preset.id}"]`).click();

      for (const view of VIEWS) {
        await page.getByRole('tab', { name: view.label }).click();
        await expect(preview).toBeVisible();
        await expect(preview.locator('.sb-product-view')).toHaveAttribute(
          'data-section-view',
          view.id
        );

        const render = await preview.evaluate(
          (element, context) => {
            const root = element.querySelector<SVGGElement>('.sb-product-view');
            if (!root)
              throw new Error(`Missing product view for ${context.preset} ${context.view}`);

            const box = root.getBBox();
            const layerGroups = Array.from(root.querySelectorAll<SVGGElement>('.sb-product-piece'));
            const byPiece = new Map<string, SVGGElement[]>();
            layerGroups.forEach(group => {
              const id = String(group.dataset.pieceId || '');
              const groups = byPiece.get(id) || [];
              groups.push(group);
              byPiece.set(id, groups);
            });

            return {
              bounds: { width: box.width, height: box.height },
              pieces: Array.from(byPiece.entries()).map(([id, groups]) => {
                const first = groups[0];
                const count = (selector: string) =>
                  groups.reduce((sum, group) => sum + group.querySelectorAll(selector).length, 0);
                return {
                  id,
                  kind: String(first.dataset.kind || ''),
                  rotation: Number(first.dataset.rotation || 0),
                  layers: groups.map(group => {
                    const match = Array.from(group.classList).find(name =>
                      name.startsWith('sb-product-layer-')
                    );
                    return String(match || '').replace('sb-product-layer-', '');
                  }),
                  structuralBacks: count('.sb-structural-back'),
                  looseBacks: count('.sb-back-cushion'),
                  seatCushions: count('.sb-seat-cushion'),
                  armFaces: count('.sb-arm-panel, .sb-arm-inner'),
                  armEnds: count('.sb-arm-front, .sb-arm-rear'),
                  armCaps: count('.sb-arm-cap'),
                };
              }),
            };
          },
          { preset: preset.label, view: view.label }
        );

        expect(
          render.bounds.width,
          `${preset.label} ${view.label} should occupy the product stage`
        ).toBeGreaterThan(180);
        expect(
          render.bounds.height,
          `${preset.label} ${view.label} should occupy the product stage`
        ).toBeGreaterThan(90);

        const reviewTargets = preview.locator('[data-sb-review-part]');
        expect(
          await reviewTargets.count(),
          `${preset.label} ${view.label} must expose individually commentable parts`
        ).toBeGreaterThan(8);
        expect(
          await preview
            .locator(
              '.sb-product-piece path:not([data-sb-review-part]), ' +
                '.sb-product-piece polygon:not([data-sb-review-part])'
            )
            .count(),
          `${preset.label} ${view.label} contains anonymous rendered faces`
        ).toBe(0);
        const firstReviewTarget = reviewTargets.first();
        await expect(firstReviewTarget).toHaveAttribute('aria-label', /\w+:\s\w+/);
        await expect(firstReviewTarget).toHaveAttribute('data-sb-review-piece', /.+/);

        for (const piece of render.pieces) {
          expect(piece.layers.filter(layer => layer === 'body').length, {
            message: `${preset.label} ${view.label}: ${piece.kind} must expose body surfaces`,
          }).toBeGreaterThanOrEqual(1);
          expect(piece.seatCushions, {
            message: `${preset.label} ${view.label}: ${piece.kind} must have one seat cushion`,
          }).toBe(1);

          if (piece.kind === 'ottoman') {
            expect(piece.structuralBacks, {
              message: `${preset.label} ${view.label}: ottomans cannot grow a back`,
            }).toBe(0);
            expect(piece.looseBacks, {
              message: `${preset.label} ${view.label}: ottomans cannot grow a back cushion`,
            }).toBe(0);
          } else {
            expect(piece.structuralBacks, {
              message: `${preset.label} ${view.label}: ${piece.kind} needs a structural back`,
            }).toBeGreaterThanOrEqual(1);
          }

          if (piece.rotation === 90) {
            expect(piece.looseBacks, {
              message:
                `${preset.label} ${view.label}: a camera-facing perpendicular return keeps ` +
                'its loose back cushion — the canonical camera sees its upholstered face',
            }).toBe(1);
          }
          if (piece.rotation === 270) {
            expect(piece.looseBacks, {
              message:
                `${preset.label} ${view.label}: a return viewed from its rear shell must ` +
                'not show its loose back cushion through the frame',
            }).toBe(0);
          }

          if (
            piece.kind === 'left-arm' ||
            piece.kind === 'right-arm' ||
            piece.kind === 'left-arm-chaise' ||
            piece.kind === 'right-arm-chaise'
          ) {
            expect(piece.armFaces, {
              message: `${preset.label} ${view.label}: ${piece.kind} needs one visible arm face`,
            }).toBe(1);
            expect(piece.armEnds, {
              message: `${preset.label} ${view.label}: ${piece.kind} needs one camera-visible arm end`,
            }).toBe(1);
            expect(piece.armCaps, {
              message: `${preset.label} ${view.label}: ${piece.kind} needs an arm top`,
            }).toBe(1);
          }
        }

        audits.push({
          preset: preset.label,
          view: view.label,
          markup: await preview.innerHTML(),
          imageDataUrl: `data:image/png;base64,${(
            await preview.screenshot({
              animations: 'disabled',
              caret: 'hide',
            })
          ).toString('base64')}`,
          ...render,
        });
      }
    }

    for (const preset of PRESETS) {
      const left = audits.find(audit => audit.preset === preset.label && audit.view === 'Left 45°');
      const right = audits.find(
        audit => audit.preset === preset.label && audit.view === 'Right 45°'
      );
      expect(left, `${preset.label} is missing its Left 45° audit`).toBeTruthy();
      expect(right, `${preset.label} is missing its Right 45° audit`).toBeTruthy();
      if (!left || !right) continue;

      const widthDrift =
        Math.abs(left.bounds.width - right.bounds.width) /
        Math.max(left.bounds.width, right.bounds.width);
      const heightDrift =
        Math.abs(left.bounds.height - right.bounds.height) /
        Math.max(left.bounds.height, right.bounds.height);
      expect(widthDrift, `${preset.label} paired views have mismatched widths`).toBeLessThan(0.08);
      expect(heightDrift, `${preset.label} paired views have mismatched heights`).toBeLessThan(
        0.08
      );
      expect(right.markup, `${preset.label} paired views rendered identically`).not.toBe(
        left.markup
      );
    }

    await page.locator('#sectionalBuilderDialog [data-sb-close]').click();
    await expect(page.locator('#sectionalBuilderDialog')).toBeHidden();

    await page.evaluate(rendered => {
      const previous = document.getElementById('sectional45ReviewSheet');
      previous?.remove();

      const sheet = document.createElement('section');
      sheet.id = 'sectional45ReviewSheet';
      sheet.setAttribute('aria-label', 'Sectional Builder 45 degree review sheet');
      sheet.innerHTML = `
        <header>
          <div>
            <strong>Sectional Builder</strong>
            <span>45° visual contract</span>
          </div>
          <p>Left and right views must read as the same physical assembly.</p>
        </header>
        <main>
          ${rendered
            .map(
              item => `
                <article>
                  <div class="review-label">
                    <strong>${item.preset}</strong>
                    <span>${item.view}</span>
                  </div>
                  <div class="review-render">
                    <img src="${item.imageDataUrl}" alt="${item.preset} ${item.view}">
                  </div>
                </article>
              `
            )
            .join('')}
        </main>
      `;
      const style = document.createElement('style');
      style.dataset.sectionalReview = 'true';
      style.textContent = `
        #sectional45ReviewSheet {
          position: absolute;
          inset: 0 auto auto 0;
          z-index: 2147483647;
          width: 1200px;
          box-sizing: border-box;
          padding: 20px;
          background: #eef2f1;
          color: #17201f;
          font-family: Arial, sans-serif;
        }
        #sectional45ReviewSheet header {
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 4px 14px;
          border-bottom: 1px solid #c9d2d0;
        }
        #sectional45ReviewSheet header div { display: flex; align-items: baseline; gap: 10px; }
        #sectional45ReviewSheet header strong { font-size: 22px; }
        #sectional45ReviewSheet header span,
        #sectional45ReviewSheet header p { color: #60706d; font-size: 12px; }
        #sectional45ReviewSheet main {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
          padding-top: 14px;
        }
        #sectional45ReviewSheet article {
          overflow: hidden;
          border: 1px solid #c9d2d0;
          border-radius: 6px;
          background: #fff;
        }
        #sectional45ReviewSheet .review-label {
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          border-bottom: 1px solid #dce3e1;
          font-size: 12px;
        }
        #sectional45ReviewSheet .review-label span { color: #53736c; }
        #sectional45ReviewSheet .review-render {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 365px;
          background: #cbdcf8;
        }
        #sectional45ReviewSheet .review-render img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
      `;
      document.head.append(style);
      document.body.append(sheet);
    }, audits);

    const reviewSheet = page.locator('#sectional45ReviewSheet');
    await expect(reviewSheet).toBeVisible();
    await expect(reviewSheet).toHaveScreenshot('sectional-builder-45-review-sheet.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.004,
    });
  });
});
