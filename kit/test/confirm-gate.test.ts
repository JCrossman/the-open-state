import { describe, expect, it } from "vitest";
import { confirmGated, previewFooter, type TwoPhaseAction } from "../src/confirm-gate.js";

interface Args {
  what: string;
  confirm?: boolean;
}

function action(executed: string[]): TwoPhaseAction<Args> {
  return {
    async prepare(args) {
      if (args.what === "bad") return { problem: "That item doesn't exist." };
      return {
        summary: `Here's what I'll do: submit ${args.what}.`,
        onConfirm: "confirm and I'll submit it for your review",
      };
    },
    async execute(args) {
      executed.push(args.what);
      return `Submitted ${args.what} — review and finish it yourself.`;
    },
  };
}

describe("confirm gate (Constitution Art. 2)", () => {
  it("without confirm: previews only, executes nothing", async () => {
    const executed: string[] = [];
    const handler = confirmGated(action(executed));
    const out = await handler({ what: "form A" });
    const t = out.content[0]!.text;
    expect(t).toContain("Here's what I'll do: submit form A.");
    expect(t).toContain("nothing has been held, submitted, or charged");
    expect(t).toContain("never complete it on my own");
    expect(executed).toEqual([]); // Art. 2.2: prepared, not performed
  });

  it("with confirm: executes and reports plainly", async () => {
    const executed: string[] = [];
    const handler = confirmGated(action(executed));
    const out = await handler({ what: "form A", confirm: true });
    expect(out.content[0]!.text).toContain("Submitted form A");
    expect(executed).toEqual(["form A"]);
  });

  it("a prepare problem is a normal outcome (Art. 7.2), not an execution", async () => {
    const executed: string[] = [];
    const handler = confirmGated(action(executed));
    const out = await handler({ what: "bad", confirm: true });
    expect(out.content[0]!.text).toBe("That item doesn't exist.");
    expect(executed).toEqual([]); // even with confirm, a failed prepare never executes
  });

  it("previewFooter words the guarantee consistently", () => {
    const f = previewFooter("confirm and I'll hold the site");
    expect(f).toContain("confirm and I'll hold the site");
    expect(f).toContain("You make the final decision");
  });

  it("threads prepared context from phase 1 to phase 2 (no recompute)", async () => {
    let prepareCalls = 0;
    const handler = confirmGated<{ n: number; confirm?: boolean }, { doubled: number }>({
      async prepare(args) {
        prepareCalls += 1;
        return {
          summary: `I'll process ${args.n}.`,
          onConfirm: "confirm and I'll process it",
          prepared: { doubled: args.n * 2 },
        };
      },
      async execute(_args, outcome) {
        // Phase 2 uses exactly what phase 1 computed — no second prepare pass.
        return `Processed using ${outcome.prepared!.doubled}.`;
      },
    });
    await handler({ n: 21 }); // preview
    const out = await handler({ n: 21, confirm: true }); // execute
    expect(out.content[0]!.text).toBe("Processed using 42.");
    // Each call prepares once; execute reuses that outcome, never re-preparing.
    expect(prepareCalls).toBe(2);
  });
});
