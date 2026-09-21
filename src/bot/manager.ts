import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import type { LodestoneConfig } from "../config/schema.js";

export type BotEvent = "damage" | "chat" | "death" | "health";

export interface BotManager {
  events: EventEmitter;
  connect(): Promise<Bot>;
  getBot(): Bot | null;
  disconnect(reason?: string): void;
}

/**
 * Create and manage the Mineflayer bot: connect/spawn, kick/error/end
 * handling, and re-emitted damage/chat/death/health events.
 */
export function createBotManager(config: LodestoneConfig): BotManager {
  const events = new EventEmitter();
  let bot: Bot | null = null;
  let settled = false;

  async function connect(): Promise<Bot> {
    const mineflayer = await import("mineflayer");
    const mc = config.minecraft;
    const timeoutMs = mc.connect_timeout_seconds * 1000;

    return new Promise<Bot>((resolve, reject) => {
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else if (bot) resolve(bot);
        else reject(new Error("Connect finished without a bot"));
      };

      const timer = setTimeout(() => {
        bot?.quit("connect timeout");
        finish(
          new Error(
            `Timed out connecting to ${mc.host}:${mc.port} after ${mc.connect_timeout_seconds}s.`,
          ),
        );
      }, timeoutMs);

      const b = mineflayer.createBot({
        host: mc.host,
        port: mc.port,
        version: mc.version,
        username: mc.username,
        // minecraft-protocol: 'offline' needs no credentials; 'microsoft' triggers device auth.
        auth: mc.auth === "microsoft" ? "microsoft" : "offline",
      });
      bot = b as unknown as Bot;

      b.once("spawn", () => {
        wireRuntimeEvents(b);
        finish();
      });
      b.once("kicked", (reason: string) => {
        finish(new Error(`Kicked from server: ${reason}`));
      });
      b.once("error", (err: Error) => {
        finish(new Error(`Bot error: ${err.message}`));
      });
      // 'end' before spawn means the connection died; after spawn it's a disconnect.
      b.once("end", (reason: string) => {
        events.emit("end", reason);
        finish(new Error(`Connection ended: ${reason}`));
      });
    });
  }

  function wireRuntimeEvents(b: Bot) {
    b.on("entityHurt", () => {
      events.emit("damage");
    });
    b.on("chat", (username: string, message: string) => {
      events.emit("chat", username, message);
    });
    b.on("death", () => {
      events.emit("death");
    });
    b.on("health", () => {
      events.emit("health");
    });
  }

  return {
    events,
    connect,
    getBot: () => bot,
    disconnect: (reason?: string) => {
      bot?.quit(reason);
      bot = null;
      settled = false;
    },
  };
}
