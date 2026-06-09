/**
 * Policy tool: answer "what are the rules?" — Parks Canada's reservation policies
 * (fees, change/cancel deadlines, check-in times, no-show, the not-included park
 * pass) in plain language, so the citizen decides with full information (Constitution
 * Art. 2) and the assistant never guesses or sugar-coats the terms (Art. 7).
 *
 * This is reference knowledge, not a transaction: it reads no account and books
 * nothing. The authoritative fees and terms always show in the citizen's own session
 * at the payment screen.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  allPoliciesText,
  policyText,
  CROSS_CUTTING_POLICIES,
  POLICY_SOURCE_URL,
  POLICY_AS_OF,
  type PolicyFamily,
} from "@open-state/core";

type TextResult = { content: { type: "text"; text: string }[] };
const text = (s: string): TextResult => ({ content: [{ type: "text", text: s }] });

const FAMILY_VALUES = [
  "frontcountry",
  "accommodation",
  "group",
  "dayUse",
  "backcountry",
] as const;

export function registerPolicyTools(server: McpServer): void {
  server.registerTool(
    "get_reservation_policies",
    {
      title: "Parks Canada reservation policies",
      description:
        "Look up Parks Canada's reservation rules in plain language: the " +
        "non-refundable reservation fee, change/cancellation deadlines and refunds, " +
        "check-in times, no-show rules, and the fact that park entry is NOT included. " +
        "Call this whenever the citizen asks 'what if I cancel?', 'is there a fee?', " +
        "'when can I check in?', 'can I get a refund?', or any rules question — and " +
        "proactively when you're about to prepare a booking so they confirm with the " +
        "terms in front of them. Pass `family` to focus on one kind of trip " +
        "(frontcountry campsite, accommodation, group, dayUse, backcountry); omit it " +
        "for the full briefing across all families. This reads nothing about the " +
        "citizen and books nothing.",
      inputSchema: {
        family: z
          .enum(FAMILY_VALUES)
          .optional()
          .describe(
            "Narrow to one trip type: 'frontcountry' (drive-up campsites), " +
              "'accommodation' (oTENTik/cabin/yurt), 'group', 'dayUse' (shuttles, " +
              "parking, guided), or 'backcountry'. Omit for all of them.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const footer =
        `\n\nSource: Parks Canada reservation policies, ${POLICY_SOURCE_URL} ` +
        `(as of ${POLICY_AS_OF}). The exact fees and terms always show in your own ` +
        `session at the payment screen — this is a guide, and nothing here is charged ` +
        `by this tool.`;
      if (args.family) {
        const family = args.family as PolicyFamily;
        const cross = ["", "Applies to every reservation:", ...CROSS_CUTTING_POLICIES.map((c) => `  - ${c}`)];
        return text(policyText(family) + "\n" + cross.join("\n") + footer);
      }
      return text(allPoliciesText());
    },
  );
}
