import { Telegraf } from 'telegraf';
import type { AppConfig } from './utils/config.js';
import { extractUrls, findExtractor } from './utils/url-parser.js';
import { saveToVault } from './saver.js';
import { classifyContent } from './classifier.js';
import { enrichContent } from './learning/ai-enricher.js';
import { getTopKeywordsForCategory } from './learning/dynamic-classifier.js';
import { executeLearn, formatLearnReport } from './learning/learn-command.js';
import { executeReclassify } from './learning/reclassify-command.js';
import type { ExtractorWithComments } from './extractors/types.js';
import { handleTimeline } from './commands/timeline-command.js';
import { handleMonitor, handleGoogle } from './commands/monitor-command.js';

/** Check if a Telegram user is allowed to use this bot */
function isAuthorized(config: AppConfig, userId: number | undefined): boolean {
  if (!config.allowedUserIds || config.allowedUserIds.size === 0) return true;
  return userId !== undefined && config.allowedUserIds.has(userId);
}

/** Filter out noise: too short, pure emoji, or generic one-word reactions */
function isMeaningfulComment(c: { text: string }): boolean {
  const t = c.text.trim();
  if (!t) return false;
  // URL citation (e.g. "x.com/...", "https://...") — treat as intentional reference
  if (/https?:\/\/\S+|(?:^|\s)\w+\.\w{2,}\/\S+/.test(t)) return true;
  if (t.length < 15) return false;
  if (/^[\p{Emoji}\s!?.。，！？]+$/u.test(t)) return false;
  if (/^(great|nice|wow|lol|haha|yes|ok|okay|cool|love|good|awesome|amazing|thanks|congrats?)[\s!.！。]*$/i.test(t)) return false;
  return true;
}

