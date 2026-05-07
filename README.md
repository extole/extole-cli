# extole-cli

Developer CLI for the Extole API. Built in Node.js.

## Install

```
npm install -g github:cduskin-cpu/extole-cli
```

## Auth

```
extole auth login --token TOKEN                                # save token (account name derived from client)
extole auth login --token TOKEN --account acme --set-default   # save token, set as default
extole auth login --token TOKEN --account staging              # save additional account
extole auth default acme                                   # change default account
extole auth list                                           # show all accounts with default marker
extole auth status                                         # verify token + connectivity
extole auth token                                          # print raw token for the default account
extole auth token --account acme                          # print raw token for a named account
extole auth logout --account acme                          # remove account
```

`auth token` prints the raw token to stdout (with a credential warning on stderr). Useful for piping into other tools:

```
extole auth token | pbcopy
curl -H "Authorization: Bearer $(extole auth token)" https://api.extole.io/v6/webhooks/built
```

All commands use the default account unless `--account NAME` is specified.
Set `EXTOLE_ACCOUNT=NAME` in your shell to override without passing it on every command.
Pass `--token TOKEN` to override the token for a single call without saving.

### Superuser access

If you have a superuser token, use `auth su` to mint a client-scoped token (valid 2 hours) and save it as a named account:

```
extole auth su --token SU_TOKEN --client CLIENT_ID
```

The account is named after the client ID by default. Use `--account` to override, and `--set-default` to make it the default account:

```
extole auth su --token SU_TOKEN --client CLIENT_ID --account acme --set-default
```

When it expires (2 hours), run the same command again to re-mint.

## ping / whoami

```
extole ping                                # verify connectivity (exit 0 = OK)
extole whoami                              # show current account, token, and base URLs
extole whoami --ping                       # same + connectivity check with latency
extole whoami --account other-client      # check a non-default account
extole whoami --json
```

`whoami` reads from local config — no API call unless `--ping` is passed. Useful when switching between multiple saved accounts.

## Rewards

```
extole rewards --email jane@example.com
extole rewards --email jane@example.com --status EARNED
extole rewards --email jane@example.com --limit 50

extole rewards get <reward_id>              # full detail including coupon code
extole rewards get <reward_id> --steps      # also show recipient step history
extole rewards get <reward_id> --json
```

Reward states: `EARNED`, `FULFILLED`, `SENT`, `REDEEMED`, `CANCELED`, `FAILED`, `EXPIRED`

Error messages are unambiguous about whether the person exists:
- `No person found for jane@example.com` — email not in Extole
- `No rewards found for jane@example.com (person ID: abc123)` — person exists, genuinely zero rewards

## Programs

```
extole programs           # list LIVE programs and campaigns
extole programs --all     # include PAUSED, STOPPED, NOT_LAUNCHED
extole programs --json
```

## Health

Read-only domain and email deliverability checks. Validates email domains (SPF, DMARC, DKIM, MX, A records) and program domains (CNAME/A resolution) against Extole's validation API. Nothing is created or modified.

```
extole health                          # check all email domains + program domains
extole health --domain example.com    # filter to a specific email domain
extole health --json                  # raw validation results
```

Output uses colored dots — green for PASS, red for FAIL — with the reason inline:

```
  email domains

  ● example.com
    ● SPF      PASS   Extole senders whitelisted by SPF record
    ● DMARC    PASS   DMARC passed through DKIM records
    ● DKIM     PASS   3/3 records passing
    ● MX       PASS
    ● A        PASS

  program domains

  ● brand.example.com → cdn.extole.com
```

Exit codes: `0` = all checks pass, `1` = one or more failures, `2` = bad input or auth error. Suitable for CI preflight scripts and readiness probes.

## Webhooks

Outbound webhooks send Extole events to external systems via HTTP POST. Four types:

| Type | When it fires | Unique field |
|---|---|---|
| `GENERIC` | Person/consumer journey events (referral, share, purchase, custom input events) | — |
| `CLIENT` | Admin/operational events — config change, report complete, campaign started, webhook failure, etc. | — |
| `REWARD` | Reward state transitions (EARNED, FULFILLED, FAILED, etc.) | `filters` |
| `PARTNER` | Manual dispatch only — no automatic trigger | `response_body_handler` (parses HTTP response body) |

