import type { UIMessage } from "ai";

export type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
};

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  calls: 0,
};

export function sumTokenUsage(messages: UIMessage[]): TokenUsage {
  const total = { ...EMPTY_TOKEN_USAGE };
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (seen.has(message.id)) continue;

    seen.add(message.id);

    const metadata = message.metadata as
      | { usage?: Partial<TokenUsage> }
      | undefined;

    const usage = metadata?.usage;
    if (!usage) continue;

    total.prompt_tokens += usage.prompt_tokens ?? 0;
    total.completion_tokens += usage.completion_tokens ?? 0;
    total.total_tokens += usage.total_tokens ?? 0;
    total.calls += usage.calls ?? 0;
  }

  return total;
}
