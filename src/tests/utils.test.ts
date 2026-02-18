/**
 * Unit tests for utility functions.
 * Run with: npm test  (after npm run build)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQuery, formatError, truncateText } from '../services/utils.js';

// ---------------------------------------------------------------------------
// buildSearchQuery
// ---------------------------------------------------------------------------

describe('buildSearchQuery', () => {
  it('excludes trashed files by default', () => {
    const q = buildSearchQuery({});
    assert.ok(q.includes('trashed=false'));
  });

  it('includes name contains clause when query is provided', () => {
    const q = buildSearchQuery({ query: 'report' });
    assert.ok(q.includes("name contains 'report'"));
  });

  it('escapes single quotes in query', () => {
    const q = buildSearchQuery({ query: "it's" });
    assert.ok(q.includes("name contains 'it\\'s'"), `Got: ${q}`);
  });

  it('escapes single quotes in mime_type', () => {
    // Protect against query injection via mime_type
    const q = buildSearchQuery({ mime_type: "text/plain'; trashed=false" });
    assert.ok(!q.includes("text/plain'; trashed=false"), `Unescaped value present: ${q}`);
  });

  it('includes mimeType filter', () => {
    const q = buildSearchQuery({ mime_type: 'application/vnd.google-apps.folder' });
    assert.ok(q.includes("mimeType='application/vnd.google-apps.folder'"));
  });

  it('includes parent_id filter', () => {
    const q = buildSearchQuery({ parent_id: 'abc123' });
    assert.ok(q.includes("'abc123' in parents"));
  });

  it('joins multiple conditions with and', () => {
    const q = buildSearchQuery({ query: 'notes', mime_type: 'text/plain' });
    assert.ok(q.includes(' and '));
  });

  it('respects explicit trashed=true', () => {
    const q = buildSearchQuery({ trashed: true });
    assert.ok(q.includes('trashed=true'));
    assert.ok(!q.includes('trashed=false'));
  });
});

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------

describe('truncateText', () => {
  it('returns text unchanged when under limit', () => {
    const text = 'hello world';
    assert.equal(truncateText(text, 100), text);
  });

  it('truncates text exceeding limit', () => {
    const text = 'a'.repeat(200);
    const result = truncateText(text, 100);
    assert.ok(result.length > 100); // includes truncation notice
    assert.ok(result.startsWith('a'.repeat(100)));
    assert.ok(result.includes('truncated'));
  });

  it('uses CHARACTER_LIMIT as default when no limit given', () => {
    const short = 'hello';
    assert.equal(truncateText(short), short);
  });
});

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------

describe('formatError', () => {
  it('handles 401 errors', () => {
    const err = Object.assign(new Error('Unauthorized'), { code: 401 });
    assert.ok(formatError(err).includes('Authentication failed'));
  });

  it('handles 403 errors', () => {
    const err = Object.assign(new Error('Forbidden'), { code: 403 });
    assert.ok(formatError(err).includes('Access forbidden'));
  });

  it('handles 404 errors and mentions the Picker', () => {
    const err = Object.assign(new Error('Not Found'), { code: 404 });
    const msg = formatError(err);
    assert.ok(msg.includes('File not found'));
    assert.ok(msg.toLowerCase().includes('picker'), `Expected Picker mention: ${msg}`);
  });

  it('handles 429 rate limit errors', () => {
    const err = Object.assign(new Error('Too Many Requests'), { code: 429 });
    assert.ok(formatError(err).includes('Rate limit'));
  });

  it('handles generic Error objects', () => {
    const err = new Error('something broke');
    assert.ok(formatError(err).includes('something broke'));
  });

  it('handles non-Error unknowns', () => {
    const result = formatError('oops');
    assert.ok(result.includes('Unknown error'));
  });
});
