/**
 * LlmClient — abstraction برای فراخوانی مدل‌های زبانی بزرگ.
 *
 * Implementations:
 * - OpenAILlmClient: هر provider سازگار با OpenAI API (OpenAI، OpenRouter، local Llama.cpp server، Ollama با OpenAI-compatible endpoint)
 */

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmCompletionOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
}

export interface LlmCompletionResult {
  readonly content: string;
  readonly model: string;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface LlmClientConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface ILlmClient {
  readonly config: LlmClientConfig;
  complete(messages: readonly LlmMessage[], options?: LlmCompletionOptions): Promise<LlmCompletionResult>;
  dispose(): Promise<void>;
}
