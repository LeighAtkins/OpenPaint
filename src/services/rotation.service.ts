import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';

export interface RotationConfig {
  angle: number;
  duration: number;
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
}

export interface CanvasDimensions {
  width: number;
  height: number;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
}

export interface RotationState {
  angle: number;
  isRotating: boolean;
  animationId: number | null;
}

export interface DrawingLayer {
  container: HTMLDivElement | null;
  svg: SVGElement | null;
  rotation: number;
}

export class RotationService {
  private rotationStates = new Map<string, RotationState>();
  private canvasDimensions = new Map<string, CanvasDimensions>();
  private drawingLayers = new Map<string, DrawingLayer>();

  constructor() {}

  getCanvasDimensions(canvasElement: HTMLCanvasElement): CanvasDimensions | null {
    const canvas = this.getFabricCanvas(canvasElement);
    if (!canvas) return null;

    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const rect = canvas.getCenter();

    return {
      width: canvas.width,
      height: canvas.height,
      left: rect.left,
      top: rect.top,
      scaleX: vpt[0],
      scaleY: vpt[3],
    };
  }

  initializeRotation(canvasId: string): Result<RotationState, AppError> {
    const existingState = this.rotationStates.get(canvasId);
    if (existingState) {
      return Result.ok(existingState);
    }

    const state: RotationState = {
      angle: 0,
      isRotating: false,
      animationId: null,
    };

    this.rotationStates.set(canvasId, state);
    return Result.ok(state);
  }

  setRotation(
    canvasId: string,
    angle: number,
    options?: { animate?: boolean; duration?: number }
  ): Result<boolean, AppError> {
    try {
      const state = this.rotationStates.get(canvasId);
      if (!state) {
        return Result.err(
          new AppError(
            ErrorCode.CANVAS_NOT_FOUND,
            `Rotation state not found for canvas: ${canvasId}`
          )
        );
      }

      if (state.isRotating && options?.animate) {
        return Result.err(
          new AppError(ErrorCode.CANVAS_INVALID_STATE, 'Rotation already in progress')
        );
      }

      const targetAngle = angle % 360;

      if (options?.animate) {
        this.animateRotation(canvasId, targetAngle, options.duration || 500);
      } else {
        state.angle = targetAngle;
        this.applyRotation(canvasId, targetAngle);
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to set rotation: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  rotate(
    canvasId: string,
    deltaAngle: number,
    options?: { animate?: boolean; duration?: number }
  ): Result<boolean, AppError> {
    const state = this.rotationStates.get(canvasId);
    if (!state) {
      return Result.err(
        new AppError(ErrorCode.CANVAS_NOT_FOUND, `Rotation state not found for canvas: ${canvasId}`)
      );
    }

    return this.setRotation(canvasId, state.angle + deltaAngle, options);
  }

  getRotation(canvasId: string): Result<number, AppError> {
    const state = this.rotationStates.get(canvasId);
    if (!state) {
      return Result.err(
        new AppError(ErrorCode.CANVAS_NOT_FOUND, `Rotation state not found for canvas: ${canvasId}`)
      );
    }

    return Result.ok(state.angle);
  }

  resetRotation(canvasId: string, options?: { animate?: boolean }): Result<boolean, AppError> {
    return this.setRotation(canvasId, 0, options);
  }

  setDrawingLayer(
    canvasId: string,
    container: HTMLDivElement | null,
    svg: SVGElement | null
  ): void {
    this.drawingLayers.set(canvasId, {
      container,
      svg,
      rotation: 0,
    });
  }

  syncDrawingLayer(canvasId: string, angle: number): void {
    const layer = this.drawingLayers.get(canvasId);
    if (!layer || !layer.svg || !layer.container) return;

    layer.rotation = angle;
    layer.svg.style.transform = `rotate(${angle}deg)`;
  }

  cleanup(canvasId: string): void {
    const state = this.rotationStates.get(canvasId);
    if (state?.animationId) {
      cancelAnimationFrame(state.animationId);
    }

    this.rotationStates.delete(canvasId);
    this.canvasDimensions.delete(canvasId);
    this.drawingLayers.delete(canvasId);
  }

  private applyRotation(canvasId: string, angle: number): void {
    const canvas = this.getFabricCanvasById(canvasId);
    if (canvas) {
      canvas.set('angle', angle);
      canvas.renderAll();
    }

    this.syncDrawingLayer(canvasId, angle);
  }

  private animateRotation(canvasId: string, targetAngle: number, duration: number): void {
    const state = this.rotationStates.get(canvasId);
    if (!state) return;

    const startAngle = state.angle;
    const startTime = performance.now();
    const deltaAngle = targetAngle - startAngle;

    state.isRotating = true;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const easedProgress = this.easeInOutCubic(progress);
      const currentAngle = startAngle + deltaAngle * easedProgress;

      state.angle = currentAngle;
      this.applyRotation(canvasId, currentAngle);

      if (progress < 1) {
        state.animationId = requestAnimationFrame(animate);
      } else {
        state.isRotating = false;
        state.animationId = null;
      }
    };

    state.animationId = requestAnimationFrame(animate);
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private getFabricCanvas(canvasElement: HTMLCanvasElement): any {
    if (!window.fabric) return null;
    const canvas = window.fabric.Canvas.getCanvas(canvasElement.id);
    return canvas || null;
  }

  private getFabricCanvasById(canvasId: string): any {
    if (!window.fabric) return null;
    const canvasElements = document.querySelectorAll('canvas');
    for (const el of canvasElements) {
      if (el.id.includes(canvasId)) {
        const canvas = window.fabric.Canvas.getCanvas(el.id);
        if (canvas) return canvas;
      }
    }
    return null;
  }
}

export const rotationService = new RotationService();
