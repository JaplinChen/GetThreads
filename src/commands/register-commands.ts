/**
 * Centralized command registration.
 * Keeps lightweight orchestration while command groups live in dedicated modules.
 */
import type { Context, Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { handleTimeline } from './timeline-command.js';
import { handleMonitor, handleSearch } from './monitor-command.js';
import { handleKnowledge, handleGaps, handleSkills, handleAnalyze } from './knowledge-command.js';
import { handlePreferences, handleDistill } from './distill-command.js';
import { handleConsolidate } from './consolidate-command.js';
import { handleAsk } from './ask-command.js';
import { handleDiscover } from './discover-command.js';
import { handleReprocess } from './reprocess-command.js';
import { createRetryHandler, createRetryActionHandler } from './retry-command.js';
import { handleSubscribe } from './subscribe-command.js';
import { handleQuality } from './quality-command.js';
import { handleDigestMenu, handleDigest } from './digest-command.js';
import { handleSuggest } from './suggest-command.js';
import { handleRadar, handleRadarAction } from './radar-command.js';
import {
  handleExplore,
  handleRecommendByTopic,
  handleBriefByTopic,
  handleCompareByArg,
  resolveCallbackToken,
} from './knowledge-query-command.js';
import { runCommandTask } from './command-runner.js';
import { formatErrorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { registerForceReplyHandler } from '../messages/force-reply-router.js';
import { BOT_COMMANDS_MENU, HELP_TEXT } from './command-help.js';
import { registerLearningCommands } from './register-learning-commands.js';
import { registerInfoCommands, type CommandStats } from './register-info-commands.js';

export { formatErrorMessage };

type MatchedContext = Context & { match: RegExpExecArray };

function registerAsyncCommand(
  bot: Telegraf,
  command: string | readonly string[],
  tag: string,
  config: AppConfig,
  handler: (ctx: Context, config: AppConfig) => Promise<void>,
): void {
  bot.command(command as string | string[], (ctx) => {
    runCommandTask(ctx, tag, () => handler(ctx, config), formatErrorMessage).catch(() => {});
  });
}

function registerAsyncAction(
  bot: Telegraf,
  pattern: RegExp,
  tag: string,
  handler: (ctx: MatchedContext) => Promise<void>,
): void {
  bot.action(pattern, (ctx) => {
    const matchedCtx = ctx as MatchedContext;
    runCommandTask(matchedCtx, tag, () => handler(matchedCtx), formatErrorMessage).catch(() => {});
  });
}

export function registerCommands(
  bot: Telegraf,
  config: AppConfig,
  stats: CommandStats,
  startTime: number,
): void {
  bot.start((ctx) => ctx.reply(HELP_TEXT));
  bot.command('help', (ctx) => ctx.reply(HELP_TEXT));

  registerLearningCommands(bot, config, formatErrorMessage);

  // --- Content extraction ---
  registerAsyncCommand(bot, 'timeline', 'timeline', config, handleTimeline);
  registerAsyncCommand(bot, 'monitor', 'monitor', config, handleMonitor);
  registerAsyncCommand(bot, 'search', 'search', config, handleSearch);

  // --- Knowledge system (consolidated) ---
  registerAsyncCommand(bot, 'knowledge', 'knowledge', config, handleKnowledge);
  registerAsyncCommand(bot, 'explore', 'explore', config, handleExplore);
  registerAsyncCommand(bot, 'digest', 'digest', config, handleDigestMenu);
  registerAsyncCommand(bot, 'ask', 'ask', config, handleAsk);
  registerAsyncCommand(bot, 'discover', 'discover', config, handleDiscover);

  // --- Maintenance ---
  registerAsyncCommand(bot, 'reprocess', 'reprocess', config, handleReprocess);
  registerAsyncCommand(bot, 'retry', 'retry', config, createRetryHandler(stats));
  registerAsyncCommand(bot, 'subscribe', 'subscribe', config, handleSubscribe);
  registerAsyncCommand(bot, 'quality', 'quality', config, handleQuality);
  registerAsyncCommand(bot, 'suggest', 'suggest', config, handleSuggest);
  registerAsyncCommand(bot, 'radar', 'radar', config, handleRadar);

  // --- InlineKeyboard: /knowledge sub-actions ---
  registerAsyncAction(bot, /^kb:(.+)$/, 'knowledge-action', async (ctx) => {
    const mode = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    const handlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
      gaps: handleGaps,
      skills: handleSkills,
      preferences: handlePreferences,
      analyze: handleAnalyze,
    };
    const handler = handlers[mode];
    if (handler) await handler(ctx, config);
  });

  // --- InlineKeyboard: /explore sub-actions ---
  registerAsyncAction(bot, /^xrec:(.+)$/, 'explore-action', async (ctx) => {
    const token = ctx.match![1];
    const topic = resolveCallbackToken('xrec', token);
    await ctx.answerCbQuery().catch(() => {});
    if (!topic) {
      await ctx.reply('按鈕已過期，請重新執行 /explore');
      return;
    }
    await handleRecommendByTopic(ctx, topic);
  });

  registerAsyncAction(bot, /^xbrf:(.+)$/, 'explore-action', async (ctx) => {
    const token = ctx.match![1];
    const topic = resolveCallbackToken('xbrf', token);
    await ctx.answerCbQuery().catch(() => {});
    if (!topic) {
      await ctx.reply('按鈕已過期，請重新執行 /explore');
      return;
    }
    await handleBriefByTopic(ctx, topic);
  });

  registerAsyncAction(bot, /^compare:(.+)$/, 'compare-action', async (ctx) => {
    const rawArg = ctx.match![1];
    const arg = resolveCallbackToken('compare', rawArg);
    await ctx.answerCbQuery().catch(() => {});
    if (!arg) {
      await ctx.reply('按鈕已過期，請重新執行 /explore');
      return;
    }
    await handleCompareByArg(ctx, arg);
  });

  // --- InlineKeyboard: /digest sub-actions ---
  registerAsyncAction(bot, /^dg:(.+)$/, 'digest-action', async (ctx) => {
    const mode = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    const handlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
      digest: handleDigest,
      distill: handleDistill,
      consolidate: handleConsolidate,
    };
    const handler = handlers[mode];
    if (handler) await handler(ctx, config);
  });

  registerAsyncAction(bot, /^retry:(.+)$/, 'retry-action', createRetryActionHandler(stats, config));

  // --- InlineKeyboard: /radar sub-actions ---
  registerAsyncAction(bot, /^radar:(.+)$/, 'radar-action', async (ctx) => {
    const action = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    await handleRadarAction(ctx, action, config);
  });

  // --- ForceReply dispatch ---
  registerForceReplyHandler('search', (ctx) =>
    runCommandTask(ctx, 'search', () => handleSearch(ctx, config), formatErrorMessage));
  registerForceReplyHandler('monitor', (ctx) =>
    runCommandTask(ctx, 'monitor', () => handleMonitor(ctx, config), formatErrorMessage));
  registerForceReplyHandler('timeline', (ctx) =>
    runCommandTask(ctx, 'timeline', () => handleTimeline(ctx, config), formatErrorMessage));
  registerForceReplyHandler('explore', (ctx) =>
    runCommandTask(ctx, 'explore', () => handleExplore(ctx, config), formatErrorMessage));
  registerForceReplyHandler('ask', (ctx) =>
    runCommandTask(ctx, 'ask', () => handleAsk(ctx, config), formatErrorMessage));
  registerForceReplyHandler('discover', (ctx) =>
    runCommandTask(ctx, 'discover', () => handleDiscover(ctx, config), formatErrorMessage));
  registerForceReplyHandler('reprocess', (ctx) =>
    runCommandTask(ctx, 'reprocess', () => handleReprocess(ctx, config), formatErrorMessage));
  registerForceReplyHandler('subscribe', (ctx) =>
    runCommandTask(ctx, 'subscribe', () => handleSubscribe(ctx, config), formatErrorMessage));

  registerInfoCommands(bot, stats, startTime);

  // --- Register command menu ---
  bot.telegram
    .setMyCommands(BOT_COMMANDS_MENU)
    .catch((err) => logger.warn('bot', 'setMyCommands failed', err));
}
