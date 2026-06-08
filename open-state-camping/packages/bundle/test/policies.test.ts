import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerPolicyTools } from "../src/policy-tools.js";

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "t", version: "0" });
  registerPolicyTools(server);
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

describe("get_reservation_policies", () => {
  it("returns the full briefing when no family is given", async () => {
    const c = await connect();
    const out = await callText(c, "get_reservation_policies", {});
    expect(out).toContain("Frontcountry camping");
    expect(out).toContain("Backcountry");
    expect(out.toLowerCase()).toMatch(/entry is not included/);
    expect(out).toContain("parks.canada.ca/termes-terms/reservation");
  });

  it("focuses on one family and still appends the cross-cutting rules", async () => {
    const c = await connect();
    const out = await callText(c, "get_reservation_policies", { family: "group" });
    expect(out).toContain("Group camping");
    expect(out).toMatch(/30 days/); // group's longer window
    expect(out).toContain("Applies to every reservation");
    // It should NOT dump the other families when focused.
    expect(out).not.toContain("Day use — reservation policies");
  });

  it("the tool is listed for discovery", async () => {
    const c = await connect();
    const tools = await c.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("get_reservation_policies");
  });
});
