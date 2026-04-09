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
extole reports list                              # list saved report runners
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
