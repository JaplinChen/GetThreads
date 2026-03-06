/** Supported platform identifiers — add new platforms here */
export type Platform =
  | 'x' | 'threads' | 'youtube' | 'github' | 'reddit' | 'web'
  | 'weibo' | 'xiaohongshu' | 'bilibili' | 'douyin';

/** A single comment or reply on a post */
export interface ThreadComment {
  author: string;
  authorHandle: string;
  text: string;
  date: string;
  likes?: number;
  replies?: ThreadComment[];
}

/** Unified content extracted from any platform */
export interface VideoInfo {
  url: string;
  thumbnailUrl?: string;
  type?: 'video' | 'gif';
}

/** Unified content extracted from any platform */
export interface ExtractedContent {
  platform: Platform;
  author: string;
  authorHandle: string;
  /** Short descriptive title (article title or first line of text) */
  title: string;
  text: string;
  images: string[];
  videos: VideoInfo[];
  date: string;
  url: string;
  likes?: number;
  reposts?: number;
  /** AI-assigned category for Obsidian sub-folder organization */
  category?: string;
  /** AI-enriched keywords (overrides classifier-matched keywords in formatter) */
  enrichedKeywords?: string[];
  /** AI-enriched summary (overrides text truncation in formatter) */
  enrichedSummary?: string;
  /** Extra tags from platform metadata (e.g. GitHub topics) */
  extraTags?: string[];
  /** Star/engagement count (e.g. GitHub stargazers) */
  stars?: number;
  /** Long-form body content separate from short text (e.g. GitHub README) */
  body?: string;
  /** Comments/replies fetched from the post */
  comments?: ThreadComment[];
  /** Total comment count reported by the platform (may exceed fetched) */
  commentCount?: number;
}

/** Each platform extractor must implement this interface */
export interface Extractor {
  platform: Platform;
  /** Test whether a URL belongs to this platform */
  match(url: string): boolean;
  /** Extract post ID from URL */
  parseId(url: string): string | null;
  /** Fetch and extract content from the URL */
  extract(url: string): Promise<ExtractedContent>;
}

/** Optional extension for extractors that support comment fetching */
export interface ExtractorWithComments extends Extractor {
  extractComments(url: string, limit?: number): Promise<ThreadComment[]>;
}
