import { describe, expect, it } from "vitest";
import {
  confirmGated,
  createExclusiveRunner,
  previewFooter,
  type ApprovalDecision,
  type TwoPhaseAction,
} from "../src/confirm-gate.js";

interface Args {
  what: string;
}

function action(
  executed: string[],
  prepareCalls = { count: 0 },
  prepared = { exact: "form A" },
): TwoPhaseAction<Args, { exact: string }> {
  return {
    async prepare(args) {
      prepareCalls.count += 1;
      if (args.what === "bad") return { problem: "That item doesn't exist." };
      prepared.exact = args.what;
      return {
        summary: `Here's what I'll do: submit ${args.what}.`,
        onConfirm: "submit it for your review",
        prepared,
      };
    },
    async execute(args, outcome) {
      executed.push(outcome.prepared!.exact);
      return `Submitted ${args.what}.`;
    },
  };
}

function gate(
  actionValue: TwoPhaseAction<Args, { exact: string }>,
  approve: () => ApprovalDecision | Promise<ApprovalDecision>,
  context = () => "session-a",
) {
  return confirmGated(actionValue, {
    context,
    approve: async () => approve(),
    exclusive: createExclusiveRunner(),
  });
}

describe("confirm gate (Constitution Art. 2)", () => {
  it("executes only after a trusted acceptance", async () => {
    const executed: string[] = [];
    const handler = gate(action(executed), () => "accept");
    const out = await handler({ what: "form A" });
    expect(out.content[0]!.text).toContain("Submitted form A");
    expect(executed).toEqual(["form A"]);
  });

  it.each(["decline", "cancel", "unavailable"] as const)(
    "performs nothing when trusted approval returns %s",
    async (decision) => {
      const executed: string[] = [];
      const handler = gate(action(executed), () => decision);
      const out = await handler({ what: "form A" });
      expect(out.content[0]!.text).toContain("did not perform");
      expect(executed).toEqual([]);
    },
  );

  it("shows the exact summary through the trusted approval callback", async () => {
    const seen: string[] = [];
    const handler = confirmGated(action([]), {
      context: () => "session-a",
      approve: async (request) => {
        seen.push(request.summary, request.onConfirm);
        return "decline";
      },
      exclusive: createExclusiveRunner(),
    });
    await handler({ what: "form A" });
    expect(seen).toEqual([
      "Here's what I'll do: submit form A.",
      "submit it for your review",
    ]);
  });

  it("rejects acceptance if the session context changes during review", async () => {
    const executed: string[] = [];
    let context = "session-a";
    const handler = gate(
      action(executed),
      () => {
        context = "session-b";
        return "accept";
      },
      () => context,
    );
    const out = await handler({ what: "form A" });
    expect(out.content[0]!.text).toContain("session changed");
    expect(executed).toEqual([]);
  });

  it("rejects a session change during preparation", async () => {
    let context = "session-a";
    let approvals = 0;
    const handler = confirmGated<Args>(
      {
        async prepare(args) {
          context = "session-b";
          return { summary: args.what, onConfirm: "submit it" };
        },
        async execute() {
          return "should not execute";
        },
      },
      {
        context: () => context,
        approve: async () => {
          approvals += 1;
          return "accept";
        },
        exclusive: createExclusiveRunner(),
      },
    );
    const out = await handler({ what: "form A" });
    expect(out.content[0]!.text).toContain("changed while I prepared");
    expect(approvals).toBe(0);
  });

  it("snapshots prepared data before approval", async () => {
    const executed: string[] = [];
    const shared = { exact: "initial" };
    const handler = gate(action(executed, { count: 0 }, shared), () => {
      shared.exact = "mutated after preview";
      return "accept";
    });
    await handler({ what: "form A" });
    expect(executed).toEqual(["form A"]);
  });

  it("snapshots caller arguments before preparation and execution", async () => {
    const executed: string[] = [];
    const args = { what: "form A" };
    const handler = gate(action(executed), () => {
      args.what = "form B";
      return "accept";
    });
    const out = await handler(args);
    expect(out.content[0]!.text).toContain("Submitted form A");
    expect(executed).toEqual(["form A"]);
  });

  it("prepares exactly once", async () => {
    const prepareCalls = { count: 0 };
    const handler = gate(action([], prepareCalls), () => "accept");
    await handler({ what: "form A" });
    expect(prepareCalls.count).toBe(1);
  });

  it("returns prepare problems without requesting approval", async () => {
    let approvals = 0;
    const handler = gate(action([]), () => {
      approvals += 1;
      return "accept";
    });
    const out = await handler({ what: "bad" });
    expect(out.content[0]!.text).toBe("That item doesn't exist.");
    expect(approvals).toBe(0);
  });

  it("rejects non-cloneable prepared values before approval", async () => {
    let approvals = 0;
    const handler = confirmGated<Args, { callback: () => void }>(
      {
        async prepare() {
          return {
            summary: "Preview",
            onConfirm: "perform it",
            prepared: { callback: () => {} },
          };
        },
        async execute() {
          return "should not execute";
        },
      },
      {
        context: () => "session-a",
        approve: async () => {
          approvals += 1;
          return "accept";
        },
        exclusive: createExclusiveRunner(),
      },
    );
    await expect(handler({ what: "form A" })).rejects.toThrow(TypeError);
    expect(approvals).toBe(0);
  });

  it("previewFooter words the guarantee consistently", () => {
    const footer = previewFooter("hold the site");
    expect(footer).toContain("Nothing has been held");
    expect(footer).toContain("You make the final decision");
  });

  it("holds the exclusive lease across final context check and execution", async () => {
    const exclusive = createExclusiveRunner();
    let context = "session-a";
    let executionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });
    let finishExecution!: () => void;
    const finish = new Promise<void>((resolve) => {
      finishExecution = resolve;
    });
    const executed: string[] = [];
    const handler = confirmGated<Args>(
      {
        async prepare(args) {
          return { summary: args.what, onConfirm: "submit it" };
        },
        async execute(args) {
          executionStarted();
          await finish;
          executed.push(args.what);
          return "done";
        },
      },
      {
        context: () => context,
        approve: async () => "accept",
        exclusive,
      },
    );

    const actionPromise = handler({ what: "form A" });
    await started;
    let mutationFinished = false;
    const mutation = exclusive(async () => {
      context = "session-b";
      mutationFinished = true;
    });
    await Promise.resolve();
    expect(mutationFinished).toBe(false);
    finishExecution();
    await actionPromise;
    await mutation;
    expect(executed).toEqual(["form A"]);
    expect(context).toBe("session-b");
  });
});
