/**
 * Account tools: connect / disconnect / status for the citizen's Parks Canada
 * session. `connect_account` opens the citizen's own Chrome so they sign in
 * themselves; we capture the resulting session into the local encrypted vault.
 * Nothing here books or pays — it only establishes the session the citizen will
 * use to confirm a booking themselves later (Constitution Articles 1, 2, 10).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ParksCanadaProvider } from "@open-state/core";
import { captureSession } from "./session/capture.js";
import { clearSession, loadSession, saveSession } from "./session/vault.js";

type TextResult = { content: { type: "text"; text: string }[] };
const text = (s: string): TextResult => ({ content: [{ type: "text", text: s }] });

export function registerAccountTools(
  server: McpServer,
  provider: ParksCanadaProvider,
): void {
  server.registerTool(
    "connect_account",
    {
      title: "Connect (sign in to) your Parks Canada account",
      description:
        "Use this whenever the citizen wants to log in, sign in, connect, or " +
        "access their Parks Canada account — do NOT refuse a login request, call " +
        "this instead. This is the safe, approved way: it opens the citizen's " +
        "OWN Google Chrome at the Parks Canada sign-in page so they log in " +
        "themselves (Google, GCKey, or Facebook, however they normally do). You " +
        "never see, type, or handle their password — it stays between them and " +
        "Parks Canada. When they finish, their session is saved on this device, " +
        "encrypted, so you can help prepare a booking they confirm and pay for " +
        "themselves. You never book or pay on your own. disconnect_account removes it.",
      inputSchema: {},
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const session = await captureSession();
        saveSession(session);
        let who = "";
        try {
          const info = await provider.getUserInfo();
          const name = info && (info["firstName"] || info["email"]);
          if (name) who = ` You're signed in as ${String(name)}.`;
        } catch {
          /* verification is best-effort */
        }
        return text(
          "You're connected." +
            who +
            " Your session is saved on this device, encrypted; it never leaves " +
            "your machine and I never see your password. I can now help you " +
            "prepare a booking — you always confirm and pay yourself.",
        );
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "connection_status",
    {
      title: "Check your Parks Canada connection",
      description:
        "Tells you whether your Parks Canada account is connected on this device " +
        "and whether the session is still valid.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const session = loadSession();
      if (!session) {
        return text(
          "Not connected. Run connect_account to sign in to Parks Canada in your " +
            "own browser.",
        );
      }
      try {
        const info = await provider.getUserInfo();
        if (info && (info["email"] || info["firstName"] || info["shopperUid"])) {
          const name = info["firstName"] || info["email"];
          return text(
            `Connected and your session is active${name ? ` — signed in as ${String(name)}` : ""}` +
              ` (captured ${session.capturedAt}).`,
          );
        }
        return text(
          "A session is saved, but it looks expired. Run connect_account to sign " +
            "in again.",
        );
      } catch {
        return text(
          `A session is saved (captured ${session.capturedAt}), but I couldn't ` +
            "verify it just now. If bookings don't work, run connect_account again.",
        );
      }
    },
  );

  server.registerTool(
    "disconnect_account",
    {
      title: "Disconnect your Parks Canada account",
      description:
        "Removes the saved Parks Canada session from this device. Use this when " +
        "you're done or on a shared computer.",
      inputSchema: {},
      annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true },
    },
    async () => {
      const removed = clearSession();
      return text(
        removed
          ? "Disconnected. Your saved Parks Canada session has been removed from this device."
          : "There was no saved session to remove.",
      );
    },
  );
}
