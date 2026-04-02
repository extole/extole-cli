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

## Events

```
extole events stream                          # tail live events (polls every 2.5s)
extole events stream --filter lead_created    # filter by event name
extole events stream --since 10m             # start window (10m, 1h, 2h, etc.)
extole events stream --source salesforce_crm  # filter by app_type
extole events stream --json                   # newline-delimited JSON output

extole events fire <event_name>               # fire a single event
extole events fire lead_created --email jane@example.com --advocate_code ABC123
extole events fire <event_name> --param key=value [--param key=value ...]
extole events fire <event_name> --dry-run     # print payload without sending
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
  --json               emit raw API response
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
