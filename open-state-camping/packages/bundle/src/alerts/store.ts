/**
 * Local JSON store for cancellation-watch alerts. Stores no citizen identity — each
 * alert is keyed by an opaque generated id, not a person (Constitution Art. 5). The
 * only contact detail kept is an optional `notifyTarget` (a notification link the
 * citizen controls, e.g. an ntfy.sh topic). No account, password, or government
 * credential is ever stored (Art. 1). Lives next to the session vault on the citizen's
 * own device; the file is created 0600.
 *
 * A JSON file is enough for the
 * local bundle's small list of watches.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultVaultDir } from "../session/vault.js";

export interface Alert {
  id: string;
  provider: string;
  recreationAreaId: string;
  campgroundId: string;
  startDate: string;
  endDate: string;
  partySize: number;
  equipmentType?: string | null;
  accessibleOnly: boolean;
  nights?: number | null;
  weekendsOnly: boolean;
  notifyTarget?: string | null;
  status: "active" | "fired";
  createdAt: string;
  lastChecked?: string | null;
  lastResult?: string | null;
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class AlertStore {
  private readonly path: string;

  constructor(dir = defaultVaultDir()) {
    this.path = join(dir, "alerts.json");
  }

  private readAll(): Alert[] {
    if (!existsSync(this.path)) return [];
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(data) ? (data as Alert[]) : [];
    } catch {
      return [];
    }
  }

  private writeAll(alerts: Alert[]): void {
    const dir = join(this.path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(alerts, null, 2), { mode: 0o600 });
  }

  add(input: Omit<Alert, "id" | "status" | "createdAt" | "lastChecked" | "lastResult">): Alert {
    const alert: Alert = {
      ...input,
      id: randomUUID().replace(/-/g, "").slice(0, 12),
      status: "active",
      createdAt: now(),
      lastChecked: null,
      lastResult: null,
    };
    const all = this.readAll();
    all.push(alert);
    this.writeAll(all);
    return alert;
  }

  get(id: string): Alert | undefined {
    return this.readAll().find((a) => a.id === id);
  }

  listAll(): Alert[] {
    return this.readAll();
  }

  listActive(): Alert[] {
    return this.readAll().filter((a) => a.status === "active");
  }

  countActive(): number {
    return this.listActive().length;
  }

  delete(id: string): boolean {
    const all = this.readAll();
    const next = all.filter((a) => a.id !== id);
    if (next.length === all.length) return false;
    this.writeAll(next);
    return true;
  }

  private update(id: string, patch: Partial<Alert>): void {
    const all = this.readAll();
    const a = all.find((x) => x.id === id);
    if (!a) return;
    Object.assign(a, patch);
    this.writeAll(all);
  }

  markChecked(id: string, result: string): void {
    this.update(id, { lastChecked: now(), lastResult: result });
  }

  /** Record a hit and retire the watch so it does not re-notify. */
  markFired(id: string, result: string): void {
    this.update(id, { status: "fired", lastChecked: now(), lastResult: result });
  }
}
