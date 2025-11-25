import type {
  FabricObject,
  FabricPath,
  FabricRect,
  FabricCircle,
  FabricImage,
  FabricText,
  FabricGroup,
  FabricCanvasJSON,
  AppError,
} from './app.types';

import { ErrorCode } from './app.types';

// ═══════════════════════════════════════════════════════════════════════════
// FABRIC OBJECT TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════

export function isFabricPath(obj: FabricObject): obj is FabricPath {
  return obj.type === 'path';
}

export function isFabricRect(obj: FabricObject): obj is FabricRect {
  return obj.type === 'rect';
}

export function isFabricCircle(obj: FabricObject): obj is FabricCircle {
  return obj.type === 'circle';
}

export function isFabricImage(obj: FabricObject): obj is FabricImage {
  return obj.type === 'image';
}

export function isFabricText(obj: FabricObject): obj is FabricText {
  return obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox';
}

export function isFabricGroup(obj: FabricObject): obj is FabricGroup {
  return obj.type === 'group';
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON VALIDATION GUARDS
// ═══════════════════════════════════════════════════════════════════════════

export function isFabricCanvasJSON(value: unknown): value is FabricCanvasJSON {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  
  const obj = value as Record<string, unknown>;
  
  return (
    typeof obj['version'] === 'string' &&
    Array.isArray(obj['objects'])
  );
}

export function isValidCanvasId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  // UUID v4 pattern
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(id);
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════

export function isAppError(error: unknown): error is AppError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  
  const obj = error as Record<string, unknown>;
  
  return (
    typeof obj['code'] === 'string' &&
    Object.values(ErrorCode).includes(obj['code'] as ErrorCode) &&
    typeof obj['message'] === 'string'
  );
}

export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════

export function isNonNullable<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSERTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

export function assertDefined<T>(
  value: T | null | undefined,
  message = 'Value is null or undefined'
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

export function assertString(
  value: unknown,
  message = 'Value is not a string'
): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
}