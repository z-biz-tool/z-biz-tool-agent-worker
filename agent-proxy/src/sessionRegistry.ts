// Session registry: maps sessionId -> { cliType, agentId }, persisted to
// sessions.json. Lets clients open a session once and route by session ID only.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from './config';
import { logger } from './logger';
import { expandHome } from './utils';

interface PersistedSession {
  sessionId: string;
  cliType?: string | null;
  agentId?: string | null;
  createdAt?: number;
}

export class SessionRegistry {
  private readonly sessionCliTypes = new Map<string, string>();
  private readonly sessionAgentIds = new Map<string, string>();
  private readonly persistFile: string | null;

  constructor(persistDir: string | null = config.persistDir) {
    if (persistDir && persistDir.trim().length > 0) {
      const expanded = expandHome(persistDir) || persistDir;
      this.persistFile = path.join(expanded, 'sessions.json');
      this.loadFromFile();
    } else {
      this.persistFile = null;
    }
  }

  openSession(cliType: string | null, agentId: string | null): string {
    const sessionId = crypto.randomUUID();
    if (cliType) this.sessionCliTypes.set(sessionId, cliType);
    if (agentId) this.sessionAgentIds.set(sessionId, agentId);
    this.saveToFile();
    logger.info(`Session opened: ${sessionId} cliType=${cliType || '-'} agentId=${agentId || '-'}`);
    return sessionId;
  }

  getCliType(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    return this.sessionCliTypes.get(sessionId) || null;
  }

  getAgentId(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    return this.sessionAgentIds.get(sessionId) || null;
  }

  // ──────────── persistence ────────────

  private loadFromFile(): void {
    if (!this.persistFile || !fs.existsSync(this.persistFile)) return;
    try {
      const raw = fs.readFileSync(this.persistFile, 'utf-8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      for (const obj of arr as PersistedSession[]) {
        if (!obj || !obj.sessionId) continue;
        if (obj.cliType) this.sessionCliTypes.set(obj.sessionId, obj.cliType);
        if (obj.agentId) this.sessionAgentIds.set(obj.sessionId, obj.agentId);
      }
      logger.info(`Loaded ${this.sessionCliTypes.size} sessions from ${this.persistFile}`);
    } catch (e) {
      logger.warn(`Failed to load sessions from ${this.persistFile}:`, e);
    }
  }

  private saveToFile(): void {
    if (!this.persistFile) return;
    try {
      const dir = path.dirname(this.persistFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const ids = new Set<string>([
        ...this.sessionCliTypes.keys(),
        ...this.sessionAgentIds.keys(),
      ]);
      const arr: PersistedSession[] = [];
      for (const id of ids) {
        arr.push({
          sessionId: id,
          cliType: this.sessionCliTypes.get(id) || null,
          agentId: this.sessionAgentIds.get(id) || null,
          createdAt: Date.now(),
        });
      }
      fs.writeFileSync(this.persistFile, JSON.stringify(arr, null, 2));
    } catch (e) {
      logger.warn(`Failed to save sessions to ${this.persistFile}:`, e);
    }
  }
}
