function visibleControls(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]'
    )
  ).filter(control => control.getClientRects().length > 0);
}

function bindDisclosure(
  wrapper: HTMLElement,
  trigger: HTMLElement,
  panel: HTMLElement,
  openClass: string
) {
  const isOpen = () => wrapper.classList.contains(openClass);
  const close = () => wrapper.classList.remove(openClass);
  const sync = () => {
    trigger.setAttribute('aria-expanded', String(isOpen()));
    if (!isOpen() && panel.contains(document.activeElement)) trigger.focus({ preventScroll: true });
  };
  trigger.setAttribute('aria-controls', panel.id);
  sync();
  new MutationObserver(sync).observe(wrapper, { attributes: true, attributeFilter: ['class'] });

  // Focusing a flyout button on mouse down can scroll the compact toolbar
  // before mouse up and send the click to a different tool.
  panel.addEventListener('mousedown', event => {
    if (event.button === 0 && (event.target as Element).closest('button')) event.preventDefault();
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    wrapper.classList.add(openClass);
    const last = event.key === 'ArrowUp';
    requestAnimationFrame(() => {
      const controls = visibleControls(panel);
      (last ? controls.at(-1) : controls[0])?.focus({ preventScroll: true });
    });
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus({ preventScroll: true });
      return;
    }
    // Text fields keep their native arrow keys, including number steppers.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
      return;
    const controls = visibleControls(panel).filter(
      control => control.closest('.shape-menu, .toolbar-menu-panel') === panel
    );
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      event.stopPropagation();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? controls.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
      controls[next]?.focus();
    }
    if (event.key === 'ArrowRight') {
      const child = (event.target as HTMLElement).closest<HTMLElement>('.tool-flyout');
      const childPanel = child?.querySelector<HTMLElement>(':scope > .shape-menu');
      if (child && childPanel && child !== wrapper) {
        event.preventDefault();
        event.stopPropagation();
        child.classList.add('shape-open');
        visibleControls(childPanel)[0]?.focus();
      }
    }
    if (event.key === 'ArrowLeft' && wrapper.classList.contains('tool-flyout')) {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus({ preventScroll: true });
    }
  });
  wrapper.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !wrapper.contains(event.relatedTarget)) close();
  });
}

function mountStrokeControls() {
  const body = document.querySelector<HTMLElement>(
    '#lineStylePopoverPanel .elements-appearance-body, #elementsAppearance .elements-appearance-body'
  );
  if (!body) return;
  const section = document.createElement('div');
  section.className = 'workspace-stroke-controls';
  section.innerHTML = '<div class="elements-appearance-section-title">Color</div>';
  body.prepend(section);
  const swatches = document.querySelector<HTMLElement>('#tbLeft .color-swatches');
  if (swatches) {
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', 'Annotation color');
    section.appendChild(swatches);
  }

  // Keep the live specimen preview at the very top of the Style panel so color,
  // width, arrowheads, and pattern changes are immediately legible.
  const previewWrap = document.getElementById('lineStylePreviewWrap');
  if (previewWrap && previewWrap.parentElement !== body) {
    body.prepend(previewWrap);
  }

  // Place Start/End arrowhead toggles directly alongside Line width for fast access.
  const arrows = document.getElementById('lineStyleQuickArrowButtons');
  const strokeRow = document.getElementById('lineStyleStrokeRow');
  if (arrows && strokeRow) {
    const arrowGroup = document.createElement('div');
    arrowGroup.className = 'workspace-inline-arrows';
    const label = document.createElement('span');
    label.className = 'workspace-line-width';
    label.textContent = 'Ends';
    arrowGroup.append(label, arrows);
    strokeRow.appendChild(arrowGroup);
  } else if (arrows) {
    const row = document.createElement('div');
    row.className = 'workspace-line-options';
    const label = document.createElement('span');
    label.className = 'workspace-line-width';
    label.textContent = 'Arrowheads';
    row.append(label, arrows);
    section.appendChild(row);
  }

  // Group Tag, Label & Connector controls into a separated progressive-disclosure
  // section so visual stroke styling stays scannable without hiding advanced options.
  const tagTitle = body.querySelector<HTMLElement>('.elements-appearance-tag-title');
  if (tagTitle && !body.querySelector('#styleTagDisclosure')) {
    const disclosure = document.createElement('details');
    disclosure.id = 'styleTagDisclosure';
    disclosure.className = 'style-disclosure';

    const summary = document.createElement('summary');
    summary.className = 'style-disclosure-summary';
    summary.innerHTML =
      '<span class="style-disclosure-title">Tags, labels &amp; connectors</span><span id="styleTagDisclosureMeta" class="style-disclosure-meta">20 px · Solid</span><svg class="style-disclosure-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';

    const content = document.createElement('div');
    content.className = 'style-disclosure-body';

    const siblings: Element[] = [];
    let cursor = tagTitle.nextElementSibling;
    while (cursor) {
      const next = cursor.nextElementSibling;
      // Never pull unrelated measurement checks into the visual Tag disclosure.
      if (cursor.querySelector('#openMeasurementRelationsBtn')) {
        const elementsControls = document.getElementById('elementsControls');
        if (elementsControls) elementsControls.appendChild(cursor);
      } else {
        siblings.push(cursor);
      }
      cursor = next;
    }
    siblings.forEach(node => content.appendChild(node));
    disclosure.append(summary, content);
    tagTitle.replaceWith(disclosure);

    const meta = summary.querySelector<HTMLElement>('#styleTagDisclosureMeta');
    const syncTagSummary = () => {
      if (!meta) return;
      const sizeText = document.getElementById('currentTagSize')?.textContent?.trim() || '20';
      const bgText =
        document.getElementById('labelBackgroundToggleBtn')?.textContent?.trim() || 'Solid';
      meta.textContent = `${sizeText} px · ${bgText}`;
    };
    const tagSizeEl = document.getElementById('currentTagSize');
    const labelBgEl = document.getElementById('labelBackgroundToggleBtn');
    const summaryObserver = new MutationObserver(syncTagSummary);
    if (tagSizeEl)
      summaryObserver.observe(tagSizeEl, { childList: true, characterData: true, subtree: true });
    if (labelBgEl)
      summaryObserver.observe(labelBgEl, { childList: true, characterData: true, subtree: true });
    syncTagSummary();
  }

  document.querySelectorAll<HTMLElement>('.elements-quick-style-field').forEach((field, index) => {
    const label = document.createElement('span');
    label.className = 'workspace-mini-label';
    label.textContent = ['Line', 'Arrow', 'Tag'][index] || '';
    field.prepend(label);
  });
}

