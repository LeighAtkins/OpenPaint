import template from '../../assets/guides/CS3B-RA-HB-floor.svg?raw';

interface Point {
  x: number;
  y: number;
}

interface FloorChecks {
  enabled: boolean;
  points: Record<string, Point>;
  note: string;
}

const defaultNote = 'Measure vertically to the floor from each dot.';

export function mountFloorChecks(
  container: HTMLElement,
  saved: Partial<FloorChecks> | null,
  save: (state: FloorChecks) => void,
  onToggle: () => void
) {
  const section = document.createElement('section');
  section.style.margin = '12px 0';
  section.innerHTML = `
    <label><input type="checkbox"> Add long-skirt floor checks</label>
    <details><summary>Edit floor checks · CS3B-RA-HB</summary>
      <p>Drag a top endpoint, or focus it and use the arrow keys. Each line ends at the floor.</p>
      <div class="floor-check-diagram">${template}</div>
      <label>Customer instructions <textarea maxlength="90" rows="2" style="width:100%"></textarea></label>
    </details>`;
  container.after(section);
  const enabled = section.querySelector('input')!;
  const details = section.querySelector('details')!;
  const note = section.querySelector('textarea')!;
  const svg = section.querySelector('svg')!;
  svg.style.cssText = 'width:100%;height:auto;display:block;touch-action:none';
  const points: Record<string, Point> = {};
  enabled.checked = saved?.enabled === true;
  details.hidden = !enabled.checked;
  note.value = typeof saved?.note === 'string' ? saved.note : defaultNote;
  const persist = () => save({ enabled: enabled.checked, points: { ...points }, note: note.value });
  enabled.onchange = () => {
    details.hidden = !enabled.checked;
    details.open = enabled.checked;
    persist();
    onToggle();
  };
  note.oninput = persist;

  const groups = Array.from(svg.querySelectorAll<SVGGElement>('g[data-code]'));
  for (const group of groups) {
    const code = group.dataset.code!;
    const panel = group.ownerSVGElement!;
    const bounds = panel.viewBox.baseVal;
    const handle = group.querySelector<SVGGElement>('[data-endpoint]')!;
    const label = group.querySelector('[data-label]')!;
    const line = group.querySelector('line')!;
    const ground = Number(line.getAttribute('y2'));
    const apply = (point: Point) => {
      const x = Math.max(bounds.x, Math.min(bounds.x + bounds.width, point.x));
      const y = Math.max(bounds.y, Math.min(ground - 1, point.y));
      points[code] = { x, y };
      group.setAttribute('transform', `translate(${x} 0)`);
      handle.setAttribute('transform', `translate(0 ${y})`);
      label.setAttribute('transform', `translate(0 ${(y + ground) / 2})`);
      line.setAttribute('y1', String(y));
    };
    const stored = saved?.points?.[code];
    apply(
      stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)
        ? stored
        : { x: group.transform.baseVal.getItem(0).matrix.e, y: Number(line.getAttribute('y1')) }
    );
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-label', `${code} top endpoint`);
    handle.style.cursor = 'grab';
    handle.onpointerdown = event => {
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    handle.onpointermove = event => {
      const matrix = panel.getScreenCTM();
      if (!matrix || !handle.hasPointerCapture(event.pointerId)) return;
      apply(new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()));
    };
    handle.onlostpointercapture = persist;
    handle.onkeydown = event => {
      const delta = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[
        event.key
      ];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      apply({ x: points[code].x + delta[0], y: points[code].y + delta[1] });
      persist();
    };
  }

  return {
    enabled,
    async reportGroup() {
      const copy = svg.cloneNode(true) as SVGSVGElement;
      copy.removeAttribute('style');
      const image = new Image();
      image.src =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(new XMLSerializer().serializeToString(copy));
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1480;
      canvas.height = 1760;
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      return {
        title: 'Long-skirt floor checks',
        mainImage: {
          title: 'CS3B-RA-HB · Heights to the floor',
          src: canvas.toDataURL('image/png'),
        },
        mainMeasurements: groups.map(group => ({
          label: `${group.dataset.code} to floor`,
          value: '',
          fieldName: `m_${group.dataset.code}_floor`,
        })),
        customerNote: note.value,
      };
    },
  };
}
