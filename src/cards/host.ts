import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import type { Host } from "./types";

const CARD_NOTE = "The student pressed a button in the Shalav card. The card already did its part (for example chose the university or added a course). Their next message \"▶️ המשך\" / \"▶️ Continue\" means: call shalav_next_job now and do what it returns.";

/** The only place that touches the MCP Apps bridge (plan v2 risk table). */
export async function connectHost(): Promise<Host> {
  const app = new App({ name: "shalav-cards", version: "2.0.0" }, {});
  let last: unknown;
  const dataSubs = new Set<(d: unknown) => void>();
  const ctxSubs = new Set<() => void>();
  app.ontoolresult = (r) => {
    last = r.structuredContent;
    dataSubs.forEach((f) => f(last));
  };
  app.onhostcontextchanged = () => ctxSubs.forEach((f) => f());
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  return {
    callTool: (name, args) => app.callServerTool({ name, arguments: args }),
    say: async (text) => {
      // Hosts that pass model context get the meaning of the short line too (best effort; Claude may ignore it).
      await app.updateModelContext({ content: [{ type: "text", text: CARD_NOTE }] }).catch(() => undefined);
      await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    },
    context: () => app.getHostContext() ?? {},
    displayMode: async (mode) => (await app.requestDisplayMode({ mode })).mode,
    subscribe(onData, onContext) {
      dataSubs.add(onData);
      ctxSubs.add(onContext);
      if (last !== undefined) onData(last);
      return () => {
        dataSubs.delete(onData);
        ctxSubs.delete(onContext);
      };
    },
  };
}