export function createBot(config: AppConfig): Telegraf {
  const bot = new Telegraf(config.botToken, {
    handlerTimeout: 300_000,
  });

  bot.start((ctx) =>
    ctx.reply(
      [
        'GetThreads Bot',
        '',
        '傳送以下平台的連結，自動儲存內容與評論：',
        '- X.com / Twitter、Threads、Reddit',
        '- YouTube（需安裝 yt-dlp）',
        '- GitHub（Repo / Issue / PR）',
        '- 微博、B站、小紅書、抖音',
        '- 任何網頁文章（透過 Jina Reader）',
        '',
        '指令：',
        '/timeline @用戶 [threads] — 抓取用戶最近貼文（支援 Threads）',
        '/monitor <關鍵字> — 跨平台搜尋提及（Reddit + DuckDuckGo）',
        '/google <查詢> — 網頁搜尋（DuckDuckGo）',
        '/learn — 重新掃描 Vault 並更新分類規則',
        '/reclassify — 重新分類所有 Vault 筆記',
      ].join('\n'),
    ),
  );

  // /learn: scan vault and refresh classification rules
  bot.command('learn', async (ctx) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      console.warn('[auth] Unauthorized /learn attempt from user ID:', ctx.from?.id);
      return;
    }
    const msg = await ctx.reply('正在掃描 vault，請稍候...');
    try {
      const result = await executeLearn(config);
      await ctx.reply(formatLearnReport(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.reply(`學習失敗：${message}`);
    }
    try { await ctx.deleteMessage(msg.message_id); } catch { /* ignore */ }
  });

  // /timeline: scrape user's recent posts
  bot.command('timeline', async (ctx) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      console.warn('[auth] Unauthorized /timeline attempt from user ID:', ctx.from?.id);
      return;
    }
    await handleTimeline(ctx, config);
  });

  // /monitor: cross-platform keyword/mention search
  bot.command('monitor', async (ctx) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      console.warn('[auth] Unauthorized /monitor attempt from user ID:', ctx.from?.id);
      return;
    }
    await handleMonitor(ctx, config);
  });

  // /google: Google search via Camoufox
  bot.command('google', async (ctx) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      console.warn('[auth] Unauthorized /google attempt from user ID:', ctx.from?.id);
      return;
    }
    await handleGoogle(ctx, config);
  });

  // /reclassify: rescan vault and move notes to updated category folders
  bot.command('reclassify', async (ctx) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      console.warn('[auth] Unauthorized /reclassify attempt from user ID:', ctx.from?.id);
      return;
    }
    const msg = await ctx.reply('正在重新分類筆記，請稍候...');
    try {
      const result = await executeReclassify(config);
      const lines = [
        `重新分類完成：${result.total} 篇筆記`,
        `搬移：${result.moved} 篇`,
      ];
      if (result.changes.length > 0) {
        lines.push('', '異動清單：');
        for (const c of result.changes.slice(0, 10)) {
          lines.push(`• ${c.from} → ${c.to}: ${c.file}`);
        }
        if (result.changes.length > 10) lines.push(`...等共 ${result.changes.length} 篇`);
      }
      await ctx.reply(lines.join('\n'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.reply(`重新分類失敗：${message}`);
    }
    try { await ctx.deleteMessage(msg.message_id); } catch { /* ignore */ }
  });

  bot.on('message', async (ctx) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      console.warn('[auth] Unauthorized message from user ID:', ctx.from?.id);
      return;
    }
    const text = 'text' in ctx.message ? ctx.message.text : undefined;
    console.log('[msg] received:', text?.slice(0, 80));
    if (!text) return;

    const urls = extractUrls(text);
    console.log('[msg] urls:', urls);
    if (urls.length === 0) return;

    for (const url of urls) {
      const extractor = findExtractor(url);
      if (!extractor) {
        console.log('[msg] unsupported:', url);
        await ctx.reply(`不支援的連結：${url}`);
        continue;
      }

      console.log('[msg] extracting:', extractor.platform, url);
      const processing = await ctx.reply(
        `正在處理 ${extractor.platform} 連結...`,
      );

      try {
        // Parallel: extract main content + comments simultaneously
        const withComments = extractor as Partial<ExtractorWithComments>;
        const hasComments = typeof withComments.extractComments === 'function';
        const [contentResult, commentsResult] = await Promise.allSettled([
          extractor.extract(url),
          hasComments ? withComments.extractComments!(url, 30) : Promise.resolve([]),
        ]);
        if (contentResult.status === 'rejected') throw contentResult.reason as Error;
        const content = contentResult.value;
        console.log('[msg] extracted:', content.title);
        // Attach meaningful comments (filter noise before saving)
        if (commentsResult.status === 'fulfilled' && commentsResult.value.length > 0) {
          const meaningful = commentsResult.value.filter(isMeaningfulComment);
          if (meaningful.length > 0) {
            content.comments = meaningful;
            content.commentCount = commentsResult.value.length;
          }
        }

        content.category = classifyContent(content.title, content.text);
        console.log('[msg] category:', content.category);

        // Optional AI enrichment for keywords and summary
        if (config.anthropicApiKey) {
          const hints = getTopKeywordsForCategory(content.category);
          const enriched = await enrichContent(
            content.title,
            content.text,
            hints,
            config.anthropicApiKey,
          );
          if (enriched.keywords) content.enrichedKeywords = enriched.keywords;
          if (enriched.summary) content.enrichedSummary = enriched.summary;
          if (enriched.title) content.title = enriched.title;
          if (enriched.category) content.category = enriched.category;
          console.log('[msg] enriched:', !!enriched.keywords, !!enriched.summary);
        }

        const result = await saveToVault(content, config.vaultPath);
        console.log('[msg] saved:', result.mdPath);

        if (result.duplicate) {
          await ctx.reply(`已儲存過，略過：\n${result.mdPath}`);
          continue;
        }

        const summary = [
          `已儲存：${content.author} (${content.authorHandle})`,
          `分類：${content.category}`,
          '',
          content.text.length > 200
            ? content.text.slice(0, 200) + '...'
            : content.text,
          '',
          `圖片：${result.imageCount} | 影片：${result.videoCount}${content.comments?.length ? ` | 評論：${content.comments.length}` : ''}`,
          `檔案：${result.mdPath}`,
        ].join('\n');

        await ctx.reply(summary);
        console.log('[msg] done');
      } catch (err) {
        console.error('[msg] error processing url:', url, err);
        await ctx.reply(`連結處理失敗，請確認連結是否有效或稍後重試。`);
      }

      // Clean up "Processing..." message
      try {
        await ctx.deleteMessage(processing.message_id);
      } catch {
        // ignore if we can't delete
      }
    }
  });

  // Sync command menu with actual handlers
  bot.telegram.setMyCommands([
    { command: 'start', description: '顯示 Bot 說明' },
    { command: 'timeline', description: '抓取用戶最近貼文 /timeline @username' },
    { command: 'monitor', description: '跨平台搜尋提及 /monitor <關鍵字>' },
    { command: 'google', description: 'Google 搜尋 /google <查詢>' },
    { command: 'learn', description: '重新掃描 Vault 並更新分類規則' },
    { command: 'reclassify', description: '重新分類所有 Vault 筆記' },
  ]).catch((err) => console.warn('[bot] setMyCommands failed:', err));

  return bot;
}
