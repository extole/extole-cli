# extole-cli

Developer CLI for the Extole API. Built in Node.js.

## Install

```
npm install -g github:cduskin-cpu/extole-cli
```

## Auth

```
extole auth --token TOKEN                   # save token to default account
extole auth --token TOKEN --account quim    # save token to named account
extole auth list                            # show all saved accounts
extole auth status                          # verify token + connectivity
extole auth logout                          # remove token for an account
extole auth logout --account quim
```

All commands accept `--account NAME` to select a saved account (default: `default`).
Set `EXTOLE_ACCOUNT=quim` in your shell to avoid passing it on every command.
Pass `--token TOKEN` to override for a single call without saving.

## ping

```
extole ping
extole ping --account quim
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
extole events fire <event_name> --live                        # required to fire in production
extole events fire lead_created --email jane@example.com --live

extole events fire <event_name> --param key=value [--param key=value ...] --live
extole events fire <event_name> --dry-run                     # print payload without sending
extole events fire <event_name> --live --watch                # fire then tail steps for --email for 15s
extole events fire <event_name> --live --watch --watch-timeout 30
```

`--live` is required to actually send an event. Use `--dry-run` to preview the payload safely.

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
  "quim": { "token": "..." }
}
```
