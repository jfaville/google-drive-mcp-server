/**
 * Zod output schemas for Comments & Replies MCP tool structured responses.
 */

import { z } from 'zod';

const ReplyOutputSchema = z.object({
  id: z.string().describe('Reply ID'),
  content: z.string().describe('Reply text'),
  author: z.string().optional().describe('Author display name'),
  createdTime: z.string().optional().describe('ISO creation timestamp'),
  modifiedTime: z.string().optional().describe('ISO last-modified timestamp'),
  action: z.string().optional().describe('Action taken (e.g., "resolve", "reopen")'),
});

const CommentOutputSchema = z.object({
  id: z.string().describe('Comment ID'),
  content: z.string().describe('Comment text'),
  author: z.string().optional().describe('Author display name'),
  createdTime: z.string().optional().describe('ISO creation timestamp'),
  modifiedTime: z.string().optional().describe('ISO last-modified timestamp'),
  resolved: z.boolean().describe('Whether the comment is resolved'),
  quotedText: z.string().optional().describe('The text the comment is anchored to'),
  replies: z.array(ReplyOutputSchema).optional().describe('Reply thread'),
});

export const CommentDetailOutputSchema = {
  id: z.string().describe('Comment ID'),
  content: z.string().describe('Comment text'),
  author: z.string().optional().describe('Author display name'),
  createdTime: z.string().optional().describe('ISO creation timestamp'),
  modifiedTime: z.string().optional().describe('ISO last-modified timestamp'),
  resolved: z.boolean().describe('Whether the comment is resolved'),
  quotedText: z.string().optional().describe('The text the comment is anchored to'),
  replies: z.array(ReplyOutputSchema).optional().describe('Reply thread'),
};

export const CommentListOutputSchema = {
  count: z.number().describe('Number of comments returned'),
  comments: z.array(CommentOutputSchema).describe('Array of comments'),
  has_more: z.boolean().describe('Whether more results are available'),
  next_page_token: z.string().optional().describe('Token for the next page'),
};

export const ReplyDetailOutputSchema = {
  id: z.string().describe('Reply ID'),
  content: z.string().describe('Reply text'),
  author: z.string().optional().describe('Author display name'),
  createdTime: z.string().optional().describe('ISO creation timestamp'),
  action: z.string().optional().describe('Action taken'),
};

export const ReplyListOutputSchema = {
  count: z.number().describe('Number of replies returned'),
  replies: z.array(ReplyOutputSchema).describe('Array of replies'),
  has_more: z.boolean().describe('Whether more results are available'),
  next_page_token: z.string().optional().describe('Token for the next page'),
};

export const DeleteCommentOutputSchema = {
  file_id: z.string().describe('The file ID'),
  comment_id: z.string().describe('The deleted comment ID'),
};
