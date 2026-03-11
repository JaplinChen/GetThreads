import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedContent } from '../../extractors/types.js';

vi.mock('../../classifier.js', () => ({
  classifyContent: vi.fn(),
}));

vi.mock('../../enrichment/post-processor.js', () => ({
  postProcess: vi.fn(),
}));

vi.mock('../../learning/ai-enricher.js', () => ({
  enrichContent: vi.fn(),
}));

vi.mock('../../learning/dynamic-classifier.js', () => ({
  getTopKeywordsForCategory: vi.fn(),
}));

import { classifyContent } from '../../classifier.js';
import { postProcess } from '../../enrichment/post-processor.js';
import { enrichContent } from '../../learning/ai-enricher.js';
import { getTopKeywordsForCategory } from '../../learning/dynamic-classifier.js';
import { enrichExtractedContent } from './enrich-content-service.js';
import { AI_TRANSCRIPT_PREFIX } from '../user-messages.js';

const mockClassifyContent = vi.mocked(classifyContent);
const mockPostProcess = vi.mocked(postProcess);
const mockEnrichContent = vi.mocked(enrichContent);
const mockGetTopKeywordsForCategory = vi.mocked(getTopKeywordsForCategory);

function makeContent(): ExtractedContent {
  return {
    platform: 'x',
    author: 'Alice',
    authorHandle: '@alice',
    title: 'T',
    text: 'Body',
    images: [],
    videos: [],
    date: '2026-03-08',
    url: 'https://x.com/alice/status/1',
  };
}

describe('enrich-content-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClassifyContent.mockReturnValue('�޳N');
    mockGetTopKeywordsForCategory.mockReturnValue(['ai', 'agent']);
    mockPostProcess.mockResolvedValue(undefined as never);
    mockEnrichContent.mockResolvedValue({} as never);
  });

  it('classifies content and runs post-process', async () => {
    const content = makeContent();

    await enrichExtractedContent(content, {
      botToken: 'x',
      vaultPath: 'v',
      enableTranslation: true,
      maxLinkedUrls: 5,
      saveVideos: false,
    });

    expect(mockClassifyContent).toHaveBeenCalledWith('T', 'Body');
    expect(content.category).toBe('�޳N');
    expect(mockPostProcess).toHaveBeenCalledTimes(1);
  });

  it('uses transcript prefix and applies enrich result', async () => {
    const content = makeContent();
    content.transcript = 'transcript text';
    mockEnrichContent.mockResolvedValue({
      keywords: ['k1'],
      summary: 's1',
      title: 'new title',
      category: '�s����',
    } as never);

    await enrichExtractedContent(content, {
      botToken: 'x',
      vaultPath: 'v',
      enableTranslation: true,
      maxLinkedUrls: 5,
      saveVideos: false,
    });

    expect(mockGetTopKeywordsForCategory).toHaveBeenCalledWith('�޳N');
    expect(mockEnrichContent).toHaveBeenCalledTimes(1);
    const aiText = mockEnrichContent.mock.calls[0][1] as string;
    expect(aiText).toContain(AI_TRANSCRIPT_PREFIX);
    expect(content.enrichedKeywords).toEqual(['k1']);
    expect(content.enrichedSummary).toBe('s1');
    expect(content.title).toBe('new title');
    expect(content.category).toBe('�s����');
  });

  it('runs AI enrich without requiring local provider config', async () => {
    const content = makeContent();

    await enrichExtractedContent(content, {
      botToken: 'x',
      vaultPath: 'v',
      enableTranslation: false,
      maxLinkedUrls: 2,
      saveVideos: false,
    });

    expect(mockEnrichContent).toHaveBeenCalledTimes(1);
  });

  it('swallows post-process errors', async () => {
    const content = makeContent();
    mockPostProcess.mockRejectedValue(new Error('pp fail'));

    await expect(enrichExtractedContent(content, {
      botToken: 'x',
      vaultPath: 'v',
      enableTranslation: true,
      maxLinkedUrls: 5,
      saveVideos: false,
    })).resolves.toBeUndefined();
  });
});




