import { z } from 'zod';

export const LEAN_INCEPTION_COLUMN_KEYS = [
  'vision',
  'problem',
  'objective',
  'csd_matrix',
  'market_research',
  'market_opportunities',
  'personas',
  'user_journey',
  'features',
  'business_rules',
  'ideation',
  'acceptance_criteria',
] as const;

export const LeanInceptionColumnKeySchema = z.enum(LEAN_INCEPTION_COLUMN_KEYS);
export type LeanInceptionColumnKey = z.infer<typeof LeanInceptionColumnKeySchema>;

export const LeanInceptionConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type LeanInceptionConfidence = z.infer<typeof LeanInceptionConfidenceSchema>;

export const LeanInceptionColumnStatusSchema = z.enum([
  'complete',
  'partial',
  'insufficient',
  'not_identified',
]);
export type LeanInceptionColumnStatus = z.infer<typeof LeanInceptionColumnStatusSchema>;

export const LeanInceptionCardSchema = z.object({
  id: z.string(),
  inception_id: z.string(),
  document_id: z.string(),
  column_key: LeanInceptionColumnKeySchema,
  title: z.string().min(5).max(120),
  content: z.string().min(1),
  confidence: LeanInceptionConfidenceSchema,
  source_anchor: z.string().min(1).max(280),
  source_line: z.number().int().positive().nullable(),
  extraction_id: z.string(),
  created_at: z.string(),
});
export type LeanInceptionCard = z.infer<typeof LeanInceptionCardSchema>;

export const LeanInceptionDocumentSchema = z.object({
  id: z.string(),
  inception_id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  byte_size: z.number().int().nonnegative(),
  content_hash: z.string(),
  ingested_at: z.string(),
  last_extracted_at: z.string().nullable(),
  extraction_status: z.enum(['pending', 'extracting', 'extracted', 'failed']),
  extraction_error: z.string().nullable(),
  card_count: z.number().int().nonnegative(),
});
export type LeanInceptionDocument = z.infer<typeof LeanInceptionDocumentSchema>;

export const LeanInceptionColumnSnapshotSchema = z.object({
  status: LeanInceptionColumnStatusSchema,
  cards: z.array(LeanInceptionCardSchema),
});
export type LeanInceptionColumnSnapshot = z.infer<typeof LeanInceptionColumnSnapshotSchema>;

export const LeanInceptionStateSchema = z.object({
  inception_id: z.string(),
  project_id: z.string(),
  documents: z.array(LeanInceptionDocumentSchema),
  columns: z.record(LeanInceptionColumnKeySchema, LeanInceptionColumnSnapshotSchema),
});
export type LeanInceptionState = z.infer<typeof LeanInceptionStateSchema>;

export const ExtractDocumentInputSchema = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
  mime_type: z.enum(['text/markdown', 'text/plain', 'image/png', 'image/jpeg']),
});
export type ExtractDocumentInput = z.infer<typeof ExtractDocumentInputSchema>;

export const ExtractDocumentsRequestSchema = z.object({
  documents: z.array(ExtractDocumentInputSchema).min(1).max(20),
  runtime: z.string().optional(),
});
export type ExtractDocumentsRequest = z.infer<typeof ExtractDocumentsRequestSchema>;

export const LeanInceptionExtractionInfoSchema = z.object({
  runtime: z.string(),
  model: z.string().nullable(),
  prompt_version: z.number().int().positive(),
  duration_ms: z.number().int().nonnegative(),
  prompt_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
});
export type LeanInceptionExtractionInfo = z.infer<typeof LeanInceptionExtractionInfoSchema>;

export const ExtractDocumentsResponseSchema = z.object({
  state: LeanInceptionStateSchema,
  extractions: z.array(LeanInceptionExtractionInfoSchema),
});
export type ExtractDocumentsResponse = z.infer<typeof ExtractDocumentsResponseSchema>;

export const RemoveDocumentResponseSchema = z.object({
  state: LeanInceptionStateSchema,
});
export type RemoveDocumentResponse = z.infer<typeof RemoveDocumentResponseSchema>;

export const LEAN_INCEPTION_ERROR_CODES = [
  'UNSUPPORTED_FORMAT',
  'DOCUMENT_TOO_LARGE',
  'EMPTY_DOCUMENT',
  'PROJECT_NOT_FOUND',
  'RUNTIME_UNAVAILABLE',
  'EXTRACTION_TIMEOUT',
  'EXTRACTION_FAILED',
  'INVALID_JSON_OUTPUT',
  'SCHEMA_VALIDATION_FAILED',
  'DOCUMENT_NOT_FOUND',
] as const;

export const LeanInceptionErrorCodeSchema = z.enum(LEAN_INCEPTION_ERROR_CODES);
export type LeanInceptionErrorCode = z.infer<typeof LeanInceptionErrorCodeSchema>;

export const LeanInceptionErrorSchema = z.object({
  code: LeanInceptionErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type LeanInceptionError = z.infer<typeof LeanInceptionErrorSchema>;
