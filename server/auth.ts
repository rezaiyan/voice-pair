// Access check for the local control port. The launcher creates a random token per session and
// hands it only to the hook shim and the `voice-pair status|mute|unmute|stop` commands (env var /
// a mode-600 file). Anything else on the machine — another process, or a web page making
// requests to 127.0.0.1 — gets refused.

import { timingSafeEqual } from "node:crypto";

export const TOKEN_HEADER = "x-voice-pair-token";

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns an error response to send back, or null when the request may proceed. */
export function rejectRequest(req: Request, token: string): Response | null {
  // Browsers attach Origin to cross-site requests; our legitimate clients (bun, curl) never do.
  if (req.headers.has("origin"))
    return new Response("forbidden", { status: 403 });
  const given = req.headers.get(TOKEN_HEADER) ?? "";
  if (!token || !sameToken(given, token))
    return new Response("unauthorized", { status: 401 });
  return null;
}
