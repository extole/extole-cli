# extole-cli

Developer CLI for the Extole API. Built in Node.js.

## Install

```
npm install -g github:cduskin-cpu/extole-cli
```

## Auth

```
extole auth login --token <bearer-token>   # save token to ~/.extole/config
extole auth logout
extole auth status                          # verify token + connectivity
```

All commands accept `--token <token>` to override the saved token for one-off use.
Multi-profile support: `--profile staging` (default profile used if omitted).

## ping

```
extole ping
```

Verifies connectivity. Exit 0 = OK, exit 1 = failure.

## Stream

```
extole stream                                         # all events (noisy on prod)
extole stream --event-type INPUT                      # filter by event type (repeatable)
extole stream --event-type INPUT --event-type REWARD
extole stream --filter lead_created                   # filter by event name (repeatable)
extole stream --email jane@example.com                # filter to one person
extole stream --app-type salesforce_crm               # filter by source (repeatable)
extole stream --sandbox container-test                # filter by sandbox/container
extole stream --json                                  # newline-delimited JSON
```

Creates an ephemeral `/v6/event-streams` session, applies filters, polls every 2.5s, and deletes the stream on Ctrl+C.

**Recommended starting filters for production clients** (unfiltered streams are very noisy):
```
extole stream --event-type INPUT                     # business events fired by integrations
extole stream --event-type INPUT --event-type REWARD # business events + reward issuance
extole stream --app-type salesforce_crm              # only events from Salesforce integration
```

**Event type reference:**

| Type | What it is |
|---|---|
| `INPUT` | Business events fired by integrations (lead_created, opportunity_closedwon, etc.) — usually the right starting point |
| `REWARD` | Reward state transitions (issued, fulfilled, redeemed) |
| `STEP` | Internal Extole processing steps triggered by input events — plumbing, usually noisy |
| `SHARE` | Share link clicks and share actions |
| `REFERRED` / `REFERRED_BY` | Friend-side referral events |
| `IDENTIFIED` | Identity resolution events |
| `REDEEMED` | Redemption events |
| `MESSAGE` | Email/message delivery events |
| `SEND_REWARD` | Reward send attempts |
| `INTERNAL` | Internal system events — almost always noise |
| `DATA_INTELLIGENCE` | Fraud/quality scoring events |
| `AUDIENCE_MEMBERSHIP_*` | Audience list membership changes |
| `ACTION` | UI-confirmed type, not in Java enum — treat as legacy |

## Events

```
extole events fire <event_name>               # fire a single event
extole events fire lead_created --email jane@example.com --advocate_code ABC123
extole events fire <event_name> --param key=value [--param key=value ...]
extole events fire <event_name> --dry-run     # print payload without sending
extole events fire <event_name> --watch       # fire then tail steps for --email for 15s
extole events fire <event_name> --watch --watch-timeout 30
```

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
extole reports list                           # list saved report runners
extole reports types                          # list all available report types

extole reports run --type <report_type> [options]
  --days <n>           set time_range to last N days (shortcut)
  -p key=value         report parameter (repeatable)
  --wait               poll until complete
  --download           download and print result (implies --wait)
  --compact            strip nulls and empty fields
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

## Output conventions

- Human-readable by default; `--json` on all commands
- `--compact` strips nulls and empty fields (useful for piping to agents)
- Exit 0 = success, 1 = API error, 2 = auth/config error
- Data goes to stdout, status/progress goes to stderr (pipeable)

## Config file

`~/.extole/config`:
```json
{
  "default": { "token": "..." },
  "staging": { "token": "..." }
}
```
