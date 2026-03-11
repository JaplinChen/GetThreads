import type { Context, Telegraf } from 'telegraf';
import { parseForceReplyTag } from '../utils/force-reply.js';

type ForceReplyHandler = (ctx: Context) => Promise<void>;
const handlers = new Map<string, ForceReplyHandler>();

/** Register a handler that ForceReply router can dispatch to directly. */
export function registerForceReplyHandler(cmd: string, handler: ForceReplyHandler): void {
  handlers.set(cmd, handler);
}

export function registerForceReplyRouter(bot: Telegraf): void {
  bot.on('message', (ctx, next) => {
    if (!ctx.message || !('text' in ctx.message)) return next();
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !('text' in replyTo) || !replyTo.from?.is_bot) return next();

    const cmd = parseForceReplyTag(replyTo.text);
    if (!cmd) return next();

    const handler = handlers.get(cmd);
    if (!handler) return next();

    // Rewrite text so the command handler can parse the query normally
    const msg = ctx.message as unknown as Record<string, unknown>;
    msg.text = `/${cmd} ${ctx.message.text}`;

    return handler(ctx);
  });
}
