// The AG Studio adapter for the desk agent (plan item C13). It runs in the browser and sends each
// turn to this app's own route, which holds the API key and calls Claude; the reply comes back in
// one piece and is replayed to Studio as a stream.
import type { AgAiEvent, AgLlmAdapter, AgLlmResponse } from "ag-studio";
import { eventsOf, failed } from "./studio-llm.ts";

export function deskAdapter(endpoint: string): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const complete = (async (): Promise<AgLlmResponse> => {
        try {
          const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: options?.signal ?? null });
          const res = (await r.json()) as AgLlmResponse;
          return r.ok ? res : res.error ? res : failed(`http_${r.status}`, `The desk agent failed (${r.status}).`);
        } catch (err) {
          if (options?.signal?.aborted) return { ...failed("cancelled", "Stopped."), status: "cancelled" };
          return failed("network", err instanceof Error ? err.message : "The desk agent could not be reached.");
        }
      })();
      const stream = {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgAiEvent> {
          yield* eventsOf(await complete);
        },
      };
      return { stream, complete };
    },
  };
}
