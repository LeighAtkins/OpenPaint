// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL TYPE EXTENSIONS
// ═══════════════════════════════════════════════════════════════════════════

declare global {
  interface ErrorConstructor {
    captureStackTrace?(targetObject: object, constructorOpt?: Function): void;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FABRIC.JS TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FabricObjectBase {
  // Custom properties
  id?: string;
  selectable?: boolean;
  evented?: boolean;

  // Standard Fabric.js properties
  type: string;
  version: string;
  originX: 'left' | 'center' | 'right';
  originY: 'top' | 'center' | 'bottom';
  left: number;
  top: number;
  width: number;
  height: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  strokeDashArray: number[] | null;
  strokeLineCap: 'butt' | 'round' | 'square';
  strokeLineJoin: 'bevel' | 'round' | 'miter';
  strokeMiterLimit: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  shadow: FabricShadow | null;
  visible: boolean;
  backgroundColor: string;
  fillRule: 'nonzero' | 'evenodd';
  paintFirst: 'fill' | 'stroke';
  globalCompositeOperation: GlobalCompositeOperation;
  skewX: number;
  skewY: number;
}

export interface FabricShadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  affectStroke: boolean;
}

export interface FabricPath extends FabricObjectBase {
  type: 'path';
  path: Array<[string, ...number[]]>;
}

export interface FabricRect extends FabricObjectBase {
  type: 'rect';
  rx: number;
  ry: number;
}

export interface FabricCircle extends FabricObjectBase {
  type: 'circle';
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface FabricImage extends FabricObjectBase {
  type: 'image';
  src: string;
  crossOrigin: 'anonymous' | 'use-credentials' | '' | null;
  filters: FabricFilter[];
  cropX: number;
  cropY: number;
}

export interface FabricFilter {
  type: string;
  [key: string]: unknown;
}

export interface FabricText extends FabricObjectBase {
  type: 'text' | 'i-text' | 'textbox';
  text: string;
  fontSize: number;
  fontWeight: string | number;
  fontFamily: string;
  fontStyle: 'normal' | 'italic' | 'oblique';
  underline: boolean;
  overline: boolean;
  linethrough: boolean;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  charSpacing: number;
}

export interface FabricGroup extends FabricObjectBase {
  type: 'group';
  objects: FabricObject[];
}

export type FabricObject =
  | FabricPath
  | FabricRect
  | FabricCircle
  | FabricImage
  | FabricText
  | FabricGroup
  | (FabricObjectBase & { type: string });

export interface FabricCanvasJSON {
  version: string;
  objects: FabricObject[];
  background?: string;
  backgroundImage?: FabricImage;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS STATE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ToolType =
  | 'select'
  | 'pencil'
  | 'brush'
  | 'eraser'
  | 'rectangle'
  | 'circle'
  | 'line'
  | 'text'
  | 'pan'
  | 'zoom';

export interface BrushSettings {
  color: string;
  width: number;
  opacity: number;
}

export interface CanvasState {
  currentTool: ToolType;
  brushSettings: BrushSettings;
  zoom: number;
  panOffset: Position;
  selectedObjectIds: string[];
  isDrawing: boolean;
  isDirty: boolean;
}

export interface Position {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface BoundingBox extends Position, Dimensions {}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Fabric.js native events
export type FabricEventType =
  | 'object:added'
  | 'object:modified'
  | 'object:removed'
  | 'selection:created'
  | 'selection:updated'
  | 'selection:cleared'
  | 'path:created'
  | 'mouse:down'
  | 'mouse:move'
  | 'mouse:up';

// Canvas lifecycle events
export type CanvasEventType =
  | 'canvas:state-changed'
  | 'canvas:tool-changed'
  | 'canvas:brush-changed'
  | 'canvas:viewport-changed'
  | 'canvas:selection-changed'
  | 'canvas:drawing-started'
  | 'canvas:drawing-ended'
  | 'canvas:saved'
  | 'canvas:loaded';

// History events
export type HistoryEventType = 'history:undo' | 'history:redo';

// Combined type for all application events
export type AppEventType = FabricEventType | CanvasEventType | HistoryEventType;

export interface CanvasEvent<T = unknown> {
  type: AppEventType;
  timestamp: number;
  data: T;
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum ErrorCode {
  // Supabase errors
  SUPABASE_NOT_CONFIGURED = 'SUPABASE_NOT_CONFIGURED',
  SUPABASE_CONNECTION_FAILED = 'SUPABASE_CONNECTION_FAILED',
  SUPABASE_QUERY_ERROR = 'SUPABASE_QUERY_ERROR',
  SUPABASE_STORAGE_ERROR = 'SUPABASE_STORAGE_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',

  // Authentication errors
  AUTH_ERROR = 'AUTH_ERROR',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  EMAIL_NOT_CONFIRMED = 'EMAIL_NOT_CONFIRMED',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',

  // Canvas errors
  CANVAS_NOT_FOUND = 'CANVAS_NOT_FOUND',
  CANVAS_SAVE_FAILED = 'CANVAS_SAVE_FAILED',
  CANVAS_LOAD_FAILED = 'CANVAS_LOAD_FAILED',
  CANVAS_INVALID_STATE = 'CANVAS_INVALID_STATE',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  OPTIMISTIC_LOCK_ERROR = 'OPTIMISTIC_LOCK_ERROR',

  // Generic
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

/**
 * Application error class with structured error handling
 */
export class AppError extends Error {
  public override readonly name = 'AppError';
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public override readonly cause: Error | undefined;

  constructor(code: ErrorCode, message: string, details?: unknown, cause?: Error) {
    super(message);
    this.code = code;
    this.details = details;
    this.cause = cause;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Create a JSON representation of the error
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      stack: this.stack,
    };
  }

  /**
   * Check if this error has a specific error code
   */
  hasCode(code: ErrorCode): boolean {
    return this.code === code;
  }

  /**
   * Create a user-friendly error message
   */
  getUserMessage(): string {
    switch (this.code) {
      case ErrorCode.SUPABASE_NOT_CONFIGURED:
        return 'Application is not configured correctly. Please contact support.';
      case ErrorCode.INVALID_CREDENTIALS:
        return 'Invalid email or password. Please try again.';
      case ErrorCode.EMAIL_NOT_CONFIRMED:
        return 'Please check your email and confirm your account before signing in.';
      case ErrorCode.EMAIL_ALREADY_EXISTS:
        return 'An account with this email already exists. Try signing in instead.';
      case ErrorCode.VALIDATION_ERROR:
        return this.message; // Validation messages are already user-friendly
      case ErrorCode.CANVAS_SAVE_FAILED:
        return 'Failed to save your work. Please try again.';
      case ErrorCode.STORAGE_ERROR:
        return 'Failed to upload file. Please check your connection and try again.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE RESULT TYPES (Will be enhanced when we add Supabase types)
// ═══════════════════════════════════════════════════════════════════════════

export interface SaveCanvasPayload {
  name: string;
  fabricJSON: FabricCanvasJSON;
  thumbnail?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
