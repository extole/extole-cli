# Extole CLI — Spec

## Overview

A developer-focused command-line tool for interacting with the Extole API. Primary users are:
- **Developers** integrating Extole into their stack
- **Solutions / CS teams** verifying client configurations without opening the UI
- **Agentic tools** (e.g. Claude Code, Codex) that need programmatic verification during build/deploy workflows

Built in Node.js. Distributed via `npm install -g @extole/cli` or `npx @extole/cli`.

---

## Auth

```
extole auth login --token <bearer-token>
extole auth logout
extole auth status
extole auth token
```

- Token stored in `~/.extole/config` (JSON)
- Supports multiple named profiles: `--profile staging`
- Default profile used if `--profile` omitted
- `auth status` prints token (masked), client ID resolved from token, and a live ping result
- `auth token` prints the raw token to stdout for piping into other tools (e.g. `extole auth token | pbcopy` or `some-tool --token $(extole auth token)`). Prints a credential warning to stderr so it doesn't pollute stdout.

All commands accept `--token <token>` as an override for one-off use (useful for Claude Code / CI).

---

## Events

### Stream
```
extole events stream
extole events stream --filter lead_created
extole events stream --since 10m
extole events stream --json
```

Polls the Extole event history API on a short interval (2–3s) and prints new events as they arrive — `tail -f` for Extole events.

Default output (human-readable):
```
12:04:31  lead_created       email=jane@example.com  advocate_code=ABC123  source=salesforce_crm
12:04:45  opportunity_closed  opportunity_id=0061X...  amount=12000         source=salesforce_crm
```

`--json` emits one JSON object per line (newline-delimited) for piping.

Flags:
- `--filter <event_name>` — only show events matching this name
- `--since <duration>` — start window (e.g. `10m`, `1h`, `2026-04-01T00:00:00Z`)
- `--source salesforce_crm` — filter by app_type (default: all)
- `--json` — machine-readable output

### Fire
```
extole events fire lead_created --email jane@example.com --advocate_code ABC123
extole events fire opportunity_closedwon --opportunity_id 0061X --amount 12000
extole events fire <event_name> --param key=value [--param key=value ...]
```

Fires a single event against `POST /v5/events`. Prints the API response.

Flags:
- `--email`, `--advocate_code`, etc. — named shortcuts for common params on standard presets
- `--param key=value` — generic param pass-through for custom events
- `--dry-run` — prints the request payload without sending
- `--json` — emit raw API response

Useful for: verifying a new event config works end-to-end without triggering a real Salesforce record change.

---

## Connection

```
extole ping
```

Fires a lightweight API call and prints latency + resolved client ID. Exit code 0 = success, 1 = failure. Used by Claude Code to verify credentials before a session begins.

---

## Reports

```
extole reports list
extole reports list --json
```

Lists available Extole report runners for the authenticated client.

Output:
```
runner_id              display_name
─────────────────────  ─────────────────────────────
referral_summary       Referral Program Summary
advocate_activity      Advocate Activity Report
conversion_funnel      Conversion Funnel
```

```
extole reports types
extole reports types --json
```

Lists all available report types from `GET /v4/report-types` with name, display name, and executor type. Useful for discovering what reports can be created on demand.

```
extole reports run --type <report_type> [--param key=value ...] [--wait] [--download]
```

Creates an on-demand report via `POST /v4/reports`, optionally polls until complete, and optionally downloads the result.

Flags:
- `--type <report_type>` — report type name (e.g. `summary`, `summary_per_program`)
- `--param key=value` — report parameters (repeatable); e.g. `--param container=all --param period=MONTH`
- `--wait` — poll until status is DONE before returning (handles DASHBOARD executor types which complete in ~5s, SPARK types which may take longer)
- `--download` — download and print the JSON result after completion; implies `--wait`
- `--json` — emit raw API response at each stage

Example — discover active programs for a client account:
```
extole reports run --type summary_per_program \
  --param period=MONTH \
  --param dimensions=PROGRAM \
  --param time_range=<last-30-days> \
  --download | jq '[.[].program] | unique'
```

Example — get program activity data:
```
extole reports run --type summary \
  --param container=all \
  --param flows=/business-events \
  --param dimensions=PROGRAM \
  --param period=MONTH \
  --download
```

This command set is particularly useful for:
- Debugging "why isn't my program showing up" without a Salesforce sandbox
- Validating which programs are active in a client account during onboarding
- Exploring report parameter combinations before hardcoding them in an integration
- Scripting report execution in CI or agentic workflows

