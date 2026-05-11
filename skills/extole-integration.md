---
name: extole-integration
description: "Produce a marketer-/CSM-readable integration report for an Extole client — what events are arriving, from which sources (web tag, mobile SDK, server-to-server, etc.), the configured client domains, and outbound webhook health. Optionally scope to a single program. Use this whenever a user asks about integration health, incoming events, what's flowing in, source breakdowns, web-tag setup, branded domains, webhook delivery, integration manifest, or 'is the integration working' for an Extole client. Trigger even if the user doesn't say 'integration' — questions like 'are we getting events from X', 'what events arrived this week', 'which sources are sending data', or 'show me the manifest' are all in scope. This skill is version-agnostic — it works for V8 and V10 campaigns equally."

---

# Extole Integration

This skill answers: what is Extole actually receiving from this client? It pairs the configured manifest (domains, observed webhook subscriptions, observed source channels) with the inbound event traffic over a time window, and surfaces gaps — channels configured but silent, expected event types missing, webhooks erroring, etc. Useful as the standalone deliverable a CSM would scan, and as the data feed for spec §1.4 (Pull integration manifest) and spec §2.2 (Events received) of the Functional Review agent.

The audience is a CSM, TAM, or marketer — not an engineer. Same display conventions as the V10 program skills: no underscored symbol names where avoidable, source channels and event names rendered in plain English where there's a clean mapping.

## Output

This skill is **descriptive, not evaluative**. It enumerates what Extole is configured to receive and what's flowing in. Flagging, comparison to expectations, and "should-be" judgments belong to the Functional Review agent or a separate evaluation skill — not here.

The default deliverable is a single marketer-readable report with these sections:

1. **Client + window** — client short name, client id, time window covered (default last 7 days for inbound events; align webhook health to the same window), pod/timezone if relevant.
2. **Configured surfaces** — client domains (Extole-managed and branded), share URIs, security/SSL state.
3. **Business events and their triggers** — *primary section, organized by business event*. For each business event in the program, list every inbound trigger (event name OR zone) on its own row within the same business-event group, with type and source per trigger. See "Output format — primary section" below for the exact layout.
4. **Other program zones** — zones that are part of the program structure (creative surfaces, experiences, sub-zones) but aren't direct triggers of a business event. One per row with source.
5. **Webhook delivery health** — outbound webhook dispatches in the window: per webhook_id, dispatch count, success/failure counts, last error if any.

