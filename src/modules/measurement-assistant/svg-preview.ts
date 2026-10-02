import { measurementPlacementSchema } from './placement-model';
import { measurementTagShape } from './tag-presentation';
import { buildPlacementOverlayElements } from './overlay-elements';

export function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!
  );
}
/** Photo and overlay share the same image coordinates; no diagram replaces the photo. */
export function renderPlacementSvg(
  input: unknown,
  imageId: string,
  image: { width: number; height: number; url?: string }
): string {
  if (
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  )
    throw new Error('Invalid image dimensions.');
  const plan = measurementPlacementSchema.parse(input);
  const elements = buildPlacementOverlayElements(plan, imageId);
  const point = (p: { x: number; y: number }) =>
    `${(p.x * image.width) / 1000},${(p.y * image.height) / 1000}`;
  const fragments = elements.map((element, index) => {
    const style = element.style!;
    const stroke = (style.strokeWidth! * image.width) / 1000;
    const color = style.strokeColor!;
    const arrow = style.arrowStyle || 'filled';
    const markers =
      arrow === 'none' ? '' : `marker-start="url(#start-${index})" marker-end="url(#end-${index})"`;
    const arrowPath =
      arrow === 'filled' ? `fill="${color}" stroke="none"` : `fill="none" stroke="${color}"`;
    const defs =
      arrow === 'none'
        ? ''
        : `<defs><marker id="start-${index}" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M6 0 L0 3 L6 6${arrow === 'filled' ? ' Z' : ''}" ${arrowPath}/></marker><marker id="end-${index}" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6${arrow === 'filled' ? ' Z' : ''}" ${arrowPath}/></marker></defs>`;
    const geometry = element.curvePoints
      ? `<polyline points="${element.curvePoints.map(point).join(' ')}"/>`
      : `<line x1="${(element.endpoints[0].point.x * image.width) / 1000}" y1="${(element.endpoints[0].point.y * image.height) / 1000}" x2="${(element.endpoints[1].point.x * image.width) / 1000}" y2="${(element.endpoints[1].point.y * image.height) / 1000}"/>`;
    const dash = style.strokeDashArray
      ? `stroke-dasharray="${style.strokeDashArray.map(value => (value * image.width) / 1000).join(' ')}"`
      : '';
    const measurement = plan.measurements.find(m => m.id === element.id)!;
    const value = measurement.value?.trim() || '';
    const label = value ? `${element.displayLabel} = ${value}` : element.displayLabel || '';
    const fontSize = (image.width * 20) / 1000;
    const padding = (image.width * 5) / 1000;
    const shape = measurementTagShape(value);
    const h = fontSize * 1.2 + padding * 2;
    const w = Math.max(h, label.length * fontSize * 0.62 + padding * 2);
    const width = shape === 'circle' ? Math.max(w, h) : w;
    const height = shape === 'circle' ? width : h;
    const cx = (element.label!.cx * image.width) / 1000;
    const cy = (element.label!.cy * image.height) / 1000;
    const vertices = (element.curvePoints || element.endpoints.map(e => e.point)).map(p => ({
      x: (p.x * image.width) / 1000,
      y: (p.y * image.height) / 1000,
    }));
    let anchor = vertices[0];
    let closest = Infinity;
    for (let i = 1; i < vertices.length; i++) {
      const a = vertices[i - 1],
        b = vertices[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / (dx * dx + dy * dy || 1))
      );
      const p = { x: a.x + t * dx, y: a.y + t * dy };
      const distance = Math.hypot(p.x - cx, p.y - cy);
      if (distance < closest) {
        anchor = p;
        closest = distance;
      }
    }
    const dx = anchor.x - cx,
      dy = anchor.y - cy;
    const edgeScale =
      shape === 'circle'
        ? Math.min(1, width / 2 / (Math.hypot(dx, dy) || 1))
        : Math.min(1, width / 2 / (Math.abs(dx) || 1), height / 2 / (Math.abs(dy) || 1));
    const connector = `<line data-tag-connector="${escapeXml(element.id)}" x1="${cx + dx * edgeScale}" y1="${cy + dy * edgeScale}" x2="${anchor.x}" y2="${anchor.y}" stroke="${color}" stroke-width="${(image.width * 1.25) / 1000}" stroke-dasharray="${(image.width * 5) / 1000} ${(image.width * 4) / 1000}"/>`;
    const background =
      shape === 'circle'
        ? `<circle cx="${cx}" cy="${cy}" r="${width / 2}"/>`
        : `<rect x="${cx - width / 2}" y="${cy - height / 2}" width="${width}" height="${height}" rx="${(image.width * 4) / 1000}"/>`;
    const tag = `<g data-tag-shape="${shape}" data-tag-label="${escapeXml(element.displayLabel || '')}" fill="white" stroke="${color}" stroke-width="${(image.width * 1.5) / 1000}">${background}<text x="${cx}" y="${cy + fontSize * 0.35}" text-anchor="middle" font-family="Roboto,Arial,sans-serif" font-size="${fontSize}" font-weight="400" fill="#000000" stroke="none">${escapeXml(label)}</text></g>`;
    return `${defs}<g id="measurement-${index}" data-measurement-id="${escapeXml(element.id)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round" ${markers} ${dash}>${geometry}</g>${connector}${tag}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">${image.url ? `<image href="${escapeXml(image.url)}" width="${image.width}" height="${image.height}"/>` : ''}${fragments.join('')}</svg>`;
}
