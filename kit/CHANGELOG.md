# Changelog

## 1.0.0

- Replace caller-controlled boolean confirmation with a required trusted
  host-side citizen approval callback.
- Snapshot the exact arguments and prepared result before approval.
- Recheck the non-secret citizen/session context after approval and execute
  only when it is unchanged, while holding a shared exclusive session lease.
- Remove all model-visible confirmation booleans and capabilities.
- Add `createExclusiveRunner` so implementations serialize consequential
  execution with session save/clear operations.

This is a deliberate breaking security release. Consequential tool schemas use
MCP host elicitation instead of a `confirm` parameter.
