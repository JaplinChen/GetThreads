import type { Telegraf } from 'telegraf';
import { parseForceReplyTag } from '../utils/force-reply.js';

export function registerForceReplyRouter(bot: Telegraf): void {
  bot.on('message', (ctx, next) => {
    if (!ctx.message || !('text' in ctx.message)) return next();
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !('text' in replyTo) || !replyTo.from?.is_bot) return next();

    const cmd = parseForceReplyTag(replyTo.text);
    if (!cmd) return next();

    (ctx.message as unknown as Record<string, unknown>).text = `/${cmd} ${ctx.message.text}`;
    return next();
  });
}
