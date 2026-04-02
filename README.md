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
