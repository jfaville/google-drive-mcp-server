/**
 * Zod output schemas for Revisions MCP tool structured responses.
 */

import { z } from 'zod';

const RevisionOutputSchema = z.object({
  id: z.string().describe('Revision ID'),
  modifiedTime: z.string().optional().describe('ISO timestamp of this revision'),
  lastModifyingUser: z.string().optional().describe('Display name of user who made this revision'),
  lastModifyingEmail: z.string().optional().describe('Email of user who made this revision'),
  size: z.string().optional().describe('File size in bytes at this revision'),
});

export const RevisionDetailOutputSchema = {
  id: z.string().describe('Revision ID'),
  modifiedTime: z.string().optional().describe('ISO timestamp of this revision'),
  lastModifyingUser: z.string().optional().describe('Display name of user who made this revision'),
  lastModifyingEmail: z.string().optional().describe('Email of user who made this revision'),
  size: z.string().optional().describe('File size in bytes at this revision'),
  mimeType: z.string().optional().describe('MIME type of the revision'),
  content: z.string().optional().describe('Exported text content of this revision'),
};

export const RevisionListOutputSchema = {
  count: z.number().describe('Number of revisions returned'),
  revisions: z.array(RevisionOutputSchema).describe('Array of revisions'),
  has_more: z.boolean().describe('Whether more results are available'),
  next_page_token: z.string().optional().describe('Token for the next page'),
};
