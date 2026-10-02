export interface Point {
  x: number;
  y: number;
}

export function arrowHeadPoints(tip: Point, direction: Point, length: number, width: number) {
  const magnitude = Math.hypot(direction.x, direction.y) || 1;
  const x = direction.x / magnitude;
  const y = direction.y / magnitude;
  const base = { x: tip.x - x * length, y: tip.y - y * length };
  const halfWidth = width / 2;
  return [
    tip,
    { x: base.x - y * halfWidth, y: base.y + x * halfWidth },
    { x: base.x + y * halfWidth, y: base.y - x * halfWidth },
  ];
}

export function straightArrowGeometry(
  start: Point,
  end: Point,
  requestedHeadLength: number,
  requestedHeadWidth: number
) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const direction = {
    x: distance ? (end.x - start.x) / distance : 1,
    y: distance ? (end.y - start.y) / distance : 0,
  };
  const headLength = Math.min(requestedHeadLength, distance * 0.28);
  const headWidth = Math.min(requestedHeadWidth, headLength * 1.25);
  return {
    startHead: arrowHeadPoints(start, { x: -direction.x, y: -direction.y }, headLength, headWidth),
    endHead: arrowHeadPoints(end, direction, headLength, headWidth),
    shaftStart: {
      x: start.x + direction.x * headLength,
      y: start.y + direction.y * headLength,
    },
    shaftEnd: {
      x: end.x - direction.x * headLength,
      y: end.y - direction.y * headLength,
    },
  };
}
