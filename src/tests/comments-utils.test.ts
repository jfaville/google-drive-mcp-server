/**
 * Unit tests for comments utility functions.
 * Run with: npm test  (after npm run build)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTextFromDocBody,
  buildCommentAnchor,
  mapComment,
  mapReply,
} from '../services/comments-utils.js';

// ---------------------------------------------------------------------------
// extractTextFromDocBody
// ---------------------------------------------------------------------------

describe('extractTextFromDocBody', () => {
  it('extracts text spanning a single run', () => {
    const body = {
      content: [{
        paragraph: {
          elements: [{
            textRun: { content: 'Hello World\n' },
            startIndex: 1,
            endIndex: 13
          }]
        },
        startIndex: 1,
        endIndex: 13
      }]
    };
    assert.equal(extractTextFromDocBody(body as any, 1, 6), 'Hello');
  });

  it('extracts text spanning multiple paragraphs', () => {
    const body = {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'First\n' }, startIndex: 1, endIndex: 7 }]
          },
          startIndex: 1, endIndex: 7
        },
        {
          paragraph: {
            elements: [{ textRun: { content: 'Second\n' }, startIndex: 7, endIndex: 14 }]
          },
          startIndex: 7, endIndex: 14
        }
      ]
    };
    assert.equal(extractTextFromDocBody(body as any, 1, 14), 'First\nSecond\n');
  });

  it('extracts partial text from a run', () => {
    const body = {
      content: [{
        paragraph: {
          elements: [{
            textRun: { content: 'Hello World\n' },
            startIndex: 1,
            endIndex: 13
          }]
        },
        startIndex: 1,
        endIndex: 13
      }]
    };
    // "World" starts at index 7 (1-based), which is offset 6 in the string
    assert.equal(extractTextFromDocBody(body as any, 7, 12), 'World');
  });

  it('returns empty string for out-of-range indices', () => {
    const body = {
      content: [{
        paragraph: {
          elements: [{ textRun: { content: 'Hello\n' }, startIndex: 1, endIndex: 7 }]
        },
        startIndex: 1, endIndex: 7
      }]
    };
    assert.equal(extractTextFromDocBody(body as any, 100, 200), '');
  });

  it('handles empty body', () => {
    const body = { content: [] };
    assert.equal(extractTextFromDocBody(body as any, 1, 10), '');
  });

  it('handles multiple text runs in one paragraph', () => {
    const body = {
      content: [{
        paragraph: {
          elements: [
            { textRun: { content: 'Hello ' }, startIndex: 1, endIndex: 7 },
            { textRun: { content: 'World\n' }, startIndex: 7, endIndex: 13 }
          ]
        },
        startIndex: 1,
        endIndex: 13
      }]
    };
    assert.equal(extractTextFromDocBody(body as any, 1, 13), 'Hello World\n');
  });
});

// ---------------------------------------------------------------------------
// buildCommentAnchor
// ---------------------------------------------------------------------------

describe('buildCommentAnchor', () => {
  it('builds correct anchor JSON with 0-based offset', () => {
    const anchor = buildCommentAnchor('doc123', 5, 10);
    const parsed = JSON.parse(anchor);
    assert.equal(parsed.r, 'doc123');
    assert.equal(parsed.a[0].txt.o, 4);  // 5-1 = 4 (0-based)
    assert.equal(parsed.a[0].txt.l, 5);  // 10-5 = 5
    assert.equal(parsed.a[0].txt.ml, 5);
  });

  it('handles single-character range', () => {
    const anchor = buildCommentAnchor('doc456', 1, 2);
    const parsed = JSON.parse(anchor);
    assert.equal(parsed.a[0].txt.o, 0);
    assert.equal(parsed.a[0].txt.l, 1);
    assert.equal(parsed.a[0].txt.ml, 1);
  });

  it('produces valid JSON', () => {
    const anchor = buildCommentAnchor('doc-with-special', 10, 50);
    assert.doesNotThrow(() => JSON.parse(anchor));
  });
});

// ---------------------------------------------------------------------------
// mapComment
// ---------------------------------------------------------------------------

describe('mapComment', () => {
  it('maps a minimal comment', () => {
    const raw = { id: 'c1', content: 'test', resolved: false };
    const result = mapComment(raw);
    assert.equal(result.id, 'c1');
    assert.equal(result.content, 'test');
    assert.equal(result.resolved, false);
    assert.equal(result.author, undefined);
    assert.equal(result.replies, undefined);
  });

  it('maps a comment with author and quoted text', () => {
    const raw = {
      id: 'c2',
      content: 'fix this',
      resolved: true,
      author: { displayName: 'Alice' },
      quotedFileContent: { value: 'some text' },
      createdTime: '2024-01-01T00:00:00Z',
      replies: [{ id: 'r1', content: 'done', author: { displayName: 'Bob' } }]
    };
    const result = mapComment(raw);
    assert.equal(result.author, 'Alice');
    assert.equal(result.quotedText, 'some text');
    assert.equal(result.resolved, true);
    assert.equal(result.createdTime, '2024-01-01T00:00:00Z');
    assert.equal(result.replies?.length, 1);
    assert.equal(result.replies?.[0].author, 'Bob');
  });

  it('defaults resolved to false when missing', () => {
    const raw = { id: 'c3', content: 'hi' };
    const result = mapComment(raw);
    assert.equal(result.resolved, false);
  });

  it('ignores author without displayName', () => {
    const raw = { id: 'c4', content: 'hi', author: {} };
    const result = mapComment(raw);
    assert.equal(result.author, undefined);
  });
});

// ---------------------------------------------------------------------------
// mapReply
// ---------------------------------------------------------------------------

describe('mapReply', () => {
  it('maps a reply with action', () => {
    const raw = { id: 'r1', content: 'Resolved', action: 'resolve', author: { displayName: 'X' } };
    const result = mapReply(raw);
    assert.equal(result.id, 'r1');
    assert.equal(result.content, 'Resolved');
    assert.equal(result.action, 'resolve');
    assert.equal(result.author, 'X');
  });

  it('maps a minimal reply', () => {
    const raw = { id: 'r2', content: 'ok' };
    const result = mapReply(raw);
    assert.equal(result.id, 'r2');
    assert.equal(result.content, 'ok');
    assert.equal(result.action, undefined);
    assert.equal(result.author, undefined);
  });
});
