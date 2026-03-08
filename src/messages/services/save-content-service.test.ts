import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedContent } from '../../extractors/types.js';

vi.mock('../../saver.js', () => ({
  saveToVault: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  rm: vi.fn(),
}));

import { rm } from 'node:fs/promises';
import { saveToVault } from '../../saver.js';
import { saveExtractedContent } from './save-content-service.js';

const mockSaveToVault = vi.mocked(saveToVault);
const mockRm = vi.mocked(rm);

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

describe('save-content-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveToVault.mockResolvedValue({
      mdPath: '/vault/a.md',
      imageCount: 1,
      videoCount: 0,
      duplicate: false,
    } as never);
    mockRm.mockResolvedValue(undefined as never);
  });

  it('saves content and returns save result', async () => {
    const content = makeContent();

    const result = await saveExtractedContent(content, '/vault');

    expect(mockSaveToVault).toHaveBeenCalledWith(content, '/vault');
    expect(result.mdPath).toBe('/vault/a.md');
  });

  it('cleans temp directory when tempDir exists', async () => {
    const content = makeContent();
    content.tempDir = '/tmp/abc';

    await saveExtractedContent(content, '/vault');

    expect(mockRm).toHaveBeenCalledWith('/tmp/abc', { recursive: true, force: true });
  });

  it('does not clean temp dir when absent', async () => {
    const content = makeContent();

    await saveExtractedContent(content, '/vault');

    expect(mockRm).not.toHaveBeenCalled();
  });
});