```
extole webhooks                                    # list all webhooks with URL
extole webhooks --filter-type GENERIC              # filter by type
extole webhooks --filter "sfdc"                    # filter by name substring
extole webhooks --json

extole webhooks get <webhook-id>                   # full config: URL, method, tags, retry intervals
extole webhooks get <webhook-id> --built           # show with inherited defaults applied
                                                   # (REWARD webhooks also show state/supplier filters)

extole webhooks create --name "SFDC Events" --url https://example.com/hook
extole webhooks create --name "SFDC Events" --url https://example.com/hook --type GENERIC
extole webhooks create --name "Iterable Events" --url https://api.iterable.com/api/events/track \
  --type CLIENT --tag iterable-events --request-file request.js
extole webhooks create --name "Reward Hook" --url https://example.com/hook \
  --type REWARD --filter-state EARNED --filter-state FULFILLED
extole webhooks create --name "Test" --url https://example.com/hook --dry-run  # print payload, no POST

extole webhooks delete <webhook-id>                # archive (fails if still wired to a campaign)
```

### Webhook types and the `--tag` flag

Tags on webhooks are the key to the **component-driven integration pattern** — a component discovers which webhook to call by tag at campaign publish time, rather than hardcoding an ID. This is how production integrations like Iterable are wired.

```
# Create a webhook with a discovery tag
extole webhooks create \
  --name "Iterable Events" \
  --url https://api.iterable.com/api/events/track \
  --type GENERIC \
  --tag "iterable-events"

# Create a component on the same campaign that discovers it by tag
extole components create \
  --name "iterable_integration" \
  --campaign <campaign-id> \
  --webhook-tag "iterable-events"
```

When the campaign is published, the component resolves the webhook ID from the tag and stores it. The component owns the routing logic — no separate campaign controller needed.

See `~/projects/webhook-component.md` for a full annotated walkthrough including request scripts, payload mapping, and the context object reference per webhook type.

### Attaching webhooks to campaigns (controller model)

For simpler cases — one event type, no component needed — `attach` wires a webhook directly to a campaign via a controller.

```
extole webhooks attach \
  --webhook <webhook-id> \
  --campaign <campaign-id> \
  --event signed_up

extole webhooks attach \
  --webhook <webhook-id> \
  --campaign <campaign-id> \
  --event purchase \
  --event-type STEP              # STEP = internal processing step; INPUT = integration event (default)

# Attach multiple events to one campaign — defer publish until the last one
extole webhooks attach --webhook <id> --campaign <id> --event signed_up --skip-publish
extole webhooks attach --webhook <id> --campaign <id> --event purchase    # publishes once here
```

`--quality` controls dispatch priority: `HIGH` (normal), `LOW` (best-effort), `ALWAYS` (bypasses campaign targeting rules). Defaults to `HIGH`.

### Live testing

For local end-to-end testing, use `webhook-listen.js` to spin up a local HTTP server with a public tunnel (requires `cloudflared`):

```
node ~/projects/webhook-listen.js                                  # start tunnel, print public URL
node ~/projects/webhook-listen.js --create-webhook --account acme  # also create a temporary webhook
```

The script prints each inbound request — method, headers, pretty-printed JSON body — and deletes the webhook on Ctrl-C if it created one.

`listen` is a lower-level alternative that wires a URL to a campaign event and tails dispatch results directly from the API:

```
extole webhooks listen \
  --url https://my-server.com/hook \
  --campaign <campaign-id> \
  --event signed_up \
  --yes                          # skip confirmation prompt
```

### Inspecting dispatch history

```
extole webhooks dispatches <webhook-id>            # what Extole tried to send (attempt records)
extole webhooks dispatches <webhook-id> --limit 50

extole webhooks dispatch-results <webhook-id>      # HTTP outcomes: response codes + bodies
extole webhooks dispatch-results <webhook-id> --json
```

`dispatches` = one record per dispatch attempt. `dispatch-results` = HTTP response side — use this to debug failures (non-200s, timeouts, error bodies).

## Stream

