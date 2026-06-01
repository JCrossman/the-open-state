/**
 * Account tools: connect / disconnect / status for the citizen's Parks Canada
 * session. `connect_account` opens the citizen's own Chrome so they sign in
 * themselves; we capture the resulting session into the local encrypted vault.
 * Nothing here books or pays — it only establishes the session the citizen will
 * use to confirm a booking themselves later (Constitution Articles 1, 2, 10).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
      const names = session.cookies.map((c) => c.name);
      const diag =
        `\n\nDiagnostics — captured cookies (${names.length}): ${names.join(", ")}.` +
        ` XSRF-TOKEN present: ${names.includes("XSRF-TOKEN") ? "yes" : "NO"}.`;
      try {
        const info = await provider.getUserInfo();
        if (info && (info["email"] || info["firstName"] || info["shopperUid"])) {
          const name = info["firstName"] || info["email"];
          return text(
            `Connected and your session is active${name ? ` — signed in as ${String(name)}` : ""}` +
              ` (captured ${session.capturedAt}).` +
              diag,
          );
        }
        return text(
          "A session is saved, but it looks expired. Run connect_account to sign " +
            "in again." +
            diag,
        );
      } catch {
        return text(
          `A session is saved (captured ${session.capturedAt}), but I couldn't ` +
            "verify it just now. If bookings don't work, run connect_account again." +
            diag,
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

  server.registerTool(
    "get_account",
    {
      title: "Show my Parks Canada account",
      description:
        "Show the citizen's own Parks Canada profile (name, email, phone, " +
        "address) from their connected session. Requires connect_account first.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      if (!loadSession()) {
        return text("You're not connected yet. Run connect_account to sign in first.");
      }
      try {
        // The full profile is on /api/shopper; userInfo is just name+email.
        const info = (await provider.getShopper()) ?? (await provider.getUserInfo());
        if (!info) {
          return text(
            "I couldn't read your account — your session may have expired. Run " +
              "connect_account to sign in again.",
          );
        }
        return text(formatAccount(info));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "list_my_reservations",
    {
      title: "Show my Parks Canada reservations",
      description:
        "List the citizen's own current and upcoming Parks Canada reservations " +
        "from their connected session. Requires connect_account first.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      if (!loadSession()) {
        return text("You're not connected yet. Run connect_account to sign in first.");
      }
      try {
        return text(formatBookings(await provider.getMyBookings()));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "update_account",
    {
      title: "Update my Parks Canada profile",
      description:
        "Update the citizen's OWN Parks Canada profile — phone, address, name, " +
        "or language. This changes their official account record, so ONLY call " +
        "it after the citizen has told you the exact change AND confirmed it. " +
        "Pass only the fields to change; everything else is kept. Never change " +
        "anything without the citizen's explicit go-ahead; the result shows them " +
        "exactly what changed.",
      inputSchema: {
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        primary_phone: z.string().optional(),
        secondary_phone: z.string().optional(),
        street_address: z.string().optional(),
        unit: z.string().optional(),
        city: z.string().optional(),
        region: z.string().optional(),
        postal_code: z.string().optional(),
        language: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      if (!loadSession()) {
        return text("You're not connected yet. Run connect_account to sign in first.");
      }
      try {
        const current = await provider.getShopper();
        if (!current) {
          return text(
            "I couldn't read your account — your session may have expired. Run " +
              "connect_account to sign in again.",
          );
        }
        const before = formatAccount(current);
        const changed = changedFields(args);
        if (changed.length === 0) {
          return text(
            "Tell me what to change — phone, address, name, or language — and " +
              "I'll update it once you confirm.",
          );
        }
        // Post the exact DTO the API accepts (built from the current profile +
        // the change), not the raw GET record, which carries fields POST rejects.
        const dto = toShopperUpdateDTO(current, args);
        await provider.updateShopper(dto);
        const after = await provider.getShopper();
        return text(
          `Updated your Parks Canada account (${changed.join(", ")}).\n\n` +
            `Before:\n${before}\n\nNow:\n${formatAccount(after ?? dto)}`,
        );
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

/** Plain-language labels for the fields the citizen asked to change. */
function changedFields(args: Record<string, any>): string[] {
  const labels: Record<string, string> = {
    first_name: "first name",
    last_name: "last name",
    primary_phone: "phone",
    secondary_phone: "secondary phone",
    street_address: "street address",
    unit: "unit",
    city: "city",
    region: "region",
    postal_code: "postal code",
    language: "language",
  };
  return Object.keys(labels)
    .filter((k) => args[k] != null && args[k] !== "")
    .map((k) => labels[k]!);
}

