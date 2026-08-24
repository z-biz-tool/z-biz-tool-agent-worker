// CLI auto-discovery: scan PATH + common bin dirs for hermes / opencode /
// claude. Mirrors Java CliDiscoveryService.discover/discoverAndRegister.

import { logger } from './logger';
import { probeVersion, resolveCommand } from './utils';
import { AgentRegistry } from './agentRegistry';
import type { DiscoveredCli } from './types';

const CLI_MAPPINGS: Array<[string, string]> = [
  ['claude', 'claude-code'],
  ['hermes', 'hermes'],
  ['opencode', 'opencode'],
];

export async function discover(): Promise<DiscoveredCli[]> {
  const out: DiscoveredCli[] = [];
  for (const [command, type] of CLI_MAPPINGS) {
    const resolved = resolveCommand(command);
    let version: string | null = null;
    if (resolved) {
      version = await probeVersion(resolved);
      logger.info(`Discovered CLI: ${type} at ${resolved} (v=${version || 'unknown'})`);
    } else {
      logger.info(`CLI not found: ${command} (type=${type})`);
    }
    out.push({
      type,
      command,
      resolvedPath: resolved,
      available: resolved !== null,
      version,
    });
  }
  return out;
}

/**
 * Discover and register new CLIs in the AgentRegistry. Existing entries with
 * the same type but a different command get replaced (nvm upgrade etc).
 */
export async function discoverAndRegister(registry: AgentRegistry): Promise<DiscoveredCli[]> {
  const found = await discover();
  for (const cli of found) {
    if (!cli.available) continue;
    const existing = registry.findByType(cli.type);
    if (!existing) {
      registry.register(cli.type, cli.type, cli.command, null, null);
      logger.info(`Registered CLI: ${cli.type} at ${cli.resolvedPath}`);
    } else if (cli.command !== existing.command) {
      registry.remove(existing.id);
      registry.register(cli.type, cli.type, cli.command, null, null);
      logger.info(`Updated CLI: ${cli.type} -> ${cli.resolvedPath}`);
    } else {
      logger.info(`CLI already registered: ${cli.type} at ${cli.resolvedPath}`);
    }
  }
  return found;
}
