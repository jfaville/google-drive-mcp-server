/**
 * Zod validation schemas for Comments & Replies tool inputs
 */

import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants.js';

export const ListCommentsInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  page_size: z.number().int().min(1).max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Number of comments to return (1-${MAX_PAGE_SIZE}, default: ${DEFAULT_PAGE_SIZE})`),
  page_token: z.string().optional()
    .describe('Page token from previous response for pagination'),
  include_resolved: z.boolean().default(true)
    .describe('Whether to include resolved comments (default: true)')
}).strict();

export type ListCommentsInput = z.infer<typeof ListCommentsInputSchema>;

export const GetCommentInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  comment_id: z.string().min(1).describe('The comment ID'),
  include_replies: z.boolean().default(true)
    .describe('Whether to include the full reply thread (default: true)')
}).strict();

export type GetCommentInput = z.infer<typeof GetCommentInputSchema>;

export const AddCommentInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  content: z.string().min(1).describe('The comment text'),
  document_id: z.string().optional()
    .describe('The Google Doc ID (same as file_id for Docs). Required for anchored comments.'),
  start_index: z.number().int().min(1).optional()
    .describe('Start index (1-based, from gdocs_get_document) of the text to anchor the comment to'),
  end_index: z.number().int().min(2).optional()
    .describe('End index (exclusive) of the text to anchor the comment to'),
  quoted_text: z.string().optional()
    .describe('The exact quoted text being commented on. If start_index/end_index are provided and this is omitted, it will be extracted from the document automatically.')
}).strict().refine(
  data => {
    const hasAnchorFields = data.start_index !== undefined || data.end_index !== undefined;
    if (hasAnchorFields) {
      return data.document_id !== undefined && data.start_index !== undefined && data.end_index !== undefined;
    }
    return true;
  },
  { message: 'For anchored comments, document_id, start_index, and end_index must all be provided' }
).refine(
  data => {
    if (data.start_index !== undefined && data.end_index !== undefined) {
      return data.end_index > data.start_index;
    }
    return true;
  },
  { message: 'end_index must be greater than start_index' }
);

export type AddCommentInput = z.infer<typeof AddCommentInputSchema>;

export const UpdateCommentInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  comment_id: z.string().min(1).describe('The comment ID to update'),
  content: z.string().min(1).describe('The new comment text')
}).strict();

export type UpdateCommentInput = z.infer<typeof UpdateCommentInputSchema>;

export const DeleteCommentInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  comment_id: z.string().min(1).describe('The comment ID to delete')
}).strict();

export type DeleteCommentInput = z.infer<typeof DeleteCommentInputSchema>;

export const ReplyToCommentInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  comment_id: z.string().min(1).describe('The comment ID to reply to'),
  content: z.string().min(1).describe('The reply text')
}).strict();

export type ReplyToCommentInput = z.infer<typeof ReplyToCommentInputSchema>;

export const ResolveCommentInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  comment_id: z.string().min(1).describe('The comment ID to resolve')
}).strict();

export type ResolveCommentInput = z.infer<typeof ResolveCommentInputSchema>;

export const ListRepliesInputSchema = z.object({
  file_id: z.string().min(1).describe('The Drive file ID'),
  comment_id: z.string().min(1).describe('The comment ID'),
  page_size: z.number().int().min(1).max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Number of replies to return (1-${MAX_PAGE_SIZE}, default: ${DEFAULT_PAGE_SIZE})`),
  page_token: z.string().optional()
    .describe('Page token from previous response for pagination')
}).strict();

export type ListRepliesInput = z.infer<typeof ListRepliesInputSchema>;
