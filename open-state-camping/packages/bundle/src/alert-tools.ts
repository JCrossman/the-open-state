/**
 * Alert tools: set / list / delete a cancellation watch. A watch saves a search and
 * the local poller re-runs it on a polite schedule; when a site opens, the citizen is
 * notified via a notification link they control (ntfy). No identity, account, or
 * credential is stored — only the search and the optional notify link (Constitution
 * Arts. 1, 5). This never books; the citizen confirms in their own session (Art. 2).
 *
 * NOTE: the local bundle runs over stdio, so the poller only checks while the citizen's
 * assistant is connected to this MCP. A watch persists on disk, but notifications fire
 * only while a session is live — stated plainly to the citizen below.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ParksCanadaProvider,
  allowedNotifyHosts,
  generateChannel,
  sendMessage,
  validateNotifyTarget,
  InvalidInputError,
} from "@open-state/core";
import type { BundleConfig } from "./config.js";
import { AlertStore } from "./alerts/store.js";
import * as fmt from "./format.js";

type TextResult = { content: { type: "text"; text: string }[] };
const text = (s: string): TextResult => ({ content: [{ type: "text", text: s }] });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-07-17 (YYYY-MM-DD).");

export function registerAlertTools(
  server: McpServer,
  provider: ParksCanadaProvider,
  config: BundleConfig,
  store: AlertStore,
): void {
  server.registerTool(
    "create_alert",
    {
      title: "Set a cancellation alert",
      description:
        "Watch a campground for openings and tell the citizen when one appears. Use " +
        "this when a search finds nothing but the citizen wants to be told if a " +
        "cancellation frees a site. It saves the search and re-checks it on a polite " +
        "schedule (never faster than every 5 minutes). For push notifications set " +
        "notify_target='auto' and I'll create a private, unguessable ntfy.sh channel " +
        "(no sign-up) and send a test message; or pass an ntfy link the citizen " +
        "already controls; or leave it empty for a silent watch they check with " +
        "list_alerts. Note: this runs locally, so it only checks while the assistant " +
        "is connected. No account or personal data is stored — only the search and " +
        "the notify link. This never books.",
      inputSchema: {
        campground_id: z.string(),
        start_date: isoDate,
        end_date: isoDate,
        party_size: z.number().int().positive(),
        recreation_area_id: z.string().optional(),
        equipment_type: z.string().optional(),
        accessible_only: z.boolean().optional(),
        nights: z.number().int().positive().optional(),
        weekends_only: z.boolean().optional(),
        notify_target: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const dateIssue = fmt.stayDatesProblem(args.start_date, args.end_date);
        if (dateIssue) return text(dateIssue);
        // Bound concurrent watches — each is polled, so an unbounded count is
        // unbounded upstream load (Art. 7.3).
        if (store.countActive() >= config.maxActiveAlerts) {
          return text(
            "I'm already watching the most campgrounds I can keep track of. Delete a " +
              "watch you no longer need (ask me to list your alerts) and try again.",
          );
        }
        let notifyTarget = args.notify_target ?? null;
        let channel: ReturnType<typeof generateChannel> | null = null;
        if (notifyTarget === "auto") {
          channel = generateChannel(config.ntfyBase);
          notifyTarget = channel.subscribeUrl;
        } else if (notifyTarget) {
          // A citizen-supplied link is a POST target we'll hit — it must be a known
          // notification host, never a private/internal address (SSRF/open-relay).
          try {
            validateNotifyTarget(
              notifyTarget,
              allowedNotifyHosts({ ntfyBase: config.ntfyBase, extraHosts: config.notifyAllowedHosts }),
            );
          } catch (e) {
            if (e instanceof InvalidInputError) return text(e.message);
            throw e;
          }
        }
        const alert = store.add({
          provider: ParksCanadaProvider.providerName,
          recreationAreaId: args.recreation_area_id ?? config.recreationAreaId,
          campgroundId: args.campground_id,
          startDate: args.start_date,
          endDate: args.end_date,
          partySize: args.party_size,
          equipmentType: args.equipment_type ?? null,
          accessibleOnly: args.accessible_only ?? false,
          nights: args.nights ?? null,
          weekendsOnly: args.weekends_only ?? false,
          notifyTarget,
        });

        // Best-effort test ping for an auto channel so the citizen can confirm delivery.
        let testOk: boolean | null = null;
        if (channel) {
          try {
            testOk = await sendMessage(
              channel.subscribeUrl,
              "This is a test from The Open State. Your campsite alerts will arrive " +
                "here. You can mute or delete this topic at any time.",
              { title: "Open State alert channel ready" },
            );
          } catch {
            testOk = false;
          }
        }

        const stay = `${args.start_date} to ${args.end_date}`;
        const lines = [
          `Done. I'm now watching that campground for ${stay}, party of ${args.party_size}` +
            (args.accessible_only ? " (accessible sites only)" : "") +
            `. Your watch id is ${alert.id}.`,
          `I check about every ${config.pollIntervalMinutes} minutes (never faster than ` +
            `every 5) — while this assistant is connected.`,
        ];
        if (channel) {
          lines.push(
            "I set up a private notification channel for you — no sign-up needed. Open " +
              "this to subscribe:\n  " + channel.subscribeUrl,
            "On a phone with the ntfy app, this opens it directly:\n  " + channel.appUrl,
          );
          if (testOk) {
            lines.push("I sent a test message to it — check it arrived so you know it's working.");
          } else if (testOk === false) {
            lines.push("My test message didn't go through just now, but the channel is saved and I'll retry when a site opens.");
          }
        } else if (notifyTarget) {
          lines.push("When a site opens I'll message your notification link with the details.");
        } else {
          lines.push("Ask me to list your alerts to see whether anything has opened up.");
        }
        return text(lines.join("\n"));
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "list_alerts",
    { title: "List your cancellation alerts", annotations: { readOnlyHint: true } },
    async () => {
      try {
        const alerts = store.listAll();
        if (alerts.length === 0) return text("You have no saved alerts.");
        const lines = [`You have ${alerts.length} saved alert(s):`, ""];
        for (const a of alerts) {
          const status =
            a.status === "fired" ? "a site has opened — check your notification" : "watching";
          let detail = `- ${a.id}: campground ${a.campgroundId}, ${a.startDate} to ${a.endDate}, party of ${a.partySize}`;
          if (a.accessibleOnly) detail += ", accessible only";
          detail += ` — ${status}.`;
          if (a.lastResult) detail += ` Last check: ${a.lastResult}.`;
          lines.push(detail);
        }
        return text(lines.join("\n"));
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "delete_alert",
    {
      title: "Delete a cancellation alert",
      inputSchema: { alert_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        return text(
          store.delete(args.alert_id)
            ? `Deleted alert ${args.alert_id}.`
            : `I couldn't find an alert with id ${args.alert_id}.`,
        );
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );
}
