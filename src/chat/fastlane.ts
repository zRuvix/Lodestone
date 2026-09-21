import { isGreeting } from "./greetings.js";
import type { LlmClient } from "../llm/client.js";

export interface ChatLaneDeps {
  llm: LlmClient;
  say: (msg: string) => void;
  forward: (text: string) => void;
  limiter: { trySay(): boolean };
  fastMaxTokens: number;
  botName: string;
}

const CLASSIFIER_SYSTEM =
  "You are the chat fast-lane for a Minecraft bot. Reply in the player's language (Hindi/Hinglish/English as they use). " +
  "Answer with exactly one line starting with SAY: (a short chat reply that fully handles the message — greetings, questions, small talk) " +
  "or DO: (a very short acknowledgement like 'samajh gaya' — use when the player wants the bot to DO something in-game: follow, collect, craft, attack, drop, build). " +
  "Keep it under 20 words.";

const GREETING_REPLIES = ["namaste! 👋", "hey! kya chal raha hai?", "hi! bolo kya chahiye?"];

export function createChatLane(deps: ChatLaneDeps): { handleChat(username: string, message: string): Promise<void> } {
  let seq = 0; // newest-wins generation counter

  function pickGreeting(): string {
    return GREETING_REPLIES[Math.floor(Math.random() * GREETING_REPLIES.length)]!;
  }

  async function handleChat(username: string, message: string): Promise<void> {
    const mySeq = ++seq;
    const fresh = () => mySeq === seq;

    if (isGreeting(message)) {
      if (deps.limiter.trySay()) deps.say(pickGreeting());
      return; // never forwarded — greetings are fully handled here
    }

    let line: string;
    try {
      const raw = await deps.llm.withRetries(
        () =>
          deps.llm.raw.messages.create(
            {
              model: deps.llm.requestConfig.model,
              max_tokens: deps.fastMaxTokens,
              system: CLASSIFIER_SYSTEM,
              messages: [{ role: "user", content: `<${username}> said: ${message}` }],
            },
            undefined,
          ),
      );
      if (!fresh()) return; // superseded while classifying
      const blocks = (raw as { content?: { type?: string; text?: string }[] }).content ?? [];
      line = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ").trim();
    } catch {
      if (!fresh()) return;
      // Classifier failed: fail open toward the main loop so work isn't lost.
      deps.forward(`<${username}> said: ${message}`);
      return;
    }

    if (/^SAY:/i.test(line)) {
      if (!fresh()) return;
      const reply = line.replace(/^SAY:/i, "").trim().slice(0, 256) || "...";
      if (deps.limiter.trySay()) deps.say(reply);
      // SAY is terminal: never forwarded. Double-reply impossible by construction.
    } else if (/^DO:/i.test(line)) {
      const ack = line.replace(/^DO:/i, "").trim().slice(0, 256) || "samajh gaya 👍";
      if (deps.limiter.trySay()) deps.say(ack);
      if (!fresh()) return;
      deps.forward(`<${username}> said: ${message}`);
    } else {
      // Unparseable classifier output: fail open to main loop.
      if (fresh()) deps.forward(`<${username}> said: ${message}`);
    }
  }

  return { handleChat };
}
