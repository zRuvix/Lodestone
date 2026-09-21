// src/chat/router.ts
export function formatChatInject(username: string, message: string): string {
  return `<${username}> said: ${message}`;
}

export function isSelf(username: string, botUsername: string): boolean {
  return username === botUsername;
}

export function createSayLimiter(cfg: { reply_cooldown_seconds: number; max_replies_per_minute: number }): { trySay(): boolean } {
  let lastAt = 0;
  const windowStart: number[] = [];
  return {
    trySay(): boolean {
      const now = Date.now();
      if (now - lastAt < cfg.reply_cooldown_seconds * 1000) return false;
      while (windowStart.length > 0 && now - windowStart[0]! > 60_000) windowStart.shift();
      if (windowStart.length >= cfg.max_replies_per_minute) return false;
      lastAt = now;
      windowStart.push(now);
      return true;
    },
  };
}