```
extole stream                                         # all events (noisy on prod)
extole stream --event-type INPUT                      # filter by event type (repeatable)
extole stream --event-type INPUT --event-type REWARD
extole stream --filter lead_created                   # filter by event name (repeatable)
extole stream --email jane@example.com                # filter to one person
extole stream --app-type my_integration               # filter by source (repeatable)
extole stream --sandbox container-test                # filter by sandbox/container
extole stream --json                                  # newline-delimited JSON
```

Creates an ephemeral `/v6/event-streams` session, applies filters, polls every 2.5s, and deletes the stream on Ctrl+C.

**Recommended starting filters for production clients** (unfiltered streams are very noisy):
```
extole stream --event-type INPUT                     # business events fired by integrations
extole stream --event-type INPUT --event-type REWARD # business events + reward issuance
extole stream --app-type my_integration              # only events from a specific integration
```

**Event type reference:**

| Type | What it is |
|---|---|
| `INPUT` | Business events fired by integrations (lead_created, opportunity_closedwon, etc.) |
| `REWARD` | Reward state transitions (issued, fulfilled, redeemed) |
| `STEP` | Processing steps triggered by input events |
| `SHARE` | Share link clicks and share actions |
| `REFERRED` / `REFERRED_BY` | Friend-side referral events |
| `IDENTIFIED` | Identity resolution events |
| `REDEEMED` | Redemption events |
| `MESSAGE` | Email/message delivery events |
| `SEND_REWARD` | Reward send attempts |
| `INTERNAL` | Internal system events |
| `DATA_INTELLIGENCE` | Fraud/quality scoring events |
| `AUDIENCE_MEMBERSHIP_*` | Audience list membership changes |
| `ACTION` | Legacy action events |

## Events

```
extole events fire <event_name> --live                        # fire against the live production API
extole events fire <event_name> --sandbox                     # fire in sandbox mode (defaults to production-test)
extole events fire <event_name> --sandbox my-sandbox          # fire in a specific sandbox
extole events fire lead_created --email jane@example.com --live
extole events fire lead_created --email jane@example.com --sandbox

extole events fire <event_name> --param key=value [--param key=value ...] --live
extole events fire <event_name> --dry-run                     # print payload without sending
extole events fire <event_name> --live --watch                # fire then tail steps for --email for 15s
extole events fire <event_name> --live --watch --watch-timeout 30

extole events fire <event_name> --email <e> --live --route                         # trace which campaigns the event reached
extole events fire <event_name> --email <e> --live --route --route-webhook <id>    # also check that webhook for dispatches caused by this event
extole events fire <event_name> --email <e> --live --route --route-timeout 15      # wait longer for slower processing
```

Either `--live` or `--sandbox` is required to send an event. Use `--dry-run` to preview the payload safely.

`--sandbox` adds a `sandbox` param to the event data (default: `production-test`). Pass a value to target a different sandbox: `--sandbox my-sandbox`.

### Route tracing (`--route`)

Use `--route` after firing to see exactly which campaigns the event reached. Steps are filtered by `cause_event_id` matching the fired event, then grouped by campaign:

```
Reached 1 campaign(s):

  Campaign 6864724277439576317  (credit-cards)
    16:20:02  advocate_code_created
    16:20:02  advocate_mobile_experience_rendered
```

If the event was accepted but no campaign matched, the output is explicit:

```
No campaigns matched.
  → event was accepted (5 processing step(s) recorded), but no campaign was triggered.
  → check campaign targeting: program_label, audience filters, sandbox vs live, journey assignment.
```

That message is the diagnostic for the most common debugging case: "I fired the event, I saw it in the stream, but my webhook didn't fire" — meaning the event got accepted but no campaign's targeting rules matched.

Pair with `--route-webhook <id>` to also check whether a specific webhook dispatched for this event. The webhook's recent dispatches are filtered client-side by `cause_event_id`.

## Person

```
extole person get --email jane@example.com         # profile data
extole person steps --email jane@example.com       # step history (default 25)
extole person steps --email jane@example.com --limit 100
extole person steps --email jane@example.com --watch   # tail live steps (Ctrl+C to stop)
extole person steps --email jane@example.com --watch --json
```

## Reports

