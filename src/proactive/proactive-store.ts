/** Persistent config for proactive intelligence service. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProactiveConfig } from './proactive-types.js';
import { DEFAULT_PROACTIVE_CONFIG } from './proactive-types.js';

const CONFIG_PATH = join('data', 'proactive-config.json');

export async function loadProactiveConfig(): Promise<ProactiveConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_PROACTIVE_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PROACTIVE_CONFIG };
  }
}

export async function saveProactiveConfig(config: ProactiveConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
