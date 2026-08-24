// Map agent type -> wrapper. The Java version is a tiny list-of-wrappers
// with a linear scan; we use a Map for the same O(1) lookup.

import type { CliAgentWrapper } from './types';
import { ClaudeCodeWrapper } from './claudeCode';
import { HermesProcessWrapper } from './hermes';
import { OpencodeProcessWrapper } from './opencode';

export class CliAgentWrapperRegistry {
  private readonly wrappers: CliAgentWrapper[];
  private readonly byType = new Map<string, CliAgentWrapper>();

  constructor(...wrappers: CliAgentWrapper[]) {
    this.wrappers = wrappers;
    for (const w of wrappers) {
      // Each wrapper picks exactly one type; re-run supports() for safety.
      for (const t of ['claude-code', 'hermes', 'opencode']) {
        if (w.supports(t) && !this.byType.has(t)) this.byType.set(t, w);
      }
    }
  }

  get(type: string | null | undefined): CliAgentWrapper | null {
    if (!type) return null;
    return this.byType.get(type) || null;
  }

  has(type: string | null | undefined): boolean {
    return this.get(type) !== null;
  }

  all(): CliAgentWrapper[] {
    return [...this.wrappers];
  }
}