/**
 * Normalize a phone number to E.164 (+1… for Canada/US), the format Parks
 * Canada stores and requires — a raw "(647) 468-9893" or bare 10 digits is
 * rejected with HTTP 400.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits ? "+" + digits : trimmed;
}

/**
 * Build the exact profile DTO `POST /api/shopper` accepts (verified shape from a
 * live capture), sourcing values from the current profile and applying the
 * requested changes. Sends only the expected keys — posting the raw GET record
 * (with its extra fields) is rejected with HTTP 400. `postal_code` maps to the
 * address `regionCode` field this endpoint uses.
 */
function toShopperUpdateDTO(
  cur: Record<string, any>,
  args: Record<string, any>,
): Record<string, any> {
  const has = (k: string) => args[k] != null && args[k] !== "";
  const phones = cur["phoneNumbers"] ?? {};
  const a = cur["addresses"]?.[0] ?? {};
  return {
    completedDate: new Date().toISOString(),
    firstName: has("first_name") ? args["first_name"] : (cur["firstName"] ?? ""),
    lastName: has("last_name") ? args["last_name"] : (cur["lastName"] ?? ""),
    email: cur["email"] ?? "",
    communicationPreferences: cur["communicationPreferences"] ?? [
      { channel: 0, context: 0, consentGranted: false },
      { channel: 1, context: 1, consentGranted: false },
    ],
    preferredCultureName: has("language")
      ? args["language"]
      : (cur["preferredCultureName"] ?? "en-CA"),
    flaggedStartDate: cur["flaggedStartDate"] ?? null,
    flaggedEndDate: cur["flaggedEndDate"] ?? null,
    vehicles: cur["vehicles"] ?? [],
    boats: cur["boats"] ?? [],
    phoneNumbers: {
      primaryPhoneNumber: has("primary_phone")
        ? normalizePhone(args["primary_phone"])
        : (phones["primaryPhoneNumber"] ?? null),
      primaryCountryCode: phones["primaryCountryCode"] ?? "CA",
      secondaryPhoneNumber: has("secondary_phone")
        ? normalizePhone(args["secondary_phone"])
        : (phones["secondaryPhoneNumber"] ?? null),
      secondaryCountryCode: has("secondary_phone")
        ? (phones["secondaryCountryCode"] ?? "CA")
        : (phones["secondaryCountryCode"] ?? null),
    },
    contact: cur["contact"] ?? {
      contactName: "",
      phoneNumberCountryCode: null,
      phoneNumber: "",
      email: "",
    },
    addresses: [
      {
        description: a["description"] ?? null,
        unit: has("unit") ? args["unit"] : (a["unit"] ?? ""),
        streetAddress: has("street_address") ? args["street_address"] : (a["streetAddress"] ?? ""),
        city: has("city") ? args["city"] : (a["city"] ?? ""),
        region: has("region") ? args["region"] : (a["region"] ?? ""),
        regionCode: has("postal_code") ? args["postal_code"] : (a["regionCode"] ?? ""),
        country: a["country"] ?? "Canada",
      },
    ],
    defaultSubEquipmentCategoryId: cur["defaultSubEquipmentCategoryId"] ?? null,
    defaultRateCategoryId: cur["defaultRateCategoryId"] ?? null,
    defaultPassNumber: cur["defaultPassNumber"] ?? "",
    defaultPassExpiryDate: cur["defaultPassExpiryDate"] ?? null,
    allowedRestrictedRateCategories: cur["allowedRestrictedRateCategories"] ?? [],
    disallowedPublicRateCategories: cur["disallowedPublicRateCategories"] ?? [],
  };
}