function bindCompactPanels() {
  const compact = window.matchMedia('(max-width: 768px)');
  const mobile = window.matchMedia('(max-width: 768px)');
  const panels = [
    {
      panel: document.getElementById('strokePanel'),
      body: document.getElementById('elementsBody'),
      toggle: document.getElementById('toggleStrokePanel'),
    },
    {
      panel: document.getElementById('imagePanel'),
      body: document.getElementById('imagePanelContent'),
      toggle: document.getElementById('toggleImagePanel'),
    },
  ];
  const isOpen = (item: (typeof panels)[number]) =>
    !!item.panel &&
    !!item.body &&
    !item.panel.classList.contains('collapsed') &&
    !item.panel.classList.contains('minimized') &&
    !item.body.classList.contains('hidden');
  const collapse = () => {
    if (!compact.matches) return;
    panels.forEach(item => {
      if (isOpen(item)) item.toggle?.click();
    });
  };
  compact.addEventListener('change', collapse);

  panels.forEach(item => {
    if (!item.panel || !item.toggle) return;
    const sync = () => item.toggle?.setAttribute('aria-expanded', String(isOpen(item)));
    new MutationObserver(sync).observe(item.panel, {
      attributes: true,
      attributeFilter: ['class', 'aria-expanded'],
    });
    sync();
    item.toggle.addEventListener('click', () => {
      if (!mobile.matches || !isOpen(item)) return;
      panels.forEach(other => {
        if (other !== item && isOpen(other)) other.toggle?.click();
      });
    });
  });
  requestAnimationFrame(collapse);
}

export function initWorkspaceControls(): void {
  if (document.body.dataset.workspacePresentation === 'ready') return;
  // App.setupUI runs on a deferred tick and owns the canonical style controls.
  if (!document.getElementById('lineStylePopoverBtn')) {
    const ready = new MutationObserver(() => {
      if (!document.getElementById('lineStylePopoverBtn')) return;
      ready.disconnect();
      requestAnimationFrame(initWorkspaceControls);
    });
    ready.observe(document.body, { childList: true, subtree: true });
    return;
  }
  document.body.dataset.workspacePresentation = 'ready';
  mountStrokeControls();
  bindCompactPanels();

  document.querySelectorAll<HTMLElement>('.shape-toggle, .toolbar-menu').forEach(wrapper => {
    const panel = wrapper.querySelector<HTMLElement>(
      ':scope > .shape-menu, :scope > .toolbar-menu-panel'
    );
    const trigger = wrapper.querySelector<HTMLElement>(':scope > button');
    if (panel && trigger)
      bindDisclosure(
        wrapper,
        trigger,
        panel,
        wrapper.classList.contains('toolbar-menu') ? 'open' : 'shape-open'
      );
  });

  document.querySelectorAll<HTMLButtonElement>('#tbLeft > [data-drawing-mode]').forEach(button => {
    const sync = () =>
      button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    new MutationObserver(sync).observe(button, { attributes: true, attributeFilter: ['class'] });
    sync();
  });

  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.elements-view-tab'));
  const syncTabs = () =>
    tabs.forEach(tab => {
      tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
    });
  tabs.forEach(tab => {
    new MutationObserver(syncTabs).observe(tab, {
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const direction = getComputedStyle(tab).direction === 'rtl' ? -1 : 1;
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? direction : -direction) + tabs.length) %
              tabs.length;
      tabs[next].click();
      tabs[next].focus();
    });
  });
  syncTabs();

  document.querySelectorAll<HTMLButtonElement>('button[title]').forEach(button => {
    if (!button.textContent?.trim() && !button.hasAttribute('aria-label'))
      button.setAttribute('aria-label', button.title);
  });
  const project = document.getElementById('projectMenuPanel');
  // A project popover includes an editable name and grouped commands, not menu items.
  project?.removeAttribute('role');
  project?.querySelectorAll('[role="menuitem"]').forEach(item => item.removeAttribute('role'));

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'tbtn workspace-save-project';
  save.textContent = 'Save project';
  save.title = 'Save an editable project archive (⌘/Ctrl S)';
  save.addEventListener('click', () => document.getElementById('saveProjectTop')?.click());
  document.getElementById('tbRight')?.appendChild(save);
  document
    .getElementById('quickSaveBtn')
    ?.setAttribute('title', 'Export the current image; use the arrow for PDF and batch exports');
  document.getElementById('canvasControls')?.setAttribute('aria-label', 'Canvas view and export');
  document.getElementById('toggleStrokePanel')?.setAttribute('aria-controls', 'elementsBody');
  document.getElementById('toggleImagePanel')?.setAttribute('aria-controls', 'imagePanelContent');
}
