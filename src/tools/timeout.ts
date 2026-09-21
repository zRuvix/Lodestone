/** Run fn with a timeout and abort-signal support. */
export function withToolTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outerSignal: AbortSignal,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (outerSignal.aborted) {
      reject(new Error("Tool cancelled"));
      return;
    }
    const controller = new AbortController();
    const onOuterAbort = () => {
      clearTimeout(timer);
      controller.abort();
      reject(new Error("Tool cancelled"));
    };
    const timer = setTimeout(() => {
      cleanup();
      controller.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      outerSignal.removeEventListener("abort", onOuterAbort);
    };
    outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    fn(controller.signal).then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e) => {
        cleanup();
        reject(e);
      },
    );
  });
}

/** Wrap a tool run so handler exceptions become { text, isError: true }. */
export async function safeRun(
  fn: () => Promise<{ text: string; isError: boolean }>,
): Promise<{ text: string; isError: boolean }> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: `Error: ${message}`, isError: true };
  }
}