```
extole reports                                   # list saved report runners
extole reports types                             # list all available report types
extole reports describe --type summary           # show parameters for a report type

extole reports run --type REPORT_TYPE [options]  # create report, returns ID immediately
  --days <n>           set time_range to last N days (mutually exclusive with -p time_range)
  -p key=value         report parameter (repeatable)
  --wait               poll until complete
  --download           download and print result (implies --wait)

extole reports status REPORT_ID                  # check if a report is done
extole reports download REPORT_ID                # download a completed report
extole reports download REPORT_ID --wait         # wait for completion then download
```

Examples:

```
# Discover active programs
extole reports run --type summary_per_program --days 365 \
  -p period=MONTH -p dimensions=PROGRAM --download

# Full program event funnel
extole reports run --type summary --days 365 \
  -p period=MONTH -p dimensions=PROGRAM \
  -p "flows=/business-events" -p container=all --download

# Pipe to jq
extole reports run --type summary_per_program --days 365 \
  -p period=MONTH -p dimensions=PROGRAM --download \
  | jq '[.[].program] | unique'
```

## Components

Extole's configuration is built from **components** — typed, composable building blocks that define programs, rules, rewards, emails, integrations, and more. Understanding the component model is prerequisite to building or modifying offer programs programmatically.

**The type system is nominal and open-ended.** A component declares its type (e.g. `reward-supplier-v10.0`); there is no closed registry of valid types. New types can be declared at any time. The CLI shows what types actually exist in the account at runtime — not a static schema.

**Types form a hierarchy.** `reward-supplier-v10.0` is a subtype of `reward-supplier`, which is a subtype of `component`. Filtering by `--filter-type reward-supplier` matches all subtypes. `components types --tree` renders this hierarchy for the live account.

**Components wire together via sockets.** A rule component references a reward-supplier via a named socket. `--sockets` shows what a component connects to; `--tree` shows the full downstream subgraph.

**The agentic pattern: learn from examples.** There is no static schema doc for what a `reward-supplier-v10.0` requires. The reliable approach is to find a known-good instance (`extole components --filter-type reward-supplier-v10`), read its full config (`extole components get <id>`), and reason from that. `extole mcp` can also answer type-specific questions.

```
extole components                                  # all components, account-wide
extole components --program <id>                   # scoped to one program
extole components --filter-type reward-supplier    # filter by type (matches subtypes too)
extole components --filter "gift card"             # filter by name substring

extole components get <component-id>               # full config + variables
extole components get <component-id> --tree        # downstream subtree (recursive)
extole components get <component-id> --sockets     # socket references to other components

extole components types                            # all concrete types in this account
extole components types --parent rule              # subtypes of a given parent type
extole components types --parent rule --tree       # rendered as a hierarchy
```

`--filter-type` does substring matching against the full type hierarchy, so `--filter-type reward` matches `reward-v10.0`, `reward-rule-v10.0`, `reward-email-v10.0`, etc.

`--tree` on `get` shows the full downstream subgraph — useful for understanding a reward flow or rule chain without querying each child individually.

### Creating integration components

`components create` creates a component attached to a campaign. The primary use case is building webhook integrations: the component holds configuration, discovers its webhook(s) by tag at publish time, and routes dispatches internally.

```
# Minimal — component with no webhook wiring
extole components create --name my_integration --campaign <id>

# With webhook discovery — component finds the webhook by tag when campaign is published
extole components create \
  --name iterable_integration \
  --display-name "Iterable" \
  --campaign <campaign-id> \
  --description "Sends referral events to Iterable" \
  --webhook-tag "iterable-events"

# Multiple webhooks (auto-named from tag)
extole components create \
  --name my_integration \
  --campaign <campaign-id> \
  --webhook-tag "my-integration-events" \
  --webhook-tag "my-integration-subscriptions"

# Explicit variable name (varName:tag)
extole components create \
  --name my_integration \
  --campaign <campaign-id> \
  --webhook-tag "eventsWebhookId:my-integration-events"

# Print payload without creating (useful for verifying buildtime expressions)
extole components create --name my_integration --campaign <id> --webhook-tag my-events --dry-run
```

