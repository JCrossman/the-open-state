/** Small shared helpers. */
import { randomBytes } from "node:crypto";

/**
 * Pull a field from a GoingToCamp `localizedValues` list, preferring English.
 * Parks Canada returns both English and French; citizens read English output
 * (Constitution Art. 3.2), falling back to whatever is present.
 */
export function localized(
  values: Array<Record<string, unknown>> | null | undefined,
  field: string,
  prefer: readonly string[] = ["en-CA", "en-US", "en"],
): unknown {
  const list = values ?? [];
  for (const culture of prefer) {
    for (const value of list) {
      if (value["cultureName"] === culture) return value[field];
    }
  }
  return list.length > 0 ? list[0]![field] : undefined;
}

/** A URL-safe random token of `bytes` entropy (the privacy boundary for ntfy). */
export function randomTokenUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}
