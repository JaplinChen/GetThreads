import { describe, expect, it } from 'vitest';
import type { ExtractedContent, ExtractorWithComments, ThreadComment } from '../../extractors/types.js';
import { extractContentWithComments } from './extract-content-service.js';

function makeContent(): ExtractedContent {
  return {
    platform: 'x',
    author: 'Alice',
    authorHandle: '@alice',
    title: 'A title',
    text: 'A meaningful post text',
    images: [],
    videos: [],
    date: '2026-03-08',
    url: 'https://x.com/alice/status/1',
  };
}

function makeExtractor(comments: ThreadComment[]): ExtractorWithComments {
  return {
    platform: 'x',
    match: () => true,
    parseId: () => '1',
    extract: async () => makeContent(),
    extractComments: async () => comments,
  };
}

describe('extract-content-service', () => {
  it('attaches only meaningful comments and preserves total count', async () => {
    const comments: ThreadComment[] = [
      { author: 'u1', authorHandle: '@u1', text: 'wow', date: '2026-03-08' },
      { author: 'u2', authorHandle: '@u2', text: '這是一段超過十五字的有意義留言內容', date: '2026-03-08' },
      { author: 'u3', authorHandle: '@u3', text: 'https://example.com/a', date: '2026-03-08' },
    ];

    const content = await extractContentWithComments('https://x.com/alice/status/1', makeExtractor(comments));

    expect(content.comments).toBeDefined();
    expect(content.comments?.length).toBe(2);
    expect(content.commentCount).toBe(3);
  });

  it('does not attach comments when all are noise', async () => {
    const comments: ThreadComment[] = [
      { author: 'u1', authorHandle: '@u1', text: 'ok', date: '2026-03-08' },
      { author: 'u2', authorHandle: '@u2', text: 'haha', date: '2026-03-08' },
    ];

    const content = await extractContentWithComments('https://x.com/alice/status/1', makeExtractor(comments));

    expect(content.comments).toBeUndefined();
    expect(content.commentCount).toBeUndefined();
  });

  it('throws when extractor.extract fails', async () => {
    const extractor: ExtractorWithComments = {
      platform: 'x',
      match: () => true,
      parseId: () => '1',
      extract: async () => {
        throw new Error('extract failed');
      },
      extractComments: async () => [],
    };

    await expect(extractContentWithComments('https://x.com/alice/status/1', extractor)).rejects.toThrow('extract failed');
  });
});