Each `--webhook-tag` generates a `javascript@buildtime` variable that resolves the webhook ID from the tag when the campaign is published. The component stores the resolved ID — not the tag — so there is no runtime tag lookup overhead. See `~/projects/webhook-component.md` for the full pattern including request scripts and payload mapping.

### Deploying integration bundles

`components deploy` bundles a local directory and uploads it to the platform. Use this for full integration components — `integration-v10.0`, `extension`, and similar typed bundles — where the component, its sub-components, webhooks, and evaluatable scripts all live together as a directory tree.

```
# Deploy a new bundle (creates its own campaign)
extole components deploy --source ./my_integration

# Deploy and publish immediately
extole components deploy --source ./my_integration --publish

# Update an existing component in place
extole components deploy --source ./my_integration --component <component-id>

# Update and publish
extole components deploy --source ./my_integration --component <component-id> --publish

# Preview what would be sent without uploading
extole components deploy --source ./my_integration --dry-run

# Show full API error details on failure
extole components deploy --source ./my_integration --verbose
```

Running `deploy` without `--component` always creates a new campaign. Pass `--component` with the ID from the first deploy to update in place.

Settings values can reference external files using `%{/path/to/file.js}%` — the CLI inlines the file content before uploading. Webhook `request` and `response_handler` scripts must start with `javascript@runtime:`; build-time-only values use `javascript@buildtime:`.

### Deleting components

```
extole components delete <component-id>             # prompts for confirmation
extole components delete <component-id> --confirm   # skip prompt (for scripts)
extole components delete <component-id> --dry-run   # show what would be deleted
```

Deleting a root component archives its entire campaign. The CLI shows the component name and type and warns if it's a root before prompting.

For a full walkthrough of the bundle format, sub-component structure, and deployment workflow, see `~/projects/extole-component-developer-guide-cli.md`.

## Feedback

```
extole feedback the --filter-state flag should mention it is REWARD-only in the help text
extole feedback auth login flow was confusing at first, needed to read the README
```

Sends a message directly to the Extole CLI team's Slack channel. Includes your account name and CLI version automatically — no sign-up or setup required.

## AI (extole mcp)

`extole mcp` gives you access to an Extole AI agent with deep knowledge of Extole's API surface, program configuration model, event semantics, component type system, and reward flows. Use it **before** exploring the API blindly — it can tell you which endpoint to use, what parameters it accepts, what the response shape is, and how concepts relate to each other.

Good uses:
- **API discovery**: "what endpoint do I use to filter steps by a specific event?"
- **Concept clarification**: "what's the difference between a journey and a step?"
- **Debugging guidance**: "why would a purchase event not trigger a reward?"
- **Design validation**: "if I want to enroll a person into a program, what's the right API approach?"
- **Schema lookup**: "what fields does the reward-supplier component type require?"

```
extole mcp "what endpoint filters person steps by cause event id?"
extole mcp "why aren't events firing for jane@example.com"
extole mcp "explain the reward supplier types available"
extole mcp "what's the difference between causeEventIds and rootEventIds on steps?"
```

Requires MCP authentication (separate from the Extole API token):

```
extole auth mcp-login
```

Opens a browser for login. Token is saved automatically and refreshed as needed. Re-run `mcp-login` if the session expires.

## Share Links

```
extole share-links --email jane@example.com
extole share-links --email jane@example.com --label credit-cards
extole share-links --email jane@example.com --json
```

Returns the share links for a person — label, code, and full URL. Use `--label` to filter when a person has links across multiple programs (e.g. verifying a backfill wrote the correct label).

Error messages distinguish person-not-found from person-has-no-links:
- `No person found for jane@example.com` — email not in Extole
- `No share links found for jane@example.com (person ID: abc123)` — person exists, no links

## Output conventions

- Human-readable by default; `--json` on all commands
- `--compact` strips nulls and empty fields (useful for piping to agents)
- `--verbose` logs each HTTP request (`→ METHOD URL`) to stderr
- Exit 0 = success, 1 = API error, 2 = bad input/config, 130 = Ctrl+C, 143 = SIGTERM
- Data goes to stdout, status/progress goes to stderr (pipeable)

## Config file

`~/.extole/config`:
```json
{
  "_default": "acme",
  "acme": { "token": "..." },
  "acme-sandbox": { "token": "..." }
}
```
