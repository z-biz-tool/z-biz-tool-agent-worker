// GET /v1/cli-agents — list discovered CLIs (real-time PATH scan + registry
// join). Mirrors Java ProxyCliListHandler.

import type { IncomingMessage, ServerResponse } from 'http';
import { discover } from '../discovery';
import { sendError, sendJson, setCors } from './common';
import type { AgentRegistry } from '../agentRegistry';
import type { DiscoveredCli } from '../types';

export function makeCliListHandler(registry: AgentRegistry) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      sendError(res, 405, `Method not allowed: ${req.method}`);
      return;
    }
    const found: DiscoveredCli[] = await discover();
    const agents = found.map((cli) => {
      const registered = registry.findByType(cli.type);
      return {
        type: cli.type,
        command: cli.command,
        path: cli.resolvedPath,
        available: cli.available,
        version: cli.version,
        registered: !!registered,
        agent_id: registered ? registered.id : null,
      };
    });
    sendJson(res, 200, { cli_agents: agents });
  };
}
