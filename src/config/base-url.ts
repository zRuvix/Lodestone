export interface NormalizedBaseUrl {
  url: string;
  warnings: string[];
}

/**
 * Normalize the configured LLM base URL to what the Anthropic SDK expects.
 * The SDK appends `/v1/messages` itself, so a value already ending in
 * `/v1/messages` is stripped back to the base. OpenAI-style paths are
 * flagged since this client only speaks the Messages API.
 */
export function normalizeBaseUrl(raw: string): NormalizedBaseUrl {
  const warnings: string[] = [];
  let url = raw.trim().replace(/\/+$/, "");

  if (url.endsWith("/v1/messages")) {
    url = url.slice(0, -"/v1/messages".length).replace(/\/+$/, "");
    warnings.push(
      "llm.base_url included the full /v1/messages path; " +
        "the SDK appends it automatically, so it was stripped.",
    );
  }

  if (url.endsWith("/chat/completions")) {
    warnings.push(
      "llm.base_url looks like an OpenAI chat-completions URL; " +
        "this client uses the Anthropic Messages API (/v1/messages).",
    );
  }

  if (!/^https?:\/\//i.test(url)) {
    warnings.push(
      "llm.base_url does not start with http:// or https://; " +
        "it may be invalid.",
    );
  }

  return { url, warnings };
}
