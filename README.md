# extole-cli

Developer CLI for the Extole API. Built in Node.js.

## Install

```
npm install -g github:cduskin-cpu/extole-cli
```

## Auth

```
extole auth login --token TOKEN --account acme --set-default   # save token, set as default
extole auth login --token TOKEN --account staging              # save additional account
extole auth default acme                                   # change default account
extole auth list                                           # show all accounts with default marker
extole auth status                                         # verify token + connectivity
extole auth logout --account acme                          # remove account
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

## ping

```
extole ping
```

Verifies connectivity. Exit 0 = OK, exit 1 = failure.

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

## Programs

```
extole programs           # list LIVE programs and campaigns
extole programs --all     # include PAUSED, STOPPED, NOT_LAUNCHED
extole programs --json
```

## Webhooks

Outbound webhooks send Extole events to external systems via HTTP POST. There are three types: `GENERIC` (event-triggered, used for integrations), `CLIENT` (share/referral events), and `REWARD` (fulfillment calls to reward suppliers).

```
extole webhooks                                    # list all webhooks with URL
extole webhooks --type GENERIC                     # filter by type
extole webhooks --filter "sfdc"                    # filter by name substring
extole webhooks --json

extole webhooks get <webhook-id>                   # full config: URL, method, tags, retry intervals
extole webhooks get <webhook-id> --built           # show with inherited defaults applied

extole webhooks create --name "SFDC Events" --url https://example.com/hook
extole webhooks create --name "SFDC Events" --url https://example.com/hook --type GENERIC

extole webhooks delete <webhook-id>                # archive (fails if still wired to a campaign)
```

### Attaching webhooks to campaigns

`attach` wires a webhook to a campaign so that matching events trigger an outbound dispatch. It creates a campaign controller with an event trigger and webhook action, then publishes the campaign.

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

### Live testing with listen

`listen` temporarily wires a URL to a campaign event and tails incoming dispatches. Creates a webhook + controller, publishes, polls for results every 3 seconds, and deletes everything on Ctrl-C.

The URL must be publicly reachable — Extole makes outbound HTTP POSTs to it. Use any tunneling tool (ngrok, cloudflared) to expose a local server, or point at a request capture service.

```
extole webhooks listen \
  --url https://my-server.com/hook \
  --campaign <campaign-id> \
  --event signed_up

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
```

Either `--live` or `--sandbox` is required to send an event. Use `--dry-run` to preview the payload safely.

`--sandbox` adds a `sandbox` param to the event data (default: `production-test`). Pass a value to target a different sandbox: `--sandbox my-sandbox`.

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

Extole's configuration is built from **components** — typed, composable building blocks that define programs, rules, rewards, emails, and more. Understanding the component model is prerequisite to building or modifying offer programs programmatically.

**The type system is nominal and open-ended.** A component declares its type (e.g. `reward-supplier-v10.0`); there is no closed registry of valid types. New types can be declared at any time. The CLI shows what types actually exist in the account at runtime — not a static schema.

**Types form a hierarchy.** `reward-supplier-v10.0` is a subtype of `reward-supplier`, which is a subtype of `component`. Filtering by `--type reward-supplier` matches all subtypes. `components types --tree` renders this hierarchy for the live account.

**Components wire together via sockets.** A rule component references a reward-supplier via a named socket. `--sockets` shows what a component connects to; `--tree` shows the full downstream subgraph.

**The agentic pattern: learn from examples.** There is no static schema doc for what a `reward-supplier-v10.0` requires. The reliable approach is to find a known-good instance (`extole components --type reward-supplier-v10`), read its full config (`extole components get <id>`), and reason from that. `extole mcp` can also answer type-specific questions.

```
extole components                              # all components, account-wide
extole components --program <id>              # scoped to one program
extole components --type reward-supplier      # filter by type (matches subtypes too)
extole components --name "gift card"          # filter by name substring

extole components get <component-id>          # full config + variables
extole components get <component-id> --tree   # downstream subtree (recursive)
extole components get <component-id> --sockets  # socket references to other components

extole components types                        # all concrete types in this account
extole components types --parent rule          # subtypes of a given parent type
extole components types --parent rule --tree   # rendered as a hierarchy
```

`--type` does substring matching against the full type hierarchy, so `--type reward` matches `reward-v10.0`, `reward-rule-v10.0`, `reward-email-v10.0`, etc.

`--tree` on `get` shows the full downstream subgraph — useful for understanding a reward flow or rule chain without querying each child individually.

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
