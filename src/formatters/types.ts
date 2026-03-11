import type { ExtractedContent, VideoInfo } from '../extractors/types.js';

/** Result of platform-specific body formatting */
export interface FormatBodyResult {
  text: string;
  /** Local image paths already embedded inline (to exclude from ## Images) */
  usedPaths: Set<string>;
  /** Video indices already embedded inline (to exclude from ## Videos) */
  inlinedVideoIndices?: Set<number>;
}

/** Each platform implements this to customise Markdown output */
export interface PlatformFormatter {
  /** Format the main body text (handle inline images, linkify, etc.) */
  formatBody(text: string, imageUrlMap?: Map<string, string>, localVideoPaths?: string[], videos?: VideoInfo[]): FormatBodyResult;

  /** Render the videos section lines */
  formatVideos(videos: VideoInfo[], localVideoPaths: string[]): string[];

  /** Extra sections after summary (README, transcript, etc.) */
  extraSections(content: ExtractedContent): string[];

  /** Filter images to show in ## Images (exclude already-inlined ones) */
  filterRemainingImages(localImagePaths: string[], usedPaths: Set<string>): string[];
}
