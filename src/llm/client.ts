import Anthropic from "@anthropic-ai/sdk";
import type { LodestoneConfig } from "../config/schema.js";
import { redactSecrets } from "../config/redact.js";

export interface LlmRequestConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number | null;
  promptCaching: boolean;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  stream: boolean;
}

export function llmRequestConfigFromApp(
  config: LodestoneConfig,
  apiKey: string,
): LlmRequestConfig {
  return {
    apiKey,
    model: config.llm.model,
    maxTokens: config.llm.max_tokens,
    temperature: config.llm.temperature,
    promptCaching: config.llm.prompt_caching,
    extraHeaders: config.llm.extra_headers,
    timeoutMs: config.llm.request_timeout_seconds * 1000,
    maxRetries: config.llm.max_retries,
    stream: config.llm.stream,
  };
}

export interface LlmClient {
  /** Raw SDK client for messages.create / messages.stream. */
  raw: Anthropic;
  requestConfig: LlmRequestConfig;
  authType: "api_key" | "bearer";
  /**
   * Run fn with retries on 429/5xx (exponential backoff). Other 4xx fail
   * fast with a redacted, hint-bearing error.
   */
  withRetries<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

/**
 * Classify an API error. Returns { retryable, status, hint }.
 * Never includes the key — callers must redact before logging.
 */
export function classifyApiError(err: unknown): {
  retryable: boolean;
  status: number | null;
  hint: string;
} {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status: unknown }).status)
      : null;

  if (status === 429) {
    return {
      retryable: true,
      status,
      hint: "Rate limited (429). Backing off and retrying.",
    };
  }
  if (status !== null && status >= 500) {
    return {
      retryable: true,
      status,
      hint: `Server error (${status}). Backing off and retrying.`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      retryable: false,
      status,
      hint: "Authentication failed. Check the API key env var value and auth_type.",
    };
  }
  if (status === 404) {
    return {
      retryable: false,
      status,
      hint: "Not found (404). Check base_url (must not include /v1/messages) and model ID.",
    };
  }
  if (status === 400) {
    return {
      retryable: false,
      status,
      hint: "Bad request (400). The endpoint may reject a parameter (e.g. temperature, tools) or the model ID may be unknown.",
    };
  }
  if (status !== null && status >= 400 && status < 500) {
    return {
      retryable: false,
      status,
      hint: `Request failed with status ${status}. Not retrying.`,
    };
  }
  return {
    retryable: true,
    status,
    hint: "Network or unknown error. Retrying.",
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Aborted"));
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function formatApiError(err: unknown, apiKey: string): Error {
  const { status, hint } = classifyApiError(err);
  const rawMessage = err instanceof Error ? err.message : String(err);
  const type =
    typeof err === "object" && err !== null && "error" in err
      ? JSON.stringify((err as { error: unknown }).error)
      : err instanceof Error
        ? err.name
        : "UnknownError";
  const message = redactSecrets(
    `LLM request failed${status !== null ? ` (HTTP ${status})` : ""}: ${type}. Hint: ${hint} Details: ${rawMessage}`,
    [apiKey],
  );
  const out = new Error(message);
  if (status !== null) (out as { status?: number }).status = status;
  return out;
}

export function createLlmClient(
  config: LodestoneConfig,
  apiKey: string,
): LlmClient {
  const requestConfig = llmRequestConfigFromApp(config, apiKey);
  const authType = config.llm.auth_type;

  const raw = new Anthropic({
    baseURL: config.llm.base_url,
    // apiKey -> x-api-key header; authToken -> Authorization: Bearer.
    ...(authType === "bearer" ? { authToken: apiKey } : { apiKey }),
    defaultHeaders:
      Object.keys(config.llm.extra_headers).length > 0
        ? config.llm.extra_headers
        : undefined,
    timeout: requestConfig.timeoutMs,
    maxRetries: 0, // we handle retries ourselves for redacted errors + backoff
  });

  async function withRetries<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw new Error("Aborted");
      try {
        return await fn();
      } catch (err) {
        const { retryable } = classifyApiError(err);
        if (!retryable || attempt >= requestConfig.maxRetries) {
          throw formatApiError(err, apiKey);
        }
        attempt += 1;
        await sleep(1000 * 2 ** (attempt - 1), signal);
      }
    }
  }

  return { raw, requestConfig, authType, withRetries };
}
