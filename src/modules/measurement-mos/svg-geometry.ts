/** SVG user-space transforms, including Illustrator's nested matrix exports. */
export type SvgMatrix = [number, number, number, number, number, number];
const identity = (): SvgMatrix => [1, 0, 0, 1, 0, 0];
export function multiplySvgMatrices(a: SvgMatrix, b: SvgMatrix): SvgMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function parseSvgTransform(value: string): SvgMatrix {
  let matrix = identity();
  for (const match of value.matchAll(
    /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  )) {
    const n = (match[2].match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || []).map(Number);
    if (!n.length || n.some(v => !Number.isFinite(v))) continue;
    let next = identity();
    const angle = (n[0] * Math.PI) / 180;
    switch (match[1]) {
      case 'matrix':
        if (n.length !== 6) continue;
        next = n as SvgMatrix;
        break;
      case 'translate':
        next[4] = n[0];
        next[5] = n[1] ?? 0;
        break;
      case 'scale':
        next[0] = n[0];
        next[3] = n[1] ?? n[0];
        break;
      case 'rotate': {
        const c = Math.cos(angle),
          s = Math.sin(angle),
          x = n[1] ?? 0,
          y = n[2] ?? 0;
        next = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
        break;
      }
      case 'skewX':
        next[2] = Math.tan(angle);
        break;
      case 'skewY':
        next[1] = Math.tan(angle);
        break;
    }
    matrix = multiplySvgMatrices(matrix, next);
  }
  return matrix;
}
export function getSvgElementTransform(el: Element): SvgMatrix {
  const ancestors: Element[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) ancestors.unshift(node);
  return ancestors.reduce(
    (matrix, node) =>
      multiplySvgMatrices(matrix, parseSvgTransform(node.getAttribute('transform') || '')),
    identity()
  );
}
export function transformSvgPoint(matrix: SvgMatrix, x: number, y: number) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}
