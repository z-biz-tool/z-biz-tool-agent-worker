// Centralized config: port, persistence dir, gateway URLs, command defaults.
// Mirrors the Java ProxyApplication defaults; lives at the top so every module
// can import a single source of truth.

import * as os from 'os';
import * as path from 'path';

export interface AppConfig {
  host: string;
  port: number;
  persistDir: string;
  sessionPersistFile: string;
  agentsPersistFile: string;
  /** Local hermes gateway HTTP base (Java proxy hardcoded this same address). */
  hermesGatewayUrl: string;
  /** File containing the hermes API key. Java reads /tmp/hermes_api_key.txt. */
  hermesApiKeyFile: string;
  /** Local opencode server HTTP base. */
  opencodeServerUrl: string;
  /** Subprocess timeout for fallback path. */
  processTimeoutMs: number;
  /** Anthropic-compatible base URL injected into claude-code child process. */
  anthropicBaseUrl: string;
  /** Default model name injected into claude-code when config omits --model. */
  defaultClaudeModel: string;
}

const DEFAULT_PORT = 9099;
const DEFAULT_PERSIST_DIR = path.join(os.homedir(), '.future-team');
const HERMES_GATEWAY_URL = 'http://127.0.0.1:8642/v1/chat/completions';
const OPENCODE_SERVER_URL = 'http://127.0.0.1:8643';
const HERMES_API_KEY_FILE = '/tmp/hermes_api_key.txt';
const ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
const DEFAULT_CLAUDE_MODEL = 'MiniMax-M3';
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

function parsePort(): number {
  const flag = process.argv.find((a) => a === '--port' || a.startsWith('--port='));
  if (!flag) return DEFAULT_PORT;
  const val = flag.includes('=') ? flag.split('=')[1] : process.argv[process.argv.indexOf(flag) + 1];
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

function parsePersistDir(): string {
  const flag = process.argv.find((a) => a === '--persist-dir' || a.startsWith('--persist-dir='));
  if (!flag) return DEFAULT_PERSIST_DIR;
  const val = flag.includes('=') ? flag.split('=')[1] : process.argv[process.argv.indexOf(flag) + 1];
  return val && val.trim().length > 0 ? expandHome(val) : DEFAULT_PERSIST_DIR;
}

function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

export const config: AppConfig = {
  host: '127.0.0.1',
  port: parsePort(),
  persistDir: parsePersistDir(),
  sessionPersistFile: path.join(parsePersistDir(), 'sessions.json'),
  agentsPersistFile: path.join(parsePersistDir(), 'cli-agents.json'),
  hermesGatewayUrl: HERMES_GATEWAY_URL,
  hermesApiKeyFile: HERMES_API_KEY_FILE,
  opencodeServerUrl: OPENCODE_SERVER_URL,
  processTimeoutMs: PROCESS_TIMEOUT_MS,
  anthropicBaseUrl: ANTHROPIC_BASE_URL,
  defaultClaudeModel: DEFAULT_CLAUDE_MODEL,
};
