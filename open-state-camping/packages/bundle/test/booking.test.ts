import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ParksCanadaProvider } from "@open-state/core";
import { registerBookingTools } from "../src/booking-tools.js";

// prepare_booking is gated by the kit's two-phase confirm wrapper. The deeper
// live flow needs a captured session + the Parks Canada API, but the gate's
// front edge is testable offline: with no session, phase 1 returns a plain
// problem and NEVER reaches the network — proving the preview holds nothing.
async function connect(): Promise<Client> {
  const server = new McpServer({ name: "t", version: "0" });
  // A provider whose every call throws — if the gate let phase 1 fall through to
  // the booking API, the test would see this error instead of the session prompt.
  const provider = new Proxy({} as ParksCanadaProvider, {
    get() {
      return () => {
        throw new Error("network must not be touched while previewing");
      };
    },
  });
  registerBookingTools(server, provider);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
  return client;
}

const callText = async (c: Client, name: string, args: Record<string, unknown>) => {
  const r = (await c.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
  };
  return r.content.map((x) => x.text).join("\n");
};

describe("prepare_booking confirm gate (Constitution Art. 2)", () => {
  it("is registered", async () => {
    const c = await connect();
    expect((await c.listTools()).tools.map((t) => t.name)).toContain("prepare_booking");
  });

  it("without a session, phase 1 asks to connect and touches no network", async () => {
    const c = await connect();
    // Even with confirm:true, a failed phase-1 prerequisite never executes.
    const out = await callText(c, "prepare_booking", {
      campground_id: "-2147483642",
      site_id: "123",
      start_date: "2099-07-17",
      end_date: "2099-07-19",
      confirm: true,
    });
    expect(out).toContain("connect_account");
    expect(out).not.toContain("network must not be touched");
  });
});
