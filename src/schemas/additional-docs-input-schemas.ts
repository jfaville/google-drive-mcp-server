/**
 * Zod validation schemas for additional Google Docs tool inputs
 * (insert table, insert page break, insert image)
 */

import { z } from 'zod';

export const InsertTableInputSchema = z.object({
  document_id: z.string().min(1).describe('The Google Doc ID'),
  rows: z.number().int().min(1).max(50)
    .describe('Number of rows (1-50)'),
  columns: z.number().int().min(1).max(20)
    .describe('Number of columns (1-20)'),
  index: z.number().int().min(1).optional()
    .describe('1-based index at which to insert the table'),
  insert_at_end: z.boolean().default(false)
    .describe('If true, insert at the end of the document'),
  tab_id: z.string().optional()
    .describe('Tab ID to insert into. If omitted, inserts into the first tab.'),
}).strict().refine(
  data => (data.index !== undefined) !== data.insert_at_end,
  { message: 'Provide either index or set insert_at_end to true, but not both' }
);

export type InsertTableInput = z.infer<typeof InsertTableInputSchema>;

export const InsertPageBreakInputSchema = z.object({
  document_id: z.string().min(1).describe('The Google Doc ID'),
  index: z.number().int().min(1)
    .describe('1-based index at which to insert the page break'),
  segment_id: z.string().default('')
    .describe('Segment ID (default: empty string for body)'),
  tab_id: z.string().optional()
    .describe('Tab ID to insert into. If omitted, inserts into the first tab.'),
}).strict();

export type InsertPageBreakInput = z.infer<typeof InsertPageBreakInputSchema>;

export const InsertImageInputSchema = z.object({
  document_id: z.string().min(1).describe('The Google Doc ID'),
  image_url: z.string().url().describe('The URL of the image to insert (must be publicly accessible)'),
  index: z.number().int().min(1).optional()
    .describe('1-based index at which to insert the image'),
  insert_at_end: z.boolean().default(false)
    .describe('If true, insert at the end of the document'),
  width: z.number().positive().optional()
    .describe('Image width in points (72 points = 1 inch)'),
  height: z.number().positive().optional()
    .describe('Image height in points (72 points = 1 inch)'),
  tab_id: z.string().optional()
    .describe('Tab ID to insert into. If omitted, inserts into the first tab.'),
}).strict().refine(
  data => (data.index !== undefined) !== data.insert_at_end,
  { message: 'Provide either index or set insert_at_end to true, but not both' }
);

export type InsertImageInput = z.infer<typeof InsertImageInputSchema>;

export const InsertFootnoteCommentInputSchema = z.object({
  document_id: z.string().min(1).describe('The Google Doc ID'),
  index: z.number().int().min(1)
    .describe('1-based body index where the footnote reference should appear'),
  content: z.string().min(1)
    .describe('The comment text to insert into the footnote'),
  tab_id: z.string().optional()
    .describe('Tab ID to insert into. If omitted, inserts into the first tab.'),
}).strict();

export type InsertFootnoteCommentInput = z.infer<typeof InsertFootnoteCommentInputSchema>;
