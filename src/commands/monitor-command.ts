/**
 * /monitor command — cross-platform keyword search (mention discovery).
 * /google command — web search (DuckDuckGo HTML + Camoufox fallback).
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import type { ExtractedContent } from '../extractors/types.js';
import { searchReddit, webSearch, fetchJinaContent } from '../utils/search-service.js';
import { saveToVault, isDuplicateUrl } from '../saver.js';
import { classifyContent } from '../classifier.js';
import { findExtractor } from '../utils/url-parser.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';

/** Hosts excluded from /monitor results (auth-required, content not accessible). */
const MONITOR_SKIP_HOSTS = new Set([
  'x.com', 'twitter.com', 'www.x.com', 'www.twitter.com',
]);

export async function handleMonitor(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const keyword = text.replace(/^\/monitor\s*/i, '').trim();

  if (!keyword) {
    await ctx.reply(
      tagForceReply('monitor', '請輸入監控關鍵字：\n例：claude code'),
      forceReplyMarkup('輸入關鍵字…'),
    );
    return;
  }

  const status = await ctx.reply(`正在跨平台搜尋「${keyword}」...`);

  try {
    const [redditResults, webResults] = await Promise.allSettled([
      searchReddit(keyword, 5),
      webSearch(keyword, 8),
    ]);

    const posts = redditResults.status === 'fulfilled' ? redditResults.value : [];
    const rawWeb = webResults.status === 'fulfilled' ? webResults.value : [];

    const filtered = rawWeb.filter(g => {
      try { return !MONITOR_SKIP_HOSTS.has(new URL(g.url).hostname); }
      catch { return false; }
    });

    const jinaTexts = await Promise.all(
      filtered.map(g => fetchJinaContent(g.url).catch(() => '')),
    );
    for (const [i, g] of filtered.entries()) {
      posts.push({
        platform: 'web',
        author: new URL(g.url).hostname,
        authorHandle: new URL(g.url).hostname,
        title: g.title,
        text: jinaTexts[i] || g.snippet,
        images: [],
        videos: [],
        date: new Date().toISOString().split('T')[0],
        url: g.url,
      });
    }

    if (posts.length === 0) {
      await ctx.reply(`沒有找到關於「${keyword}」的內容。`);
      return;
    }

    let saved = 0;
    for (const post of posts) {
      try {
        post.category = classifyContent(post.title, post.text);
        const r = await saveToVault(post, config.vaultPath);
        if (!r.duplicate) saved++;
      } catch { /* skip */ }
    }

    const lines = [`🔍 搜尋「${keyword}」完成：找到 ${posts.length} 筆，儲存 ${saved} 篇`, ''];
    for (const p of posts.slice(0, 8)) {
      lines.push(`• [${p.title.slice(0, 50)}](${p.url})`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`搜尋失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

export async function handleSearch(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const query = text.replace(/^\/(search|google)\s*/i, '').trim();

  if (!query) {
    await ctx.reply(
      tagForceReply('search', '請輸入搜尋關鍵字：\n例：camoufox typescript'),
      forceReplyMarkup('輸入搜尋關鍵字…'),
    );
    return;
  }

  const status = await ctx.reply(`正在搜尋「${query}」...`);
  try {
    const results = await webSearch(query, 8);
    if (results.length === 0) {
      await ctx.reply('沒有找到搜尋結果，請稍後再試。');
      return;
    }

    // Check which URLs are already saved
    const entries: Array<{ title: string; url: string; host: string; saved: boolean }> = [];
    for (const r of results) {
      const dup = await isDuplicateUrl(r.url, config.vaultPath);
      const host = (() => { try { return new URL(r.url).hostname; } catch { return ''; } })();
      entries.push({ title: r.title, url: r.url, host, saved: !!dup });
    }

    const unsaved = entries.filter(e => !e.saved);

    // Auto-save unsaved results using platform extractors
    let newSaved = 0;
    for (const e of unsaved) {
      try {
        const extractor = findExtractor(e.url);
        if (!extractor) continue;
        const content = await extractor.extract(e.url);
        content.category = classifyContent(content.title, content.text);
        const r = await saveToVault(content, config.vaultPath);
        if (!r.duplicate) { newSaved++; e.saved = true; }
      } catch { /* skip */ }
    }

    // Format reply
    const alreadySaved = entries.filter(e => e.saved && !unsaved.some(u => u.url === e.url)).length;
    const lines = [`🔍 搜尋「${query}」：${entries.length} 筆結果，新儲存 ${newSaved} 篇`, ''];
    for (const [i, e] of entries.entries()) {
      const icon = unsaved.some(u => u.url === e.url) ? (e.saved ? '✅' : '❌') : '📂';
      lines.push(`${i + 1}. ${icon} ${e.title.slice(0, 50)}`);
      lines.push(`   ${e.host}`);
    }
    if (alreadySaved > 0) lines.push('', `📂 = 已儲存  ✅ = 新儲存  ❌ = 擷取失敗`);
    await ctx.reply(lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`搜尋失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
