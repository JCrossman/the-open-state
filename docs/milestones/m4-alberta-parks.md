# M4 - Alberta Parks provider

**Status: provisional. Validate against live traffic before building.** This milestone is intentionally light on specifics because the Alberta platform (Aspira) has no open-source library equivalent to camply and must be understood from real network traffic first.

## Goal

Add Alberta Parks (shop.albertaparks.ca, Aspira platform) as a second provider behind the same `CampingProvider` interface, so all M1-M3 tools work for Alberta with no change to the tool layer.

## Why this is provisional

- Alberta runs on **Aspira**, a different platform from Parks Canada’s Camis. There is no camply-style library; expect a server-rendered app (HTML fragments, not clean JSON) behind a **Queue-it** waiting room and the **Alberta.ca Account** login.
- The data plane must be reconstructed from observed traffic. Do not write code against assumed endpoints.

## Validation gates (do these before writing the provider)

- **G1: Capture.** With DevTools/mitmproxy, record a full search -> results -> site-detail -> would-book flow on shop.albertaparks.ca. Save as fixtures. Identify whether results are HTML or JSON, and what parameters drive search.
- **G2: Queue-it behavior.** Observe how the waiting room engages and how a queued response looks, so the provider can detect and surface it.
- **G3: Booking hand-off.** Confirm a prepare-then-confirm deep link into the Alberta cart is possible, with the citizen logged in. No government credentials on the server (Constitution Article 1).
- **G4: Accessibility data.** Identify how Alberta exposes accessible sites/facilities so `accessible` maps correctly into `AvailableSite`.

## Build approach (once validated)

- Implement `AlbertaParksProvider(CampingProvider)`. Likely uses a headless browser (Playwright) to maintain the session and parse HTML, since there is no JSON API.
- Normalize into the same `AvailableSite` shape. Tools and the assistant should not be able to tell Alberta from Parks Canada in the output.
- Respect rate limits and Queue-it. Detect a queue and return a typed “you are in line” status rather than retrying aggressively.

## Definition of done

1. All existing tools work for Alberta via provider selection, with identical output shape.
1. Queue-it is detected and surfaced clearly, never bypassed.
1. Accessibility data is mapped and filterable.
1. No government credentials on the server; booking remains prepare-then-confirm.
1. Tests run offline against captured fixtures.

## Note

If Alberta or Aspira ever ship an official partner API, prefer it over scraping and revisit this milestone.
