// Read ~/.hermes/config.yaml to find the minimax (minimax) provider's api_key.
// The Java MinimaxConfigLoader does a line-based scan: it walks until it finds
// "- name: minimax", then reads the next api_key: line. We keep that simple
// shape — full YAML parsing would be overkill for a single field.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

const PROVIDER_NAME = 'minimax';

let cachedKey: string | null | undefined; // undefined == not loaded yet

export function getAnthropicBaseUrl(): string {
  return 'https://api.minimaxi.com/anthropic';
}

export function getDefaultClaudeModel(): string {
  return 'MiniMax-M3';
}

/** Return the minimax api key from ~/.hermes/config.yaml (cached). */
export function loadMinimaxApiKey(): string | null {
  if (cachedKey !== undefined) return cachedKey;
  const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    logger.warn('hermes config not found:', configPath);
    cachedKey = null;
    return null;
  }
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    const lines = text.split(/\r?\n/);
    let inBlock = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line === `- name: ${PROVIDER_NAME}`) {
        inBlock = true;
        continue;
      }
      if (inBlock) {
        if (line.startsWith('- name:')) break; // next provider, stop
        if (line.startsWith('api_key:')) {
          const idx = line.indexOf(':');
          const key = idx >= 0 ? line.slice(idx + 1).trim() : '';
          if (key) {
            cachedKey = key;
            logger.info(
              'Loaded minimax api_key from hermes config:',
              key.slice(0, 15) + '...'
            );
            return key;
          }
        }
      }
    }
  } catch (e) {
    logger.warn('Failed to read hermes config.yaml:', e);
  }
  cachedKey = null;
  return null;
}

/** Force the cache to reload on the next call. Useful for tests. */
export function _resetMinimaxApiKeyCache(): void {
  cachedKey = undefined;
}
