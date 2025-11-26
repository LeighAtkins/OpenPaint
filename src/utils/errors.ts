import { AppError, ErrorCode } from '@/types/app.types';

// ═══════════════════════════════════════════════════════════════════════════
// ERROR FACTORY
// ═══════════════════════════════════════════════════════════════════════════

export function createAppError(
  code: ErrorCode,
  message: string,
  details?: unknown,
  cause?: Error
): AppError {
  return new AppError(code, message, details, cause);
}

export const AppErrors = {
  supabaseNotConfigured: (): AppError =>
    createAppError(
      ErrorCode.SUPABASE_NOT_CONFIGURED,
      'Supabase is not configured. Please check your environment variables.'
    ),

  supabaseQueryError: (message: string, details?: unknown): AppError =>
    createAppError(ErrorCode.SUPABASE_QUERY_ERROR, message, details),

  supabaseStorageError: (message: string, details?: unknown): AppError =>
    createAppError(ErrorCode.SUPABASE_STORAGE_ERROR, message, details),

  canvasNotFound: (id: string): AppError =>
    createAppError(ErrorCode.CANVAS_NOT_FOUND, `Canvas not found: ${id}`),

  canvasSaveFailed: (details?: unknown): AppError =>
    createAppError(ErrorCode.CANVAS_SAVE_FAILED, 'Failed to save canvas', details),

  canvasLoadFailed: (details?: unknown): AppError =>
    createAppError(ErrorCode.CANVAS_LOAD_FAILED, 'Failed to load canvas', details),

  validationError: (message: string, details?: unknown): AppError =>
    createAppError(ErrorCode.VALIDATION_ERROR, message, details),

  networkError: (message = 'Network error occurred'): AppError =>
    createAppError(ErrorCode.NETWORK_ERROR, message),

  unknown: (cause?: unknown): AppError =>
    createAppError(
      ErrorCode.UNKNOWN_ERROR,
      'An unexpected error occurred',
      undefined,
      cause instanceof Error ? cause : undefined
    ),
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return createAppError(ErrorCode.UNKNOWN_ERROR, error.message, undefined, error);
  }

  if (typeof error === 'string') {
    return createAppError(ErrorCode.UNKNOWN_ERROR, error);
  }

  return AppErrors.unknown(error);
}

function isAppError(error: unknown): error is AppError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  timestamp: string;
  data?: unknown;
}

class Logger {
  private static instance: Logger;
  private readonly isDev: boolean;

  private constructor() {
    this.isDev = import.meta.env['DEV'] as boolean;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private log(level: LogLevel, context: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      context,
      message,
      timestamp: new Date().toISOString(),
      data,
    };

    if (this.isDev) {
      const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${context}]`;

      switch (level) {
        case 'debug':
          console.debug(prefix, message, data ?? '');
          break;
        case 'info':
          console.info(prefix, message, data ?? '');
          break;
        case 'warn':
          console.warn(prefix, message, data ?? '');
          break;
        case 'error':
          console.error(prefix, message, data ?? '');
          break;
      }
    }
  }

  debug(context: string, message: string, data?: unknown): void {
    this.log('debug', context, message, data);
  }

  info(context: string, message: string, data?: unknown): void {
    this.log('info', context, message, data);
  }

  warn(context: string, message: string, data?: unknown): void {
    this.log('warn', context, message, data);
  }

  error(context: string, message: string, error?: unknown): void {
    const normalizedError = error ? normalizeError(error) : undefined;
    this.log('error', context, message, normalizedError);
  }
}

export const logger = Logger.getInstance();
