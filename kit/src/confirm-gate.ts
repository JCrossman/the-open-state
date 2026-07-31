/**
 * The trusted human-confirm gate — Constitution Article 2.
 *
 * The model may request a consequential tool, but it cannot authorize one.
 * After preparation, the implementation asks its trusted MCP host to show the
 * exact preview to the citizen. Execution occurs only when that host reports an
 * explicit citizen acceptance and the citizen/session context is unchanged.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** The MCP text result every Open State tool returns. */
export type TextResult = { content: { type: "text"; text: string }[] };

/** Wrap a plain string as an MCP text result. */
export const text = (s: string): TextResult => ({ content: [{ type: "text", text: s }] });

export interface TwoPhaseOutcome<TPrepared = unknown> {
  /** Plain-language description of exactly what will happen (Art. 2.3). */
  summary: string;
  /** Plain-language description of what acceptance authorizes. */
  onConfirm: string;
  /** Domain context computed without causing the consequential action. */
  prepared?: TPrepared;
}

export interface TwoPhaseAction<TArgs, TPrepared = unknown> {
  /**
   * Validate and fully prepare, but hold/write/charge nothing. Validation
   * failures are normal visible outcomes, not exceptions (Art. 7.2).
   */
  prepare(args: TArgs): Promise<TwoPhaseOutcome<TPrepared> | { problem: string }>;
  /**
   * Execute the snapshotted preview up to — never past — the citizen's final
   * step. Both arguments are defensive copies retained before approval.
   */
  execute(args: TArgs, prepared: TwoPhaseOutcome<TPrepared>): Promise<string>;
}

export interface ApprovalRequest {
  summary: string;
  onConfirm: string;
}

export type ApprovalDecision = "accept" | "decline" | "cancel" | "unavailable";

export interface ConfirmationGateOptions {
  /**
   * Stable, non-secret identifier for the current citizen/session context.
   * Implementations should hash credential material before returning it.
   */
  context(): string | Promise<string>;
  /**
   * Trusted host interaction that presents the preview directly to the citizen.
   * This MUST NOT be implemented by asking the model to assert confirmation.
   */
  approve(request: ApprovalRequest): Promise<ApprovalDecision>;
  /**
   * Shared exclusive runner used by every consequential action and session
   * mutation in an implementation. The gate holds it across the final context
   * check and execution, closing account-switch TOCTOU races.
   */
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
}

/** Standard Art. 2 wording used by trusted approval interfaces. */
export function previewFooter(onConfirm: string): string {
  return (
    "\n\nNothing has been held, submitted, or charged. " +
    `Approve only if everything is right: ${onConfirm}. You make the final ` +
    "decision; I never complete it on my own."
  );
}

/**
 * Turn a consequential action into a trusted prepare/approve/execute handler.
 *
 * There is no caller-controlled `confirm` parameter or model-visible
 * capability. The approval callback must be a host-side citizen interaction,
 * such as MCP elicitation.
 */
export function confirmGated<TArgs, TPrepared = unknown>(
  action: TwoPhaseAction<TArgs, TPrepared>,
  options: ConfirmationGateOptions,
): (args: TArgs) => Promise<TextResult> {
  return async (callerArgs: TArgs): Promise<TextResult> => {
    const preparedState = await options.exclusive(async () => {
      const initialContext = contextDigest(await options.context());
      const previewArgs = clone(callerArgs, "tool arguments");
      const prepared = await action.prepare(previewArgs);
      if ("problem" in prepared) {
        return { kind: "problem" as const, problem: prepared.problem };
      }
      const afterPrepare = contextDigest(await options.context());
      if (!buffersEqual(initialContext, afterPrepare)) {
        return { kind: "context-changed" as const };
      }
      return {
        kind: "ready" as const,
        snapshot: clone(prepared, "prepared preview"),
        executionArgs: clone(previewArgs, "prepared tool arguments"),
        initialContext,
      };
    });
    if (preparedState.kind === "problem") return text(preparedState.problem);
    if (preparedState.kind === "context-changed") {
      return text(
        "The connected account or session changed while I prepared the preview, " +
          "so I did not continue. Run the action again to review fresh details.",
      );
    }

    const decision = await options.approve({
      summary: preparedState.snapshot.summary,
      onConfirm: preparedState.snapshot.onConfirm,
    });
    if (decision !== "accept") {
      return text(
        decision === "decline"
          ? "You declined the preview. I did not perform the action."
          : decision === "unavailable"
            ? "Your MCP host does not support trusted confirmation, so I did not " +
              "perform the action. Use a host with MCP form elicitation support."
            : "Confirmation was cancelled. I did not perform the action.",
      );
    }

    return options.exclusive(async () => {
      const currentContext = contextDigest(await options.context());
      if (!buffersEqual(preparedState.initialContext, currentContext)) {
        return text(
          "The connected account or session changed while you were reviewing the " +
            "preview, so I did not perform the action. Run it again to review fresh details.",
        );
      }
      return text(
        await action.execute(preparedState.executionArgs, preparedState.snapshot),
      );
    });
  };
}

export type ExclusiveRunner = <T>(operation: () => Promise<T>) => Promise<T>;

/** Create a fair process-local exclusive runner for session-bound operations. */
export function createExclusiveRunner(): ExclusiveRunner {
  let tail = Promise.resolve();
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    let release!: () => void;
    const previous = tail;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

function clone<T>(value: T, label: string): T {
  try {
    return structuredClone(value);
  } catch (err) {
    throw new TypeError(
      `The ${label} must contain only structured-cloneable data: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function contextDigest(context: string): Buffer {
  return createHash("sha256").update(context).digest();
}

function buffersEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
