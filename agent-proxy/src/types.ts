// Shared DTOs. Mirrors the Java DTOs but trimmed to what the proxy actually
// reads/writes — agents only ever call us with OpenAI-shaped bodies.

export interface ChatMessage {
  role?: 'system' | 'user' | 'assistant' | string;
  content?: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  sessionId?: string;
  agentType?: string;
  agentId?: string;
}

export interface CliAgentConfig {
  id: string;
  name: string;
  type: string;          // "claude-code" | "hermes" | "opencode"
  command: string;
  args: string[];
  workingDir?: string | null;
}

export interface DiscoveredCli {
  type: string;
  command: string;
  resolvedPath: string | null;
  available: boolean;
  version: string | null;
}
