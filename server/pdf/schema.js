import { z } from 'zod';

const measurementRowSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().max(120).optional().default(''),
  fieldName: z.string().max(160).optional(),
});

const reviewMeasurementSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().max(120).optional().default(''),
});

const reviewViewSchema = z.object({
  viewId: z.string().min(1).max(180),
  title: z.string().min(1).max(180),
  measurements: z.array(reviewMeasurementSchema).max(200).default([]),
});

const reviewManifestSchema = z.object({
  version: z.literal(1),
  projectName: z.string().max(160).optional().default(''),
  views: z.array(reviewViewSchema).max(100).default([]),
});

// Measurement guide gallery diagrams embedded by the client as data URLs,
// keyed by worksheet row shape (T, L, B, W).
const cushionDiagramSchema = z.object({
  src: z.string().max(200_000),
  labels: z.array(z.string().min(1).max(8)).max(16).default([]),
});

const measurementCardSchema = z.object({
  title: z.string().min(1).max(120),
  rows: z.array(measurementRowSchema).max(30).default([]),
});

const imageItemSchema = z.object({
  title: z.string().max(120).optional().default(''),
  src: z.string().min(1),
});

const groupedSectionSchema = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(180).optional().default(''),
  mainImage: imageItemSchema,
  mainMeasurements: z.array(measurementRowSchema).max(60).default([]),
  relatedFrames: z.array(imageItemSchema).max(60).default([]),
  relatedMeasurementCards: z.array(measurementCardSchema).max(30).default([]),
  cushionQuantity: z.string().max(2).optional(),
  customerNote: z.string().max(90).optional(),
});

const comparisonGroupSchema = z.object({
  label: z.string().min(1).max(120),
  items: z.array(imageItemSchema).min(2).max(4),
});

const reportSchema = z.object({
  projectName: z.string().min(1).max(160),
  namingLine: z.string().max(220).optional().default(''),
  unit: z.enum(['inch', 'cm']).optional().default('inch'),
  groups: z.array(groupedSectionSchema).max(100).default([]),
  includeCushionWorksheet: z.boolean().optional().default(false),
  cushionDiagrams: z.record(cushionDiagramSchema).optional().default({}),
  comparisonGroups: z.array(comparisonGroupSchema).max(24).default([]),
  reviewManifest: reviewManifestSchema.optional(),
});

export const pdfRenderRequestSchema = z
  .object({
    source: z.enum(['report', 'html', 'project']).default('report'),
    html: z.string().min(1).optional(),
    report: reportSchema.optional(),
    project: z.unknown().optional(),
    options: z
      .object({
        renderer: z.enum(['pdf-lib', 'puppeteer', 'hybrid']).optional(),
        pageSize: z.enum(['a4', 'letter']).default('letter'),
        filename: z.string().max(200).optional(),
        landscape: z.boolean().default(false),
        injectFormFields: z.boolean().default(true),
      })
      .default({ pageSize: 'letter', landscape: false, injectFormFields: true }),
  })
  .superRefine((value, ctx) => {
    if (value.source === 'html' && !value.html) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['html'],
        message: 'html is required when source is html',
      });
    }
    if (value.source === 'report' && !value.report) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['report'],
        message: 'report is required when source is report',
      });
    }
    if (value.source === 'project' && !value.project) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project'],
        message: 'project is required when source is project',
      });
    }
  });

export function sanitizePdfFilename(filename, fallback = 'openpaint-report.pdf') {
  const base = String(filename || '')
    .trim()
    .replace(/[^A-Za-z0-9 _.-]+/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  if (!base) return fallback;
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}