If no program scope is supplied, replace section 3 with a flat client-level list of inbound events grouped by source channel (events arriving at the client, not yet attributed to a specific program's business events).

Counts use thousands separators. Dates render in the client's timezone if known.

### Output format — primary section

Inbound event names and business event names are distinct concepts. The inbound name is what arrives on the wire (`share`, `shared`, `extole.share`, `registration`, `purchased`); the business event name is the campaign component that listens for it ("Shared", "Signed Up", "Converted"). One business event can accept multiple inbound names — that's normal and frequently the case for cross-integration programs. The skill must surface this explicitly.

Render the primary section as a markdown table organized by business event:

| Business event | Inbound trigger | Type | Source |
|---|---|---|---|
| Shared (advocate) | share<br>shared<br>extole.share | event<br>event<br>event | JavaScript SDK |
| Share Clicked (friend) | share_destination | zone request | Direct Web |
| Signed Up (friend) | signed_up | event | JavaScript SDK |
| Converted (friend) | conversion | event | JavaScript SDK |
| Promotion Viewed (advocate) | global_footer<br>confirmation<br>mail_after_purchase_email | zone<br>zone<br>email zone | JavaScript SDK<br>JavaScript SDK<br>Outbound Email |
| Promotion Clicked (advocate) | share_experience | zone | JavaScript SDK |

Rules:
- One row per business event. If the business event accepts multiple inbound names, put them on separate lines within the same cell using `<br>` (or whatever line-break the rendering target uses), with the matching type and source on the same line in their respective columns.
- The `Type` column distinguishes between an `event` (a signal — a customer or system action), a `zone` or `zone request` (the rendering of a creative surface causes the business event to fire), and an `email zone` (the email-context render of a zone, fired during email send rather than browser activity).
- The business event display name follows the existing display-name convention: prefer `display_name` if set, otherwise capitalize and de-underscore the component name.
- Annotate the role in parentheses after the business event name where the program has multiple roles, e.g. "Shared (advocate)" and "Signed Up (friend)".

### Output format — other content zones (second table)

The primary table covers business-event triggers. The program also contains content zones that aren't direct triggers — page experiences, sub-zones, and outbound emails. These belong in a **second markdown table** immediately after the primary one. Don't render them as a bullet list; the table format keeps things scannable when there are many.

Layout:

| Zone | Type | Source |
|---|---|---|
| Terms | page | Direct Web |
| Optout | page | Direct Web |
| Friend Landing Experience | page | JavaScript SDK |
| Share Experience Create Share Link | sub-zone | JavaScript SDK |
| Close Window Zone | sub-zone | JavaScript SDK |
| Share Link Requested | sub-zone | JavaScript SDK |
| Promote Destination | page | JavaScript SDK, Direct Web |
| User Qualified Check | page | JavaScript SDK |
| Welcome Email | email | Outbound Email |
| Advocate Stats Email | email | Outbound Email |
| Share Email | email | Outbound Email |
| Share Email Reminder | email | Outbound Email |
| Friend Signed Up Reward Email | email | Outbound Email |
| Reward Reminder Email | email | Outbound Email |
| Advocate Converted Reward Email | email | Outbound Email |

`Type` vocabulary for this table:
- `page` — a full-page or panel zone rendered to a customer (Terms, Optout, Friend Landing Experience).
- `sub-zone` — a region nested inside another zone (Close Window Zone within Share Experience).
- `email` — an outbound email creative rendered server-side at send time.

Include every content zone the program defines, not just the ones with observed traffic. The table is a description of the program's content surfaces — what's there, regardless of whether it's been hit recently. (Volume / "did this fire" questions belong to evaluation, not description.)

## Workflow

### 1. Resolve the client and (optional) program

If the user named a client, call `extole_client_select(clientIdOrShortName)`. Call `extole_client_summary` to get pod, vertical, timezone, and support ownership — useful for the report header and for routing flags downstream.

If the user named a program, fetch `extole_programs()` and identify the matching campaign id (you'll need it for step 5).

### 2. Pull the domain manifest

Call `extole_domains()`. For each domain, capture: `name`, `domain`, `share_uri`, `is_extole_domain` (true = Extole-managed; false = client's own branded subdomain), `secure`, and the count of `site_patterns` (the patterns that route traffic to this domain). This is the web-tag side of the integration manifest.

### 3. Pull inbound event traffic

Default time window: last 30 days. The Functional Review default is 60 days; use that if the request is in that context.

Two reports give complementary views:

- **`extole_report_input_event_names`** — wrapper around the standard "Input Event Names" report. Gives event name + count over the time period for the client. This is the simplest "what's arriving" view.
- **For source breakdown** — submit the `t1owor6ia18bia3ur7zg` ("Input Events Count") report via `extole_report_submit` with `dimensions: ["EVENT_NAME", "API_TYPE"]` and `period: "NONE"`. The result has one row per (event name, api_type) pair with a count column. `api_type` is the source channel: `HTML` (web tag), `ANDROID`, `IOS`, `S2S` (server-to-server), `EMAIL` (email-driven), and a few others.

**Important correction from earlier drafts:** The `api_type` field on input events is the API category (effectively always `CONSUMER` for inbound consumer events) — it does *not* identify the source channel. The field that identifies the source channel is `app_type`, returned by the `Input Event Names` report alongside the event name and count.

Translate `app_type` values to plain English in the output:

| app_type | Plain English |
|---|---|
| `javascript_sdk` | JavaScript SDK |
| `Web` | Direct Web |
| `API` | Server API (server-to-server) |
| `Android` | Android SDK |
| `iOS` | iOS SDK |
| `Email` | Outbound Email |
| (other) | Use as-is |

Reports are async — `extole_report_submit` returns a `report_id` and `status: "PENDING"`. Poll `extole_report_status` until `COMPLETE`, then call `extole_report_download` to fetch the rows. Cache hits return instantly with `cached: true`.

### 4. Pull webhook delivery health

Submit the `CONFIGURABLE_WEBHOOK_DISPATCH_RESULT_METRICS` report with mappings that aggregate per webhook_id, with success/failure counts. Useful columns: `Webhook Id`, `Dispatch Count`, `Success Count`, `Failure Count`, `Last Status Code`. If a webhook has a failure rate above ~5%, flag it.

If you need detail per dispatch (for the flags section), the `WEBHOOK_DISPATCH_RESULTS` report gives one row per attempt with `responseStatusCode` and timing.

V8 caveat: webhook configuration is per-controller (see `webhook_id` on actions in the campaign controllers). To enumerate the configured subscriptions for V8, walk the campaign controllers and collect distinct `webhook_id` values — then cross-reference against observed dispatches to find configured-but-silent webhooks.

### 5. (Optional) Per-program filter

If a program id was supplied:

- Submit `INPUT_EVENTS_WITH_TRIGGERED_STEPS` with `event_names: null` and the desired time range. The report returns one row per (input event name, period) with the step names that input event triggered.
- Filter the rows to step names belonging to the named program. For V10 you can correlate against the `componentTree` business event names from `extole_campaign_overview_get`. For V8 you can correlate against the controller list from `extole_campaign_controller_list_by_type`.
- The remaining rows are the inbound events that actually fed this program. Show alongside the broader client-level traffic so it's clear what is "this program" vs "everything else this client is sending."

### 6. Compute flags

Flag conditions to check:

- **Configured surface with no traffic** — a client domain with zero observed inbound events tied to it (cross-reference via `domain` filter on `INPUT_EVENTS_BY_EVENT_TIME` if needed). Flag as "Configured domain X has received no traffic in the window."
- **Source channel imbalance** — if a program is supposed to be web + mobile but only web is firing, flag it. (Requires knowing the program's intended channel mix; for v1 just surface the observed mix and let the reader judge.)
- **Webhook error rate** — any webhook with > 5% failure rate over a non-trivial dispatch volume (>50 attempts) gets a flag.
- **Cliff** — bucket the time window into weeks; if any week has < 30% of the previous week's volume on the same event type, flag a possible cliff.
- **Expected events missing** — only computable if you have the program's expected event list. For a V10 program you can derive it by walking the business events' triggers and listing the distinct `event_names`. For V8 the controllers' EVENT triggers give the same.

### 7. Emit the report

Render the sections from the "Output" list above as markdown. Save the report to the working directory as `extole-integration-{client}-{date}.md` so the user has a deliverable. Also emit a structured JSON sibling (`extole-integration-{client}-{date}.json`) with the same data shaped for downstream consumption (the Functional Review agent's spec §5 schema fits naturally — populate `integrations` and `events_received` from this output).

## Tools used

- `extole_client_select` — switch client.
- `extole_client_summary` — pod, vertical, timezone, support.
- `extole_programs` — campaign id resolution if program is supplied.
- `extole_domains` — web/branded domain manifest.
- `extole_report_input_event_names` — quick event-name + count view.
- `extole_report_submit` / `extole_report_status` / `extole_report_download` — for the configured reports below.
- Configured report `t1owor6ia18bia3ur7zg` ("Input Events Count") — events × source channel.
- `INPUT_EVENTS_WITH_TRIGGERED_STEPS` — per-program filter.
- `INPUT_EVENTS_BY_EVENT_TIME` — per-domain filtering when needed.
- `CONFIGURABLE_WEBHOOK_DISPATCH_RESULT_METRICS` — outbound webhook health summary.
- `WEBHOOK_DISPATCH_RESULTS` — per-dispatch detail.
- For V8 webhook subscription enumeration: `extole_campaign_controller_list_by_type` + `extole_campaign_controller_get_by_name` — collect `webhook_id` from controller actions.
- For V10 webhook subscription enumeration: walk the component tree's `actions` socket for `WEBHOOK` action types.

## Known gaps in the integration manifest

The MCP surface doesn't currently expose dedicated endpoints for these — surface them in the report as "not enumerable from this skill; check directly":

- **SFTP feed configuration** — file definitions, expected arrival cadence, last successful receipt. The presence of inbound events with `api_type: BATCH` is a heuristic that SFTP is configured, but the feed inventory itself isn't reachable.
- **Mobile SDK registrations** — observable via `api_type: ANDROID` / `IOS` events, but the configured SDK keys / app identifiers aren't.
- **S2S API key inventory** — observable via `api_type: S2S` events, but the issued keys aren't enumerable.
- **Configured webhook subscriptions, client-level** — only enumerable per-campaign by walking controllers/components. A client-level subscription registry (if one exists) isn't accessible via the current MCP tools.
- **Identity resolution sources (CRM, CDP)** — out of scope for this skill; covered separately if/when an identity-resolution skill is built.

If the Functional Review agent or other downstream consumer needs these, they'll need additional tooling. Don't fabricate values for them.

## Conventions

- Same role/color conventions don't apply here (this skill is integration-level, not program-level — there are no advocate/friend roles in this output).
- Source channel names rendered in plain English per the table in step 3.
- Time window stated explicitly in the report header.
- Counts always with thousands separators.
- "Last seen" timestamps in the client's timezone when known, UTC otherwise.
- Flags listed in their own section at the bottom, with severity (info / warning / error) and a one-line recommended next step per flag.

## Worked example — Madison Reed

Header: "Madison Reed (client_id 89281547), 30-day window ending 2026-05-07, pod TBD, vertical Beauty."

Configured surfaces: two domains — `madison-reed.extole.io` (Extole-managed) and `refer.madison-reed.com` (branded). The branded domain's site patterns include `*.madison-reed.com`, `*.mdsnrd.com`, `*.ngrok.io` (dev), and `instagram.com` (for share return paths).

Inbound events: expect to see `share`, `share_click`, `registration`, `conversion` / `completed_order` / `purchased`, `shipped`, `returned`, `mail_after_purchase`, `completed_order_declined` (the scheduled rule), and identity events like `identify`. Source mix expected: HTML for web share/click/conversion; S2S for completed_order and shipped/returned (since those usually come from the partner's order system).

Per-program filter: if asked specifically about HCB, filter the inbound table to events that triggered HCB controllers (correlate via `INPUT_EVENTS_WITH_TRIGGERED_STEPS` and the HCB controller list from `extole_campaign_controller_list_by_type`).

Webhook health: HCB's `share_event` and `converted` controllers both have `webhook_id: 3e2102e6a458e6b18d98803b` actions, so we expect dispatches for that webhook. Check failure rate.
