/**
 * The two-phase human-confirm gate — Constitution Article 2.
 *
 * Any action with consequences for the citizen (a booking, a submission, a
 * cancellation) is delivered as ONE tool with two phases:
 *
 *   1. Called without `confirm`: the implementation fully *prepares and
 *      describes* the action in plain language. Nothing is held, written,
 *      or charged (Arts. 2.2, 2.3).
 *   2. Called again with `confirm: true` — only after the citizen has seen the
 *      preview and explicitly agreed: the action is executed up to, and never
 *      past, the citizen's own final step (payment, submission).
 *
 * This module is the standard wrapper for that shape so every Open State
 * implementation gates consequential actions the same way and words the
 * guarantee the same way. It is deliberately tiny: the domain work stays in
 * the implementation's `prepare`/`execute`; the gate owns only the phase
 * routing and the constitutional wording.
 */

/** The MCP text result every Open State tool returns. */
export type TextResult = { content: { type: "text"; text: string }[] };

/** Wrap a plain string as an MCP text result. */
export const text = (s: string): TextResult => ({ content: [{ type: "text", text: s }] });

export interface TwoPhaseOutcome {
  /** Plain-language description of exactly what will happen (Art. 2.3). */
  summary: string;
  /**
   * What confirming does and where the citizen's own final step is, e.g.
   * "confirm and I'll hold the site and open your cart so you can review and
   * pay yourself". Appended to the standard preview footer.
   */
  onConfirm: string;
}

export interface TwoPhaseAction<TArgs> {
  /**
   * Phase 1: validate and fully prepare, but hold/write/charge NOTHING.
   * Return the plain-language summary, or a problem string to show instead
   * (a validation failure is a normal outcome, not an exception — Art. 7.2).
   */
  prepare(args: TArgs): Promise<TwoPhaseOutcome | { problem: string }>;
  /**
   * Phase 2: the citizen has confirmed. Execute up to — never past — the
   * citizen's own final step, and report plainly what happened.
   */
  execute(args: TArgs, prepared: TwoPhaseOutcome): Promise<string>;
}

/** The standard Art. 2 preview footer, shared verbatim by implementations. */
export function previewFooter(onConfirm: string): string {
  return (
    "\n\nThis is a preview — nothing has been held, submitted, or charged. " +
    `If everything is right, ${onConfirm}. You make the final decision; ` +
    "I never complete it on my own."
  );
}

/**
 * Turn a TwoPhaseAction into an MCP tool handler. The tool's input schema must
 * include an optional boolean `confirm` (described as "Only true after the
 * citizen has seen the summary and confirmed").
 */
export function confirmGated<TArgs extends { confirm?: boolean }>(
  action: TwoPhaseAction<TArgs>,
): (args: TArgs) => Promise<TextResult> {
  return async (args: TArgs): Promise<TextResult> => {
    const prepared = await action.prepare(args);
    if ("problem" in prepared) return text(prepared.problem);
    if (!args.confirm) {
      return text(prepared.summary + previewFooter(prepared.onConfirm));
    }
    return text(await action.execute(args, prepared));
  };
}