---

## Audiences

```
extole audiences list
extole audiences create --name "Closed Won 60d"
extole audiences add <audience-id> --email jane@example.com
extole audiences add <audience-id> --file members.csv
extole audiences status <audience-id> --operation-id <op-id>
```

Wraps the `/v1/audiences` and `/v1/audiences/{id}/operations` endpoints. Primarily useful for testing the audience sync feature before it's built into the SFDC app.

---

## Output conventions

- Human-readable by default; `--json` available on all commands
- Exit code `0` = success, `1` = API error, `2` = auth/config error
- Errors go to stderr; data goes to stdout (pipeable)
- `--quiet` suppresses all non-data output (for scripting)

---

## Config file

`~/.extole/config`:
```json
{
  "default": {
    "token": "...",
    "client_id": "mycompany"
  },
  "staging": {
    "token": "...",
    "client_id": "mycompany-staging"
  }
}
```

---

## Distribution

Three options, ordered by operational simplicity:

**Private GitHub repo + direct npm install (recommended for internal)**
Keep the CLI in a private GitHub repo. Engineers install with:
```
npm install -g github:extole/cli
```
Access is controlled by GitHub repo permissions. No registry account, no publishing step, no discoverability outside the org. Update by bumping a tag; engineers reinstall to get the new version. Right choice while the tool is purely internal and the team is small.

**Scoped private npm package**
Publish to the npm registry under a private scoped package (`@extole/cli`) with visibility set to restricted. Engineers authenticate to npm once (`npm login`) and install normally:
```
npm install -g @extole/cli
```
Adds proper versioning, `npm update` support, and a changelog via npm. Right choice if the CLI eventually needs to be distributed beyond the core eng team (e.g. to partners or CS) without opening a GitHub repo to them.

**Public npm package**
Same as above but publicly installable. Right choice only if the CLI becomes a customer-facing developer tool. Not recommended while it contains internal tooling, undocumented endpoints, or opinionated Extole-specific conventions that aren't ready for public scrutiny.

---

## Telemetry

Yes, "phone home" is a well-established pattern in CLIs — Homebrew, Vercel, Next.js, GitHub CLI, and many others do it. The concept is: the CLI silently records usage events and sends them to a collection endpoint, giving the maintainer visibility into which commands are used, which fail, and what's missing.

For Extole's internal CLI, this is particularly valuable: usage data from CS and eng sessions would surface which commands get reached for most, where people hit errors or dead ends, and what workflows are missing — feeding directly into prioritization.

**What to collect:**
- Command name and subcommand (e.g. `reports run`)
- Flags used (names only, not values — never capture tokens, emails, IDs)
- Exit code and error class (e.g. `API_ERROR`, `AUTH_ERROR`, `TIMEOUT`)
- CLI version and Node version
- A random session ID (not tied to a person or token)

**What not to collect:**
- Flag values — any value could contain PII or credentials
- Token or profile name
- Any API response content

**Implementation:**
A fire-and-forget `POST` to a lightweight ingest endpoint (could be as simple as a Segment write key, a Datadog custom metric, or a small internal endpoint) sent after each command completes. Non-blocking — failure to send never affects CLI behavior. Timeout of ~1s.

**Opt-out:**
Standard practice is opt-out rather than opt-in for internal tools, with a clear notice in the README and `extole telemetry disable` to turn it off. Since this is internal-only, the bar for consent is lower than a public tool.

**The feedback loop:**
CLI errors that hit unknown API states, unrecognized parameters, or command patterns that don't exist yet are the highest-value signal. A weekly review of error classes and command frequency would directly inform what to build next.

---

## V1 scope

Must-have for v1:
- `auth login / status`
- `ping`
- `events stream`
- `events fire`
- `reports list`
- `reports types`
- `reports run --wait --download`

Nice-to-have for v1:
- `audiences list / create / add`
- `--profile` multi-tenant support

Out of scope for v1:
- Campaign management
- Webhook inspection
- Person/profile lookup

---

## Design notes

- `events stream` is the highest-value command — it closes the "did my integration work?" loop without opening the Extole UI
- `events fire` + `events stream` together enable full end-to-end smoke testing from the terminal
- `--json` on all commands makes the CLI usable by Claude Code and other agents programmatically
- The CLI talks to the same REST APIs as the SFDC app — no new backend required
- Auth token is the same bearer token issued in the Extole Security Center
- `reports run --download` combined with `jq` is the primary tool for API exploration and integration debugging — it replaces the need to write Apex probe scripts or use Postman for report investigation
