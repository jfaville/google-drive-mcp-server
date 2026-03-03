/**
 * Zod validation schemas for Revisions tool inputs
 */

import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants.js';

export const ListRevisionsInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  page_size: z.number().int().min(1).max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Number of revisions to return (1-${MAX_PAGE_SIZE}, default: ${DEFAULT_PAGE_SIZE})`),
  page_token: z.string().optional()
    .describe('Page token from previous response for pagination'),
}).strict();

export type ListRevisionsInput = z.infer<typeof ListRevisionsInputSchema>;

export const GetRevisionInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  revision_id: z.string().min(1).describe('The revision ID'),
  include_content: z.boolean().default(false)
    .describe('Whether to export and include the revision content as plain text (default: false)'),
}).strict();

export type GetRevisionInput = z.infer<typeof GetRevisionInputSchema>;
