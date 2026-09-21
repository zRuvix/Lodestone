export const HEARTBEAT_PROMPT =
  "[heartbeat] Nothing new has happened. Observe briefly; if there's a pending task in TASKS.md or something worth doing nearby, do one small thing, otherwise stay quiet.";

export function shouldSkipHeartbeatTick(isBusy: boolean): boolean {
  return isBusy;
}
