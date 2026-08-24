// Persistent CLI agent registry: maps agentId -> CliAgentConfig, backed by a
// JSON file on disk. Mirrors Java CliAgentRegistry but kept minimal — we only
// need register/list/get/remove for the proxy to work.

import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { logger } from './logger';
import { expandHome } from './utils';
import type { CliAgentConfig } from './types';

export class AgentRegistry {
  private readonly agents = new Map<string, CliAgentConfig>();
  private readonly persistFile: string | null;

  constructor(persistDir: string | null = config.persistDir) {
    if (persistDir && persistDir.trim().length > 0) {
      const expanded = expandHome(persistDir) || persistDir;
      this.persistFile = path.join(expanded, 'cli-agents.json');
      this.loadFromFile();
    } else {
      this.persistFile = null;
    }
  }

  /** Register a new agent. Returns the stored config. */
  register(name: string, type: string, command: string, args: string[] | null, workingDir: string | null): CliAgentConfig {
    const id = `${type}-${randomId()}`;
    const cfg: CliAgentConfig = {
      id,
      name: name || type,
      type,
      command: command || defaultCommand(type),
      args: args && args.length > 0 ? [...args] : defaultArgs(type),
      workingDir: workingDir ? expandHome(workingDir) : null,
    };
    this.agents.set(id, cfg);
    this.saveToFile();
    logger.info(`Registered CLI agent: id=${id} name=${name} type=${type} command=${cfg.command}`);
    return cfg;
  }

  get(id: string): CliAgentConfig | undefined {
    return this.agents.get(id);
  }

  remove(id: string): boolean {
    const removed = this.agents.delete(id);
    if (removed) {
      this.saveToFile();
      logger.info(`Removed CLI agent: id=${id}`);
    }
    return removed;
  }

  list(): CliAgentConfig[] {
    return Array.from(this.agents.values());
  }

  /** Convenience: find a registered agent by type (first match). */
  findByType(type: string): CliAgentConfig | null {
    for (const cfg of this.agents.values()) {
      if (cfg.type === type) return cfg;
    }
    return null;
  }

  // ──────────── persistence ────────────

  private loadFromFile(): void {
    if (!this.persistFile || !fs.existsSync(this.persistFile)) return;
    try {
      const raw = fs.readFileSync(this.persistFile, 'utf-8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      for (const obj of arr) {
        if (!obj || typeof obj !== 'object') continue;
        const cfg: CliAgentConfig = {
          id: String(obj.id),
          name: String(obj.name || obj.type || 'agent'),
          type: String(obj.type),
          command: String(obj.command || defaultCommand(obj.type)),
          args: Array.isArray(obj.args) ? obj.args.map(String) : defaultArgs(obj.type),
          workingDir: obj.workingDir || null,
        };
        if (cfg.id && cfg.type) this.agents.set(cfg.id, cfg);
      }
      logger.info(`Loaded ${this.agents.size} CLI agents from ${this.persistFile}`);
    } catch (e) {
      logger.warn(`Failed to load CLI agents from ${this.persistFile}:`, e);
    }
  }

  private saveToFile(): void {
    if (!this.persistFile) return;
    try {
      const dir = path.dirname(this.persistFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const arr = Array.from(this.agents.values()).map((cfg) => ({
        id: cfg.id,
        name: cfg.name,
        type: cfg.type,
        command: cfg.command,
        args: cfg.args,
        workingDir: cfg.workingDir,
      }));
      fs.writeFileSync(this.persistFile, JSON.stringify(arr, null, 2));
    } catch (e) {
      logger.warn(`Failed to save CLI agents to ${this.persistFile}:`, e);
    }
  }
}

function defaultCommand(type: string): string {
  if (type === 'claude-code') return 'claude';
  if (type === 'hermes') return 'hermes';
  if (type === 'opencode') return 'opencode';
  return '';
}

export function defaultArgs(type: string): string[] {
  if (type === 'claude-code') {
    return [
      '-p', '{prompt}',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
  }
  if (type === 'hermes') return ['chat', '-q', '{prompt}', '-Q'];
  if (type === 'opencode') return ['run', '{prompt}'];
  return [];
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);
}
