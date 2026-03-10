/**
 * LLM prompt runner.
 * Priority: claude -p (fast, reliable via Max subscription) → DDG AI Chat fallback.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runViaDdgChat } from './ddg-chat.js';

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = 15_000;

interface RunOptions {
  timeoutMs?: number;
}

/* ── CLI provider ────────────────────────────────────────────────────── */

function isRecoverableCliError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('ENOENT') ||
    msg.includes('not recognized') ||
    msg.includes('Unknown option') ||
    msg.includes('unknown option') ||
    msg.includes('Usage:')
  );
}

async function runViaCli(prompt: string, timeoutMs: number): Promise<string | null> {
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const { stdout } = await execFileAsync('claude', ['-p', prompt, '--max-turns', '1'], {
      timeout: Math.min(timeoutMs, CLI_TIMEOUT_MS),
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      env,
    });
    const out = stdout.trim();
    return out || null;
  } catch (err) {
    if (isRecoverableCliError(err)) return null;
    return null;
  }
}

/**
 * Run a prompt against LLM providers.
 * Priority: claude -p (fast, Max subscription) → DDG AI Chat (Camoufox, free).
 * Returns null when no provider succeeds.
 */
export async function runLocalLlmPrompt(prompt: string, options: RunOptions = {}): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  // 1) Try claude -p CLI (fast, ~10s, uses Max subscription)
  const cliResult = await runViaCli(prompt, timeoutMs);
  if (cliResult) return cliResult;

  // 2) Fallback to DuckDuckGo AI Chat via Camoufox (free, slower)
  const ddgResult = await runViaDdgChat(prompt, timeoutMs);
  if (ddgResult) return ddgResult;

  return null;
}
