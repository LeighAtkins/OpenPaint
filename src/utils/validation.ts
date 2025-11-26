import { z } from 'zod';
import { type Result, Result as R } from './result';
import { AppError, ErrorCode } from '@/types/app.types';

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const DimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const BrushSettingsSchema = z.object({
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
  width: z.number().min(1).max(100),
  opacity: z.number().min(0).max(1),
});

export const CanvasNameSchema = z
  .string()
  .min(1, 'Canvas name is required')
  .max(100, 'Canvas name too long')
  .trim();

export const UUIDSchema = z.string().uuid();

export const FabricObjectBaseSchema = z.object({
  type: z.string(),
  left: z.number().optional(),
  top: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fill: z.string().nullable().optional(),
  stroke: z.string().nullable().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  angle: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
});

export const FabricCanvasJSONSchema = z.object({
  version: z.string(),
  objects: z.array(FabricObjectBaseSchema),
  background: z.string().optional(),
});

export const SaveCanvasPayloadSchema = z.object({
  name: CanvasNameSchema,
  fabricJSON: FabricCanvasJSONSchema,
  thumbnail: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export function validate<T>(schema: z.ZodSchema<T>, data: unknown): Result<T, AppError> {
  const result = schema.safeParse(data);

  if (result.success) {
    return R.ok(result.data);
  }

  return R.err(
    new AppError(ErrorCode.VALIDATION_ERROR, 'Validation failed', result.error.flatten())
  );
}

export function validateAsync<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): Promise<Result<T, AppError>> {
  return Promise.resolve(validate(schema, data));
}

// Type inference helpers
export type Position = z.infer<typeof PositionSchema>;
export type Dimensions = z.infer<typeof DimensionsSchema>;
export type BrushSettings = z.infer<typeof BrushSettingsSchema>;
