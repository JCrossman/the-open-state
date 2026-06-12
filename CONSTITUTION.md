# The Open State Constitution

**The binding standard for any service built under The Open State, using the Civic Access Protocol.**

*Your services. Your assistant. Your access.*

-----

## Preamble

Public services belong to everyone. The Open State exists to make them reachable by every citizen, through the AI assistant they already use, regardless of ability, age, or language.

This Constitution is not a mission statement. It is a set of hard commitments. Any implementation that calls itself part of The Open State, or claims to be Civic Access Protocol compliant, must meet every requirement below. These are written as “must” and “must not” so that anyone, including a privacy regulator, a government partner, or a developer forking this work, can check an implementation against them.

If an implementation cannot meet these commitments, it is not part of The Open State. It may still be useful software. It is just not this.

The Open State builds **assistive technology, not bots.** An implementation acts only within a citizen's own session, on a device they control, at their direction — the way a screen reader does. Its purpose is to *remove* the barriers that make a public service hard to reach, not to relocate them: it must not give a citizen an accessible experience and then hand them back to the interface that excluded them. We help citizens reach what is already theirs; we do not act against the services, and we seek no advantage a citizen would not have acting for themselves.

-----

## Article 1: Citizen sovereignty over credentials

1.1. An implementation **MUST NOT** store, transmit, log, or retain a citizen’s credentials for any third-party or government service (passwords, security answers, government login secrets, long-lived session tokens).

1.2. An implementation **MUST NOT** authenticate to a third-party or government service as the citizen from infrastructure the implementer controls (for example, a hosted backend). The restriction is on *where the authenticating happens*, not on which service is reached: the destination is, by nature, a service the citizen does not control, but the login itself **MUST** occur on a device the citizen controls (see 1.5).

1.3. Where authenticated action is required, the credential or session **MUST** remain on the citizen’s own device or within a vault only the citizen can unlock.

1.4. An implementation **MUST NOT** expose a citizen’s credentials to the language model or to any AI client.

1.5. Operating within the citizen’s own session satisfies this Article when the session never leaves the citizen’s device — for example, launching a browser on the citizen’s own device for the citizen to log in themselves, and keeping the resulting session only in a local vault encrypted at rest. Such a session **MUST NOT** be transmitted to, or be readable by, the implementer.

## Article 2: The human decides

2.1. Any action with consequences for the citizen (a booking, a payment, a submission, a cancellation, a change to an official record) **MUST** be confirmed by the citizen themselves before it takes effect.

2.2. An implementation **MAY** prepare such an action fully (search, select, fill in details). It **MUST NOT** complete it automatically on the citizen’s behalf.

2.3. The citizen **MUST** be able to understand what they are confirming, in plain language, before they confirm it.

2.4. An implementation **MUST NOT** be designed to win a contested, time-limited public resource (for example a booking race) by automation in a way that disadvantages other citizens. The aim is inclusion, not advantage.

## Article 3: Accessibility is the purpose, not a feature

3.1. An implementation **MUST** be usable by people who rely on screen readers, who have cognitive or motor disabilities, who have low vision, or who have limited proficiency in the service’s default language.

3.2. Tool descriptions, inputs, and outputs **MUST** be in plain language.

3.3. Where a service exposes accessibility attributes (accessible sites, accessible facilities, supports), the implementation **MUST** surface them as first-class and clearly stated, and **MUST** let the citizen filter results by them — that is, restrict a search to only the accessible options, so a citizen who needs accessibility is not made to read through every result to find which ones qualify.

3.4. The needs of people with disabilities, seniors, and newcomers **MUST** be treated as the primary design case, not as an afterthought.

3.5. An implementation **MUST** carry accessibility through to the point of action. It **MUST NOT** present an accessible experience and then return the citizen to an inaccessible interface to complete the task. Removing a barrier means removing it, not relocating it.

## Article 4: Assistant freedom

4.1. An implementation **MUST** be usable from the citizen’s choice of AI assistant. It **MUST NOT** require a specific vendor’s assistant.

4.2. An implementation **MUST NOT** depend on any single client’s memory or features for correctness. Tools take explicit parameters.