/**
 * Render the citizen's profile. Handles the /api/shopper shape (phoneNumbers
 * object + addresses array) and the flatter userInfo/register shape, with a
 * JSON fallback so nothing is silently dropped.
 */
function formatAccount(info: Record<string, any>): string {
  const lines = ["Your Parks Canada account:"];
  const name = [info["firstName"], info["lastName"]].filter(Boolean).join(" ");
  if (name) lines.push(`- Name: ${name}`);
  if (info["email"]) lines.push(`- Email: ${info["email"]}`);

  const phones = info["phoneNumbers"] ?? info;
  const primary = phones?.["primaryPhoneNumber"] ?? info["primaryPhoneNumber"];
  if (primary) lines.push(`- Phone: ${primary}`);
  const secondary = phones?.["secondaryPhoneNumber"];
  if (secondary) lines.push(`- Secondary phone: ${secondary}`);

  const a = info["addresses"]?.[0] ?? info;
  const street = [a?.["streetAddress"], a?.["unit"]].filter(Boolean).join(" ");
  const cityLine = [a?.["city"], a?.["region"] ?? a?.["regionName"], a?.["postalCode"]]
    .filter(Boolean)
    .join(", ");
  if (street || cityLine) {
    lines.push(`- Address: ${[street, cityLine].filter(Boolean).join(", ")}`);
  }

  if (info["preferredCultureName"]) lines.push(`- Language: ${info["preferredCultureName"]}`);
  const plates = ((info["vehicles"] as any[]) ?? [])
    .map((v) => v?.["licensePlate"] ?? v?.["vehicleLicensePlate"])
    .filter(Boolean);
  if (info["vehicleLicensePlate"]) plates.push(info["vehicleLicensePlate"]);
  if (plates.length > 0) lines.push(`- Vehicle plate: ${plates.join(", ")}`);

  // If we somehow recognized nothing beyond the header, show the raw record.
  if (lines.length === 1) lines.push(JSON.stringify(info).slice(0, 600));
  return lines.join("\n");
}

/** Best-effort reservation rendering — shape unconfirmed; refine after first run. */
function formatBookings(data: unknown): string {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.bookings)
      ? (data as any).bookings
      : null;
  if (!list || list.length === 0) {
    return "I don't see any reservations on your Parks Canada account.";
  }
  const pick = (b: any, keys: string[]) => {
    for (const k of keys) if (b[k]) return String(b[k]);
    return "";
  };
  const lines = [`You have ${list.length} reservation(s):`];
  for (const b of list.slice(0, 25)) {
    const loc = pick(b, ["resourceLocationName", "parkName", "campgroundName", "facilityName", "location"]);
    const site = pick(b, ["resourceName", "siteName", "resource"]);
    const start = pick(b, ["startDate", "arrivalDate", "checkInDate", "fromDate"]);
    const end = pick(b, ["endDate", "departureDate", "checkOutDate", "toDate"]);
    const status = pick(b, ["statusName", "status"]);
    const ref = pick(b, ["referenceNumber", "confirmationNumber", "bookingReference"]);
    const parts = [
      loc,
      site && `site ${site}`,
      start || end ? `${start} to ${end}` : "",
      status,
      ref && `ref ${ref}`,
    ].filter(Boolean);
    lines.push("- " + (parts.length > 0 ? parts.join("; ") : JSON.stringify(b).slice(0, 160)));
  }
  return lines.join("\n");
}
