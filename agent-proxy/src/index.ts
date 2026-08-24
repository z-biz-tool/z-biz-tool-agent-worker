// Entry point. Wires the registries, runs CLI discovery, starts the HTTP
// server, and registers shutdown handlers.

import { config as appConfig } from './config';
import { logger } from './logger';
import { createServer } from './server';
import { AgentRegistry } from './agentRegistry';
import { SessionRegistry } from './sessionRegistry';
import { CliChatExecutor } from './executor';
import { CliAgentWrapperRegistry } from './wrappers/registry';
import { ClaudeCodeWrapper } from './wrappers/claudeCode';
import { HermesProcessWrapper } from './wrappers/hermes';
import { OpencodeProcessWrapper } from './wrappers/opencode';
import { discoverAndRegister } from './discovery';

async function main() {
  logger.info(`Starting agent-proxy on ${appConfig.host}:${appConfig.port}`);
  logger.info(`Persistence: ${appConfig.persistDir}`);

  const agentRegistry = new AgentRegistry(appConfig.persistDir);
  logger.info(`AgentRegistry loaded: ${agentRegistry.list().length} agents`);

  // discoverAndRegister is fire-and-forget; failures are logged.
  discoverAndRegister(agentRegistry)
    .then((found) => {
      logger.info(`After discovery: ${agentRegistry.list().length} agents registered`);
      const ok = found.filter((f) => f.available).length;
      logger.info(`Discovered ${ok}/${found.length} CLIs available locally`);
    })
    .catch((e) => logger.error('Discovery failed:', e));

  const sessionRegistry = new SessionRegistry(appConfig.persistDir);

  const wrapperRegistry = new CliAgentWrapperRegistry(
    new ClaudeCodeWrapper(),
    new HermesProcessWrapper(),
    new OpencodeProcessWrapper()
  );
  const executor = new CliChatExecutor(wrapperRegistry);

  const server = createServer({ agentRegistry, sessionRegistry, executor });

  await new Promise<void>((resolve) => {
    server.listen(appConfig.port, appConfig.host, () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : appConfig.port;
  logger.info(`agent-proxy ready on http://${appConfig.host}:${port}`);
  logger.info('  GET  /v1/cli-agents       — list discovered CLI agents');
  logger.info('  POST /v1/session/open     — create session (binds cliType), returns sessionId');
  logger.info('  POST /v1/chat/completions — chat (SSE/JSON, OpenAI compatible)');
  logger.info('  GET  /health              — health check');

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  logger.error('Fatal:', e);
  process.exit(1);
});