4.3. An implementation **MUST NOT** create a new mandatory destination (a required app or website) as the only way to use it.

## Article 5: Data minimization and citizen control

5.1. An implementation **MUST** collect the minimum data needed to perform the requested task.

5.2. Where an implementation stores citizen data (such as preferences or saved searches), it **MUST** be keyed to an identity the citizen controls, encrypted at rest, and isolated per citizen.

5.3. A citizen **MUST** be able to view, export, and delete their stored data.

5.4. Sensitive data, including anything revealing disability, health, or accessibility needs, **MUST** be treated with heightened protection and never used for any purpose beyond serving the citizen’s request.

## Article 6: No exploitation of the citizen

6.1. The Open State **MUST NOT** monetize citizen data. Citizen data **MUST NOT** be sold, rented, brokered, or used for advertising or profiling.

6.2. An implementation **MUST NOT** introduce lock-in designed to make the citizen dependent on it. The measure of success is the citizen reaching their own services, not their continued reliance on the tool.

6.3. An implementation **MUST** be transparent that it is independent of, and not endorsed by, the government or service it connects to, unless an official partnership exists and is disclosed.

## Article 7: Honesty about limits

7.1. An implementation **MUST NOT** claim certainty it does not have. It **MUST** clearly distinguish what it has verified from what it has assumed.

7.2. An implementation **MUST** fail safely and visibly. When it cannot complete a task, it says so plainly rather than guessing.

7.3. An implementation **MUST** respect the systems it connects to: reasonable request rates, honest identification, and no behavior that degrades the service for others.

## Article 8: Openness

8.1. The method (the Civic Access Protocol) **MUST** remain documented and free for others to adopt.

8.2. Implementations **SHOULD** be shareable and forkable, so that liberating one service teaches others how to liberate the next.

8.3. The goal is adoption by the public sector itself. An implementation **SHOULD** be built so it can be handed to, or absorbed by, the government that owns the service.

## Article 9: Security and the law

9.1. An implementation **MUST** comply with applicable privacy law (in Canada, PIPEDA and applicable provincial law such as Alberta’s PIPA).

9.2. An implementation **MUST NOT** pass a citizen’s authentication token from one system through to another (no token passthrough / confused-deputy patterns).

9.3. An implementation **MUST** treat content retrieved from external systems as untrusted, and **MUST** keep a human confirmation gate on consequential actions regardless of automated safeguards.

## Article 10: Assistive technology, not a bot

10.1. An implementation is **assistive technology**. It operates only within the citizen’s own authenticated session, on a device the citizen controls, and only at the citizen’s direction — as a screen reader or other assistive tool does. It is not an autonomous agent acting on its own account, and it does not act against the service or its other users.

10.2. An implementation reaches a service the way the citizen’s own software would — through the service’s own interfaces, carrying the citizen’s own session — to remove barriers, never to disguise who is acting. It **MUST NOT** impersonate another person, and **MUST NOT** defeat measures a service uses to gate humans, such as virtual waiting rooms or human-verification challenges. Where such a gate exists, the citizen passes it themselves.

10.3. An implementation **SHOULD** act through a service’s own data interfaces, carrying the citizen’s session, rather than by automating the service’s visual interface on the citizen’s behalf. A browser the citizen operates themselves — for example, to sign in — is part of the citizen’s own use, not automation against the service.

-----

## Compliance

An implementation is **Civic Access Protocol compliant** only if it satisfies every “MUST” and “MUST NOT” in Articles 1 through 10. “SHOULD” items are strong recommendations.

This Constitution may be revised as the work and the technology mature. Revisions must strengthen, not weaken, the protections for citizens.

## Revision history

- **v1.0** — Initial Constitution (Articles 1–10).
- **v1.1** — Clarifications only; no obligation changed or weakened. Article 1.2 now says explicitly that the forbidden login is one performed on the *implementer's* infrastructure (the destination is always a service the citizen does not control). Article 3.3 spells out that "filter" means letting the citizen restrict results to only the accessible options. An implementation compliant with v1.0 remains compliant with v1.1.

*No citizen should be excluded from what is already theirs.*
