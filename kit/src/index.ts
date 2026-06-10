/**
 * @open-state/kit — the code embodiment of The Open State Constitution.
 *
 * Implementations of the Civic Access Protocol share one lifecycle: connect a
 * citizen's account via on-device session capture → read/search → prepare a
 * consequential action → the human confirms → execute up to the citizen's own
 * final step. This kit is the constitutional plumbing of that lifecycle;
 * domain logic (the service's API, its bookings/trips/appointments) stays in
 * each implementation.
 *
 *  - vault:        encrypted on-device session storage      (Article 1)
 *  - confirm-gate: the two-phase prepare→confirm tool shape (Article 2)
 *  - capture:      citizen-driven browser sign-in           (Article 10)
 */
export {
  saveSession,
  loadSession,
  clearSession,
  cookieHeader,
  cookieValue,
  keysEqual,
  defaultVaultDir,
  type Session,
  type StoredCookie,
  type VaultOptions,
} from "./vault.js";
export {
  confirmGated,
  previewFooter,
  text,
  type TextResult,
  type TwoPhaseAction,
  type TwoPhaseOutcome,
} from "./confirm-gate.js";
export {
  captureSession,
  launchCitizenBrowser,
  type CaptureOptions,
  type LaunchOptions,
} from "./capture.js";
