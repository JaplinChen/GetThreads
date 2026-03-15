import { registerExtractor, getRegisteredExtractors } from '../utils/url-parser.js';

export { getRegisteredExtractors };
import { xExtractor } from './x-extractor.js';
import { threadsExtractor } from './threads-extractor.js';
import { youtubeExtractor } from './youtube-extractor.js';
import { githubExtractor } from './github-extractor.js';
import { redditExtractor } from './reddit-extractor.js';
import { bilibiliExtractor } from './bilibili-extractor.js';
import { weiboExtractor } from './weibo-extractor.js';
import { xiaohongshuExtractor } from './xiaohongshu-extractor.js';
import { douyinExtractor } from './douyin-extractor.js';
import { tiktokExtractor } from './tiktok-extractor.js';
import { ithomeExtractor } from './ithome-extractor.js';
import { webExtractor } from './web-extractor.js';

/** Register all extractors — add new platforms here.
 *  Order matters: webExtractor is last as it matches any URL (fallback). */
export function registerAllExtractors(): void {
  registerExtractor(xExtractor);
  registerExtractor(threadsExtractor);
  registerExtractor(youtubeExtractor);
  registerExtractor(githubExtractor);
  registerExtractor(redditExtractor);
  registerExtractor(bilibiliExtractor);
  registerExtractor(weiboExtractor);
  registerExtractor(xiaohongshuExtractor);
  registerExtractor(douyinExtractor);
  registerExtractor(tiktokExtractor);
  registerExtractor(ithomeExtractor);
  registerExtractor(webExtractor); // fallback — must be last
}
