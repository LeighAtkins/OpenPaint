// ═══════════════════════════════════════════════════════════════════════════
// FABRIC.JS TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FabricObjectBase {
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

export type CanvasEventType =
  | 'object:added'
  | 'object:modified'
  | 'object:removed'
  | 'selection:created'
  | 'selection:updated'
  | 'selection:cleared'
  | 'canvas:saved'
  | 'canvas:loaded'
  | 'history:undo'
  | 'history:redo';

export interface CanvasEvent<T = unknown> {
  type: CanvasEventType;
  timestamp: number;
  data: T;
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum ErrorCode {
  // Supabase errors
  SUPABASE_NOT_CONFIGURED = 'SUPABASE_NOT_CONFIGURED',
  SUPABASE_AUTH_ERROR = 'SUPABASE_AUTH_ERROR',
  SUPABASE_QUERY_ERROR = 'SUPABASE_QUERY_ERROR',
  SUPABASE_STORAGE_ERROR = 'SUPABASE_STORAGE_ERROR',
  
  // Canvas errors
  CANVAS_NOT_FOUND = 'CANVAS_NOT_FOUND',
  CANVAS_SAVE_FAILED = 'CANVAS_SAVE_FAILED',
  CANVAS_LOAD_FAILED = 'CANVAS_LOAD_FAILED',
  CANVAS_INVALID_STATE = 'CANVAS_INVALID_STATE',
  
  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  
  // Generic
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  cause?: Error;
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