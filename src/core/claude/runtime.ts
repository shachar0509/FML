import { ClaudeError } from "./errors";
import type { ClaudeGateway } from "./types";

let gateway: ClaudeGateway | undefined;

/** The Host Bridge is the gateway (no API key); set once by the server. */
export function setClaude(g: ClaudeGateway) {
  gateway = g;
}

export function claude(): ClaudeGateway {
  if (!gateway) throw new ClaudeError("auth", "Claude gateway not set");
  return gateway;
}
