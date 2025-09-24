import { ViewTransform, ImagePoint, CanvasPoint } from "@/types/geometry";

export function createViewTransform(
  imageW: number, imageH: number, cssW: number, cssH: number,
  dpr = globalThis.devicePixelRatio ?? 1
): ViewTransform {
  const cw = cssW * dpr, ch = cssH * dpr;
  const s  = Math.min(cw / imageW, ch / imageH);
  const ox = (cw - imageW * s) / 2;
  const oy = (ch - imageH * s) / 2;

  return {
    scale: s, ox, oy, dpr,
    toCanvas: ({x, y}: ImagePoint): CanvasPoint => ({ cx: x * s + ox, cy: y * s + oy }),
    toImage:  ({cx, cy}: CanvasPoint): ImagePoint => ({ x: (cx - ox) / s, y: (cy - oy) / s }),
    screenToImage: (el, sx, sy) => {
      const r = el.getBoundingClientRect();
      const cx = (sx - r.left) * dpr;
      const cy = (sy - r.top)  * dpr;
      return { x: (cx - ox) / s, y: (cy - oy) / s };
    }
  };
}
