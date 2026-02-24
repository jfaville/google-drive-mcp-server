/**
 * Utility functions for Google Drive Comments & Replies tools
 */

import { docs_v1 } from 'googleapis';

/** Structured comment for output */
export interface CommentData {
  [key: string]: unknown;
  id: string;
  content: string;
  author?: string;
  createdTime?: string;
  modifiedTime?: string;
  resolved: boolean;
  quotedText?: string;
  replies?: ReplyData[];
}

/** Structured reply for output */
export interface ReplyData {
  [key: string]: unknown;
  id: string;
  content: string;
  author?: string;
  createdTime?: string;
  modifiedTime?: string;
  action?: string;
}

/** Structured comment list result */
export interface CommentListResult {
  [key: string]: unknown;
  count: number;
  comments: CommentData[];
  has_more: boolean;
  next_page_token?: string;
}

/** Structured reply list result */
export interface ReplyListResult {
  [key: string]: unknown;
  count: number;
  replies: ReplyData[];
  has_more: boolean;
  next_page_token?: string;
}

/**
 * Extract text from a Google Doc body between startIndex and endIndex.
 * Traverses paragraphs and concatenates text runs that overlap the range.
 */
export function extractTextFromDocBody(
  body: docs_v1.Schema$Body,
  startIndex: number,
  endIndex: number
): string {
  const parts: string[] = [];

  for (const element of body.content || []) {
    if (!element.paragraph) continue;

    const elStart = element.startIndex ?? 0;
    const elEnd = element.endIndex ?? 0;

    if (elEnd <= startIndex || elStart >= endIndex) continue;

    for (const el of element.paragraph.elements || []) {
      if (!el.textRun?.content) continue;

      const runStart = el.startIndex ?? 0;
      const runEnd = el.endIndex ?? 0;

      if (runEnd <= startIndex || runStart >= endIndex) continue;

      const content = el.textRun.content;
      const sliceStart = Math.max(0, startIndex - runStart);
      const sliceEnd = Math.min(content.length, endIndex - runStart);
      parts.push(content.substring(sliceStart, sliceEnd));
    }
  }

  return parts.join('');
}

/**
 * Build the Drive API anchor JSON for an anchored comment on a Google Doc.
 * Converts 1-based Docs API indices to 0-based anchor offsets.
 */
export function buildCommentAnchor(
  documentId: string,
  startIndex: number,
  endIndex: number
): string {
  const length = endIndex - startIndex;
  return JSON.stringify({
    r: documentId,
    a: [{
      txt: {
        o: startIndex - 1,
        l: length,
        ml: length
      }
    }]
  });
}

/**
 * Map a Drive API comment response to our simplified CommentData shape.
 */
export function mapComment(comment: any): CommentData {
  const result: CommentData = {
    id: comment.id,
    content: comment.content || '',
    resolved: comment.resolved || false,
  };

  if (comment.author?.displayName) result.author = comment.author.displayName;
  if (comment.createdTime) result.createdTime = comment.createdTime;
  if (comment.modifiedTime) result.modifiedTime = comment.modifiedTime;
  if (comment.quotedFileContent?.value) result.quotedText = comment.quotedFileContent.value;

  if (comment.replies && comment.replies.length > 0) {
    result.replies = comment.replies.map(mapReply);
  }

  return result;
}

/**
 * Map a Drive API reply response to our simplified ReplyData shape.
 */
export function mapReply(reply: any): ReplyData {
  const result: ReplyData = {
    id: reply.id,
    content: reply.content || '',
  };

  if (reply.author?.displayName) result.author = reply.author.displayName;
  if (reply.createdTime) result.createdTime = reply.createdTime;
  if (reply.modifiedTime) result.modifiedTime = reply.modifiedTime;
  if (reply.action) result.action = reply.action;

  return result;
}

/**
 * Format a comment as markdown.
 */
export function formatCommentMarkdown(comment: CommentData): string {
  const parts: string[] = [];
  const status = comment.resolved ? '[RESOLVED]' : '[OPEN]';
  parts.push(`### Comment ${comment.id} ${status}`);
  if (comment.author) parts.push(`- Author: ${comment.author}`);
  parts.push(`- Content: ${comment.content}`);
  if (comment.quotedText) parts.push(`- Quoted text: "${comment.quotedText}"`);
  if (comment.createdTime) parts.push(`- Created: ${comment.createdTime}`);

  if (comment.replies && comment.replies.length > 0) {
    parts.push(`- Replies (${comment.replies.length}):`);
    for (const reply of comment.replies) {
      const authorStr = reply.author ? ` (${reply.author})` : '';
      const actionStr = reply.action ? ` [${reply.action}]` : '';
      parts.push(`  - ${reply.content}${authorStr}${actionStr}`);
    }
  }

  return parts.join('\n');
}

/**
 * Format a comment list as markdown.
 */
export function formatCommentListMarkdown(result: CommentListResult): string {
  const parts: string[] = [];
  parts.push(`# Comments (${result.count})\n`);

  for (const comment of result.comments) {
    parts.push(formatCommentMarkdown(comment));
    parts.push('');
  }

  if (result.has_more) {
    parts.push(`\n*More comments available. Use next_page_token: \`${result.next_page_token}\`*`);
  }

  return parts.join('\n');
}
