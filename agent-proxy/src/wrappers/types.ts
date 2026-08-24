// Common contract every CLI wrapper satisfies.

import type { CliAgentConfig } from '../types';
import type { ChatCompletionRequest } from '../types';

/** Anything that can write SSE bytes to a client. */
export interface SseWriter {
  write(chunk: string): void;
  end(): void;
}

export interface CliAgentWrapper {
  /** True if this wrapper knows how to handle the given agent type. */
  supports(type: string): boolean;
  /** Stream tokens. Writes OpenAI-compatible SSE chunks; returns the full reply. */
  streamChat(config: CliAgentConfig, request: ChatCompletionRequest, sse: SseWriter): Promise<string>;
  /** Non-streaming: collect full reply and return. */
  syncChat(config: CliAgentConfig, request: ChatCompletionRequest): Promise<string>;
}

/** Tiny SSE writer that pipes a Node Writable to a streamed HTTP response. */
export class HttpSseWriter implements SseWriter {
  constructor(private readonly out: NodeJS.WritableStream) {}
  write(chunk: string): void {
    this.out.write(chunk);
  }
  end(): void {
    // caller closes the response
  }
}
