/**
 * ForceReply utilities — embed command tags in bot prompts
 * so the message handler can route replies back to the right command.
 */

/** Zero-width space used as invisible delimiter */
const ZWS = '\u200B';

/** Tag prefix/suffix for command embedding */
const TAG_PREFIX = `${ZWS}[cmd:`;
const TAG_SUFFIX = `]${ZWS}`;

/** Regex to extract command tag from text */
const TAG_RE = /\u200B\[cmd:(\w+)\]\u200B/;

/**
 * Embed a command tag at the start of a prompt message.
 * The tag is invisible to users but parseable by the bot.
 *
 * @example tagForceReply('search', '請輸入搜尋關鍵字：')
 * // → '\u200B[cmd:search]\u200B 請輸入搜尋關鍵字：'
 */
export function tagForceReply(command: string, text: string): string {
  return `${TAG_PREFIX}${command}${TAG_SUFFIX} ${text}`;
}

/**
 * Parse the command name from a tagged prompt message.
 * Returns null if no tag found.
 */
export function parseForceReplyTag(text: string): string | null {
  const m = TAG_RE.exec(text);
  return m ? m[1] : null;
}

/**
 * Build Telegraf reply_markup for ForceReply.
 * Forces the user's client to open a reply interface.
 */
export function forceReplyMarkup(placeholder?: string) {
  return {
    reply_markup: {
      force_reply: true as const,
      selective: true,
      input_field_placeholder: placeholder,
    },
  };
}
