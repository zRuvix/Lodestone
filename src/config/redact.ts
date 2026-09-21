const REDACTED = "[REDACTED]";

/** Replace every occurrence of each secret with [REDACTED]. */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out;
}
