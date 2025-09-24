export type Px = number;
export interface ImagePoint { x: Px; y: Px }
export interface CanvasPoint { cx: Px; cy: Px }
export interface ViewTransform {
  scale: number; ox: number; oy: number; dpr: number;
  toCanvas(p: ImagePoint): CanvasPoint;
  toImage(p: CanvasPoint): ImagePoint;
  screenToImage(el: HTMLCanvasElement, sx: number, sy: number): ImagePoint;
}
