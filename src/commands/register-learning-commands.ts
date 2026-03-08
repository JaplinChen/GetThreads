import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { executeLearn, formatLearnReport } from '../learning/learn-command.js';
import { executeReclassify } from '../learning/reclassify-command.js';
import { executeBatchTranslate } from '../learning/batch-translator.js';

export function registerLearningCommands(
  bot: Telegraf,
  config: AppConfig,
  formatErrorMessage: (err: unknown) => string,
): void {
  bot.command('learn', (ctx) => {
    ctx.reply('開始掃描 vault，完成後會通知你。').catch(() => {});
    executeLearn(config)
      .then((result) => ctx.reply(formatLearnReport(result)).catch(() => {}))
      .catch((err) => ctx.reply(formatErrorMessage(err)).catch(() => {}));
  });

  bot.command('reclassify', (ctx) => {
    ctx.reply('開始重新分類筆記，完成後會通知你。').catch(() => {});
    executeReclassify(config)
      .then((result) => {
        const lines = [`重新分類完成：${result.total} 篇筆記`, `搬移：${result.moved} 篇`];
        if (result.changes.length > 0) {
          lines.push('', '異動清單：');
          for (const c of result.changes.slice(0, 10)) {
            lines.push(`• ${c.from} → ${c.to}: ${c.file}`);
          }
          if (result.changes.length > 10) lines.push(`...等共 ${result.changes.length} 篇`);
        }
        ctx.reply(lines.join('\n')).catch(() => {});
      })
      .catch((err) => ctx.reply(formatErrorMessage(err)).catch(() => {}));
  });

  bot.command('translate', (ctx) => {
    ctx.reply('開始批次翻譯筆記，完成後會通知你。').catch(() => {});
    executeBatchTranslate(config)
      .then((r) => {
        const lines = [
          `批次翻譯完成：掃描 ${r.total} 篇`,
          `✅${r.translated} ⏭${r.skipped} 🈚${r.noNeed} ❌${r.failed}`,
        ];
        for (const d of r.details.slice(0, 15)) {
          lines.push(`• [${d.lang}] ${d.file.slice(0, 40)} ${d.status}`);
        }
        if (r.details.length > 15) lines.push(`...等共 ${r.details.length} 篇`);
        ctx.reply(lines.join('\n')).catch(() => {});
      })
      .catch((err) => ctx.reply(formatErrorMessage(err)).catch(() => {}));
  });
}
