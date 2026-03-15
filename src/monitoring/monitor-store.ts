/** Persistent config for self-healing monitoring. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MonitorConfig } from './health-types.js';
import { DEFAULT_MONITOR_CONFIG } from './health-types.js';

const CONFIG_PATH = join('data', 'monitor-config.json');

export async function loadMonitorConfig(): Promise<MonitorConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_MONITOR_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_MONITOR_CONFIG };
  }
}

export async function saveMonitorConfig(config: MonitorConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
