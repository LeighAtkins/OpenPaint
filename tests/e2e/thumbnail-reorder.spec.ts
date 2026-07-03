import { test, expect, waitForApp } from './fixtures';

test.describe('Thumbnail drag reordering', () => {
  test('visible sidebar drag keeps gallery, active image, bindings, and saved order together', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(async () => {
      const manager = window.app?.projectManager;
      if (!manager) throw new Error('ProjectManager unavailable');
      const seeds = [
        ['order-a', '#fee2e2'],
        ['order-b', '#dcfce7'],
        ['order-c', '#dbeafe'],
      ];
      for (const [label, color] of seeds) {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 300;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context unavailable');
        context.fillStyle = color;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#0f172a';
        context.font = 'bold 36px sans-serif';
        context.fillText(label, 32, 64);
        const imageUrl = canvas.toDataURL('image/png');
        await manager.addImage(label, imageUrl, { refreshBackground: false });
        window.addImageToSidebar?.(imageUrl, label, `${label}.png`);
      }
      manager.setProjectMetadata?.({
        measurementGuideModelSelections: [
          { id: 'ORDER-A::front', code: 'ORDER-A', variant: 'front' },
          { id: 'ORDER-B::back', code: 'ORDER-B', variant: 'back' },
        ],
        measurementGuideModelLinksByImage: {
          'order-a': 'ORDER-A::front',
          'order-b': 'ORDER-B::back',
        },
        measurementGuideModelLinksByScope: {
          'order-a': 'ORDER-A::front',
          'order-b': 'ORDER-B::back',
        },
      });
    });

    // Let first-image registration timers settle, then choose the image whose
    // identity must remain active while a different card is reordered.
    await page.waitForTimeout(250);
    await page.evaluate(() => window.app?.projectManager?.switchView?.('order-b', true));
    await expect
      .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
      .toBe('order-b');

    await expect(page.locator('#imageList .image-container[data-label="order-a"]')).toBeAttached();
    await page.evaluate(() => {
      const source = document.querySelector('#imageList .image-container[data-label="order-a"]');
      const target = document.querySelector('#imageList .image-container[data-label="order-c"]');
      if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        throw new Error('Drag endpoints unavailable');
      }
      const transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    });

    const inspect = () =>
      page.evaluate(() => {
        const galleryData = window.imageGallery?.getData?.() || window.imageGalleryData || [];
        const galleryOrder = galleryData.map(
          item => item?.original?.label || item?.label || item?.name || ''
        );
        const sidebarOrder = Array.from(
          document.querySelectorAll('#imageList .image-container[data-label]')
        ).map(element => element.getAttribute('data-label') || '');
        const metadata = window.app?.projectManager?.getProjectMetadata?.() || {};
        return {
          galleryOrder: galleryOrder.filter(label => label.startsWith('order-')),
          sidebarOrder: sidebarOrder.filter(label => label.startsWith('order-')),
          orderedImageLabels: (window.orderedImageLabels || []).filter(label =>
            label.startsWith('order-')
          ),
          currentViewId: window.app?.projectManager?.currentViewId,
          links: metadata.measurementGuideModelLinksByImage || {},
        };
      });

    expect(await inspect()).toEqual({
      galleryOrder: ['order-b', 'order-c', 'order-a'],
      sidebarOrder: ['order-b', 'order-c', 'order-a'],
      orderedImageLabels: ['order-b', 'order-c', 'order-a'],
      currentViewId: 'order-b',
      links: {
        'order-a': 'ORDER-A::front',
        'order-b': 'ORDER-B::back',
      },
    });

    const saved = await page.evaluate(() =>
      window.app?.projectManager?.getProjectData?.({ embedImages: true })
    );
    expect(saved?.viewOrder?.filter((label: string) => label.startsWith('order-'))).toEqual([
      'order-b',
      'order-c',
      'order-a',
    ]);

    await page.evaluate(data => window.app?.projectManager?.loadProjectFromData?.(data), saved);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 15_000 });
    await page.waitForTimeout(700);
    expect(await inspect()).toMatchObject({
      galleryOrder: ['order-b', 'order-c', 'order-a'],
      sidebarOrder: ['order-b', 'order-c', 'order-a'],
      orderedImageLabels: ['order-b', 'order-c', 'order-a'],
      links: {
        'order-a': 'ORDER-A::front',
        'order-b': 'ORDER-B::back',
      },
    });
  });

  test('native reorder keeps the active thumbnail centered and scroll-select usable', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.setViewportSize({ width: 1600, height: 900 });

    await page.evaluate(async () => {
      const manager = window.app?.projectManager;
      if (!manager) throw new Error('ProjectManager unavailable');
      for (let index = 0; index < 6; index += 1) {
        const label = `drag-${index + 1}`;
        const source = document.createElement('canvas');
        source.width = 360;
        source.height = 240;
        const context = source.getContext('2d')!;
        context.fillStyle = `hsl(${index * 55} 70% 78%)`;
        context.fillRect(0, 0, source.width, source.height);
        context.fillStyle = '#0f172a';
        context.font = 'bold 42px sans-serif';
        context.fillText(label, 24, 64);
        const url = source.toDataURL('image/png');
        await manager.addImage(label, url, { refreshBackground: false });
        window.addImageToSidebar?.(url, label, `${label}.png`);
      }
      window.__suppressScrollSelectUntil = Date.now() + 2000;
      window.__imageListProgrammaticScrollUntil = Date.now() + 2000;
      await manager.whenIdle?.();
      const toggle = document.getElementById('scrollSelectToggle') as HTMLInputElement | null;
      if (toggle && !toggle.checked) toggle.click();
      await manager.switchView('drag-3', true);
      await manager.whenIdle?.();
      const imagePanel = document.getElementById('imagePanel');
      if (imagePanel?.classList.contains('collapsed')) {
        document.getElementById('toggleImagePanel')?.click();
      }
      const list = document.getElementById('imageList');
      const active = list?.querySelector<HTMLElement>('[data-label="drag-3"]');
      active?.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const list = document.getElementById('imageList');
      list
        ?.querySelector<HTMLElement>('[data-label="drag-3"]')
        ?.scrollIntoView({ behavior: 'auto', block: 'center' });
      window.__suppressScrollSelectUntil = 0;
      window.__imageListProgrammaticScrollUntil = 0;
    });
    await expect
      .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
      .toBe('drag-3');

    const source = page.locator('#imageList .image-container[data-label="drag-3"]');
    const target = page.locator('#imageList .image-container[data-label="drag-4"]');
    await source.dragTo(target);
    await page.waitForTimeout(700);

    const afterDrop = await page.evaluate(() => {
      const list = document.getElementById('imageList')!;
      const active = list.querySelector<HTMLElement>('[data-label="drag-3"]')!;
      const listRect = list.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      return {
        currentViewId: window.app?.projectManager?.currentViewId,
        centerDelta: activeRect.top + activeRect.height / 2 - (listRect.top + listRect.height / 2),
        order: Array.from(list.querySelectorAll<HTMLElement>('.image-container')).map(
          item => item.dataset.label
        ),
        scrollEnabled: window.scrollToSelectEnabled,
      };
    });

    expect(afterDrop.currentViewId).toBe('drag-3');
    expect(Math.abs(afterDrop.centerDelta)).toBeLessThan(6);
    expect(afterDrop.order.filter(Boolean)).toEqual([
      'drag-1',
      'drag-2',
      'drag-4',
      'drag-3',
      'drag-5',
      'drag-6',
    ]);
    expect(afterDrop.scrollEnabled).toBe(true);

    await page.evaluate(() => {
      const list = document.getElementById('imageList')!;
      const next = list.querySelector<HTMLElement>('[data-label="drag-5"]')!;
      const listRect = list.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      list.scrollTop += nextRect.top + nextRect.height / 2 - (listRect.top + listRect.height / 2);
      window.__suppressScrollSelectUntil = 0;
      window.__imageListProgrammaticScrollUntil = 0;
      list.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect
      .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
      .toBe('drag-5');
  });
});
