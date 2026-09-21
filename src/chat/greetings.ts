const PREFIX = /^\s*agent\b[,\s]*/i;
const GREETING = /^(hi+|hello|hey|namaste|salaam|yo)\b/i;

export function isGreeting(text: string): boolean {
  const stripped = text.replace(PREFIX, "").trim();
  return GREETING.test(stripped) && stripped.split(/\s+/).length <= 2;
}
