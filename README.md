# @extole/cli

Developer CLI for the Extole API.

## Requirements

- Node.js 18 or higher
- An Extole account with an API token (see [Getting a token](#getting-a-token))

## Install

```
npm install -g @extole/cli
```

Verify: `extole --version`

## Who is this for

This CLI targets **developers and technical operators** working with the Extole API — engineers integrating Extole into their platform, technical support staff diagnosing reward and event issues, and solutions engineers configuring programs.

Several commands (`components deploy`, `campaigns quality-rules`, `health provision-dkim`) require elevated account permissions. Standard API tokens with `CLIENT_ADMIN` scope cover most read operations; write operations and some diagnostics require `CLIENT_SUPERUSER`. If you hit a 403, your token may lack the necessary scope.

## Quickstart

```bash
# 1. Install
npm install -g @extole/cli

# 2. Authenticate
extole auth login --token YOUR_TOKEN

# 3. Verify it works
extole whoami

# 4. Try something useful
extole programs
extole rewards --email customer@example.com
extole chat "what campaigns are live on this account?"
```

For help on any command: `extole --help`, `extole <command> --help`

## Getting a token

Log in to [my.extole.com](https://my.extole.com), navigate to **Settings → API Access**, and create or copy an API token. The token needs `CLIENT_ADMIN` scope for most read operations and `CLIENT_SUPERUSER` for write operations and advanced diagnostics.

Contact your Extole account team if you do not have access to API settings.

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

**Prefer environment variables over command-line arguments for tokens** — tokens passed on the command line are visible in shell history and process lists. Use environment variables instead:

```bash
export EXTOLE_TOKEN=your-token-here     # use this token for all commands
export EXTOLE_ACCOUNT=acme              # use this account for all commands
```

Both variables are read automatically by every command. `--token` and `--account` flags are available as overrides but should not be the primary way you supply credentials in scripts or CI.


## ping / whoami

```
extole ping                                # verify connectivity (exit 0 = OK)
extole whoami                              # verify token and show client identity, scopes, and expiry
extole whoami --account other-client      # check a non-default account
extole whoami --json
```

`whoami` calls `/v4/tokens` to verify the token is valid and returns the client name, scopes, token type, and days until expiry.

## Rewards

```
extole rewards --email jane@example.com
extole rewards --email jane@example.com --status EARNED
extole rewards --email jane@example.com --limit 50

extole rewards get <reward_id>              # full detail including coupon code
extole rewards get <reward_id> --steps      # also show recipient step history
extole rewards get <reward_id> --json

extole rewards history <reward_id>          # state-transition timeline (EARNED → SENT → FULFILLED → ...)
extole rewards state-summary                # account-wide reward counts by state, bucketed over time
extole rewards find-coupon <code>           # reverse lookup: who got this coupon and was it used?
```

Reward states: `EARNED`, `FULFILLED`, `SENT`, `REDEEMED`, `CANCELED`, `FAILED`, `EXPIRED`

Error messages are unambiguous about whether the person exists:
- `No person found for jane@example.com` — email not in Extole
- `No rewards found for jane@example.com (person ID: abc123)` — person exists, genuinely zero rewards

`rewards history` is the go-to for "why is this reward stuck?" — each row shows the state change, when it happened, and whether the transition succeeded. `rewards state-summary` is the ops-level view: aggregate counts plus a per-week breakdown across all reward states. `rewards find-coupon` is the inverse of "find by email" — given just a coupon code, it tells you who got it, what state it's in, and whether Extole has been told it was redeemed.

> A note on "REDEEMED": Extole transitions a reward to `REDEEMED` when it receives a redemption signal from the merchant's commerce backend (a redemption event or webhook). If that integration isn't wired up, a coupon can be used at checkout and the reward stays in `SENT` forever. So `REDEEMED` means "someone told Extole it was used," not "definitely used at point of sale."


## Reward Suppliers

Inspect configured reward suppliers — manual-coupon batches, Tango, PayPal payouts, BHN cards, custom suppliers. Used by reward rules in campaigns to mint the actual reward value.

```
extole reward-suppliers                              # all configured suppliers with face values
extole reward-suppliers --filter manual              # name/type substring match
extole reward-suppliers get <supplier-id>            # full detail: face_value, limits, expiry, tags
extole reward-suppliers coupons <supplier-id>        # for MANUAL_COUPON: count + sample preview
extole reward-suppliers coupons <supplier-id> --list # dump all codes (paged with --limit)

# Create a MANUAL_COUPON supplier
extole reward-suppliers create --type MANUAL_COUPON --name "Test Coupons" --face-value 25 --face-value-type USD --warn-limit 10 --dry-run
extole reward-suppliers create --type MANUAL_COUPON --name "Test Coupons" --face-value 25 --face-value-type USD --warn-limit 10

# Create a CUSTOM_REWARD supplier
extole reward-suppliers create --type CUSTOM_REWARD --name "Statement Credit" --face-value 50 --face-value-type USD --custom-reward-type ACCOUNT_CREDIT

# For TANGO_V2, PAYPAL_PAYOUTS, SALESFORCE_COUPON — use --body for full JSON control
extole reward-suppliers create --body '{"reward_supplier_type":"TANGO_V2","name":"Gift Card","face_value_type":"USD","face_value":25,"account_id":"...","utid":"..."}'

# Upload coupon codes to a MANUAL_COUPON supplier
extole reward-suppliers upload-coupons <supplier-id> --codes CODE1,CODE2,CODE3
extole reward-suppliers upload-coupons <supplier-id> --file ./coupons.txt
extole reward-suppliers upload-coupons <supplier-id> --file ./coupons.txt --dry-run
```

The list uses the `/built` endpoint so component-bundle suppliers (where the name and face value come from buildtime expressions) display their resolved values. The `coupons` command refuses non-MANUAL_COUPON suppliers with a clear message — other supplier types mint codes on demand or use external partner APIs, so an inventory check doesn't apply.

When `coupons` finds the supplier at or below its `coupon_count_warn_limit`, it flags it with `⚠  at or below warn limit` in the output. Useful for capacity planning before a marketing push and for confirming depletion from CLI when a platform alert has already fired.

`create` supports typed flags for `MANUAL_COUPON` and `CUSTOM_REWARD`. Use `--body <json>` for `TANGO_V2`, `PAYPAL_PAYOUTS`, and `SALESFORCE_COUPON` which require integration-specific credentials. Use `--dry-run` to preview the request body before sending.

`upload-coupons` accepts either a flat text file (one code per line, `#` lines ignored) or an inline comma-separated list via `--codes`. Use `--dry-run` to preview what would be uploaded.

## Programs

```
extole programs           # list LIVE programs and campaigns
extole programs --all     # include PAUSED, STOPPED, NOT_LAUNCHED
extole programs --json
```

## Audiences

Inspect audiences, their size, members, and recent push/sync history. Useful when verifying that an async audience operation (SFDC sync, file import, replace, etc.) completed without round-tripping through the my.extole UI.

```
extole audiences list                                       # audiences on the account (default --limit 100)
extole audiences list --filter sfdc                         # match name substring
extole audiences list --limit 500                           # raise cap on big accounts
extole audiences get <name|id>                              # name, size, recent history summary
extole audiences members <name|id>                          # person_id + email rows
extole audiences members <name|id> --email-only             # emails only, one per line
extole audiences members <name|id> --limit 500 --offset 0   # paginate

extole audiences history <name|id>                          # recent ADD / REMOVE / REPLACE / ACTION runs
extole audiences history <name|id> --listen                  # tail new runs as they arrive (Ctrl-C to stop)
extole audiences history <name|id> --listen --interval 3     # custom poll interval (default 5s)
```

The `<audience>` argument resolves in this order: exact ID, exact name, then case-insensitive substring of name. If multiple audiences match the substring, the CLI lists them and asks for a more specific input.

## Campaigns

Inspect per-campaign configuration: which quality rules are turned on, and what the MaxMind fraud-scoring controller-trigger settings are.

```
extole campaigns quality-rules <campaign-id>                       # enabled quality rules only
extole campaigns quality-rules <campaign-id> --include-disabled    # also show disabled rules
extole campaigns quality-rules <campaign-id> --json                # raw QualityRuleResponse[]

extole campaigns maxmind <campaign-id>                             # enabled MaxMind triggers only
extole campaigns maxmind <campaign-id> --include-disabled          # also show disabled triggers
extole campaigns maxmind <campaign-id> --json                      # raw trigger array

extole campaigns reward-rules <campaign-id>                        # per-role reward rules: rewardee, trigger, supplier, constraints
extole campaigns reward-rules <campaign-id> --json                 # raw RewardRuleResponse[]
```

### Quality rules

`quality-rules` calls `GET /v2/campaigns/{id}/incentive/quality-rules` and renders the configured legacy quality rules (`REFERRAL_CAP`, `SELF_REFERRAL`, `BAD_COUNTRY`, `VALID_EMAIL`, `BOT_FILTER`, `BLACKLIST_DOMAIN`, `EVENT_SPEED`, `BLOCKED`, `RECENT_CUSTOMER`, `SHARE_COUNT_LIMIT`, `IP_FILTER`, `FRIENDS_OF_ADVOCATE_*_LIMIT`, etc.). Each row shows the rule type, whether it is enabled, which action types it applies to (`ANY_CLICK`, `ANY_SHARE`, `ANY_REGISTER`, `ANY_PURCHASE`, `ANY_PROMOTION`), and any rule-specific properties (e.g. `cap_number=10, lookback_interval=7` on `REFERRAL_CAP`).

### MaxMind

`maxmind` walks the built campaign (`GET /v2/campaigns/{id}/built`) and surfaces every `trigger_type: MAXMIND` controller-trigger, with its step, phase, `risk_threshold`, `ip_threshold`, `allow_high_risk_email`, and `default_quality_score`. When a trigger has thresholds different from the recommended value of `20` (the legacy default was `5`), an advisory is printed to stderr. The advisory does not appear in `--json` output.

## Notifications

Show recent platform notifications for this account — webhook failures, integration errors, and other actionable system alerts. Same data as `my.extole.com/notifications`. Useful when debugging "the integration looks wired up but nothing's happening" — the notifications often name the exact campaign and event the platform couldn't process.

```
extole notifications                          # last 20 most-recent-first
extole notifications --limit 50               # paginate (default 20)
extole notifications --level ERROR            # ERROR / WARN / INFO filter
extole notifications --tag technical          # tag filter (server-side; repeat for multiple)
extole notifications --listen                  # tail new ones as they arrive (default 10s poll)
extole notifications --json                   # raw response, suitable for scripting
```

Each notification shows time, level, name (e.g. `webhook_action_no_webhook`), the human message, and the key data fields (campaign_id, controller_id, person_id, cause_event_id) — most of which feed straight into other CLI commands (`extole events fire ... --trace` with the cause_event_id, etc.).

## Health

Domain and email deliverability checks. The base command is read-only — validates email domains (SPF, DMARC, DKIM, MX, A records) and program domains (CNAME/A resolution) against Extole's validation API. Nothing is created or modified by `extole health` itself; the `provision-dkim` subcommand is the only write operation, and it requires explicit confirmation.

```
extole health                          # check all email domains + program domains
extole health --domain example.com    # filter to a specific email domain
extole health --json                  # raw validation results

# DKIM provisioning (write operation — interactive prompt by default)
extole health provision-dkim example.com           # prompts before calling
extole health provision-dkim example.com --confirm # non-interactive (for scripts/CI)
```

`provision-dkim` calls SendGrid via the platform's get-or-create endpoint: the first call on a never-provisioned domain mints new DKIM keys; subsequent calls return existing records (no-op). Output is the CNAME records to add to your DNS provider. Re-run `extole health --domain <domain>` after adding the records to verify they resolve.

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

Contact your Extole solutions engineer or refer to internal Extole documentation for a full annotated walkthrough of request scripts, payload mapping, and the context object reference per webhook type.

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

`webhooks trace` temporarily wires a URL to a campaign event and tails dispatch results directly from the API — no external tunnel needed:

```
extole webhooks trace \
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

extole webhooks listen <webhook-id>                 # tail dispatch results in real time (Ctrl-C to stop)
extole webhooks listen <webhook-id> --interval 5   # custom poll interval (default 3s)
extole webhooks listen <webhook-id> --show-body    # print full response body per row
extole webhooks listen <webhook-id> --duration 60  # auto-exit after 60 seconds
```

`dispatches` = one record per dispatch attempt. `dispatch-results` = HTTP response side — use this to debug failures (non-200s, timeouts, error bodies). `listen` is the live-tail version of `dispatch-results` — seeds the seen-set on first poll so it only shows new attempts.

## Stream

`extole events listen` is the preferred way to tail live events. `extole stream` is the underlying command and accepts the same options.

```
extole events listen                                      # all events (noisy on prod — add filters)
extole events listen --event-type INPUT                   # filter by event type (repeatable)
extole events listen --event-type INPUT --event-type REWARD
extole events listen --filter lead_created                # filter by event name (repeatable)
extole events listen --email jane@example.com             # filter to one person
extole events listen --app-type my_integration            # filter by source (repeatable)
extole events listen --sandbox container-test             # filter by sandbox/container
extole events listen --duration 30                        # auto-exit after 30 seconds
extole events listen --tail 10                            # exit after 10 events (non-interactive tools)
extole events listen --json                               # newline-delimited JSON
```

Creates an ephemeral `/v6/event-streams` session, applies filters, polls every 2.5s, and deletes the stream on Ctrl+C or when `--duration`/`--tail` is reached.

**Recommended starting filters for production clients** (unfiltered streams are very noisy):
```
extole events listen --event-type INPUT                      # business events fired by integrations
extole events listen --event-type INPUT --event-type REWARD  # business events + reward issuance
extole events listen --app-type my_integration               # only events from a specific integration
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
extole events fire <event_name>                               # fire in sandbox mode (default — safe)
extole events fire <event_name> --live                        # fire against the live production API
extole events fire <event_name> --sandbox my-sandbox          # fire in a specific named sandbox
extole events fire lead_created --email jane@example.com
extole events fire lead_created --email jane@example.com --live

extole events fire <event_name> --param key=value [--param key=value ...] --live
extole events fire <event_name> --data '{"email":"jane@example.com","amount":"500"}'
extole events fire <event_name> --dry-run                     # print payload without sending

extole events report <event_id>                               # look up a past event by ID (uses report pipeline, ~30-90s)
extole events fire <event_name> --live --listen               # fire then tail steps for --email for 15s
extole events fire <event_name> --live --listen --listen-timeout 30

extole events fire <event_name> --email <e> --live --trace                          # trace which campaigns the event reached
extole events fire <event_name> --email <e> --live --trace --trace-webhook <id>    # also check that webhook for dispatches caused by this event
extole events fire <event_name> --email <e> --live --trace --trace-timeout 15      # wait longer for slower processing
```

Sandbox mode is the default — no flags needed for safe testing. Use `--live` to fire against production. Use `--dry-run` to preview the payload without sending.

`--sandbox` adds a `sandbox` param to the event data (default: `production-test`). Pass a value to target a different sandbox: `--sandbox my-sandbox`.

### Trace (`--trace`)

Use `--trace` after firing to see exactly which campaigns the event reached. Steps are filtered by `cause_event_id` matching the fired event, then grouped by campaign:

```
Reached 1 campaign(s):

  Campaign 6864724277439576317  (credit-cards)
    16:20:02  advocate_code_created
    16:20:02  advocate_mobile_experience_rendered
```

If no campaign matched, `--trace` checks `/v2/campaigns/built` to determine *why* and reports the actual cause rather than speculating:

**Case A — event isn't wired to any campaign:**
```
No steps caused by event 7637... after 8s.
  → cause: no campaign uses event "lead_created". The event has no controllers wired to it.
  → fix: attach a webhook to a campaign with --event lead_created, or check that an existing controller's event_names actually includes this name.
```

**Case B — campaigns use the event but targeting filtered the person out:**
```
No campaigns matched.
  → event was accepted (5 processing step(s) recorded), but no campaign was triggered.
  → 4 campaign(s) DO use "signed_up" but none triggered for this person.
  → LIVE campaigns using this event (2):
      68647...  Loans                       program=loans                journey=participant
      76264...  Refer a Friend with Branch  program=refer-a-member-flow  journey=FRIEND|participant

  → person is in: ADVOCATE@credit-cards
  → LIVE campaigns using this event require journey ∈ {participant, FRIEND}
  → cause: no overlap. Person isn't enrolled in any journey that the campaigns using this event target.

  → friend-side journey required: FRIEND, participant. Person must be enrolled in one of these for the event to qualify them.
     typical enrollment path: advocate share → friend visits link → friend journey created.
     other paths exist (direct API enrollment, custom journey assignment, integration-driven membership).
     to test: simulate the share→click flow, or fire as an email already enrolled in one of these journeys.

  Probing 2 webhook(s) attached to campaigns using this event:
    edb70dc4...  HubSpot Advocate Sync  → 0 dispatches caused by this event  (0 recent dispatches on this webhook)
```

This distinction is the difference between "your wiring is wrong" and "your wiring is right but a filter excluded the test person" — two very different fixes.

`--trace` automatically discovers webhooks attached to campaigns using this event and probes each for dispatches caused by the fired event. Use `--trace-webhook <id>` to override and check a specific webhook directly.

## Person

```
extole person get --email jane@example.com         # profile data

extole person steps --email jane@example.com       # step history (default 25)
extole person steps --email jane@example.com --limit 100
extole person steps --email jane@example.com --listen        # tail live steps (Ctrl+C to stop)
extole person steps --email jane@example.com --duration 30   # tail and auto-exit after 30s
extole person steps --email jane@example.com --listen --json

extole person rewards --email jane@example.com              # rewards for this person
extole person rewards --email jane@example.com --status EARNED
extole person rewards --email jane@example.com --json

extole person relationships --email jane@example.com        # advocate↔friend referral relationships
extole person relationships --email jane@example.com --json

extole person stats --email jane@example.com                # personal + referral network stats
extole person stats --email jane@example.com --json

extole person report --id <person_id>                       # profile events report ALL_TIME (~30-90s)
extole person report --email jane@example.com               # looks up person ID then runs report
```

`relationships` shows each referral link the person is part of — their role (ADVOCATE or FRIEND), the program, the other person's ID, the channel (SHARE_LINK, ADVOCATE_CODE, etc.), and the date the relationship was created.

`stats` shows two rows: the person's own AOV/LTV/activities/transactions/conversions, and the same metrics aggregated across everyone they've referred (their referral network). The network row is the delta — it shows what value this advocate's referrals have driven.

## Reports

**Discovery → describe → run** is the full flow, and each step's output gives you exactly what you need to take the next step. No out-of-band knowledge, no docs to consult — the chain is self-documenting:

```
extole reports recommended                       # curated starting picks for this account (default 5)
extole reports types --filter <term>             # find reports by name/description/categories
extole reports describe --type <name>            # required vs optional params, types, defaults, allowed values
extole reports run --type <name> -p key=value    # execute
```

`describe` is the contract for `run`. It surfaces every parameter the report accepts — required vs optional, type (`TIME_RANGE`, `STRING`, `ENUM`, `BOOLEAN`, `STRING_LIST`, etc.), defaults, and allowed values for enums. An agent can read it programmatically and build a valid `run` invocation; a human can read it and remember.

```
extole reports                                   # list saved report runners
extole reports types                             # list ALL report types (no filter)
extole reports recommended --limit 10            # more than 5 recommendations
extole reports recommended --json                # raw response for scripting

extole reports run --type REPORT_TYPE [options]  # create report, returns ID immediately
  --days <n>           set time_range to last N days (mutually exclusive with -p time_range)
  -p key=value         report parameter (repeatable)
  --format <fmt>       output format: JSON (default), JSONL, CSV — see `reports describe`
  --wait               poll until complete
  --download           download and print result (implies --wait)

extole reports status REPORT_ID                  # check if a report is done
extole reports download REPORT_ID                # download a completed report
extole reports download REPORT_ID --wait         # wait for completion then download
```

The CLI does not validate parameters client-side — it packs `-p` values into the request body and lets the platform reject invalid ones. This keeps the CLI's view from drifting away from the platform's; the source of truth is always `describe`.

`--download` streams the response body straight to stdout — memory stays flat regardless of report size. Pipe through `jq .` if you want it pretty-printed, or `jq -c <filter>` to filter line-by-line on `--format jsonl`.

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

# Stream large summaries as JSONL — one record per line, jq-c friendly
extole reports run --type summary --days 30 \
  -p period=DAY -p dimensions=PROGRAM --format jsonl --download \
  | jq -c 'select(.program == "referrals")'
```

## Components

Extole's configuration is built from **components** — typed, composable building blocks that define programs, rules, rewards, emails, integrations, and more. Understanding the component model is prerequisite to building or modifying offer programs programmatically.

**The type system is nominal and open-ended.** A component declares its type (e.g. `reward-supplier-v10.0`); there is no closed registry of valid types. New types can be declared at any time. The CLI shows what types actually exist in the account at runtime — not a static schema.

**Types form a hierarchy.** `reward-supplier-v10.0` is a subtype of `reward-supplier`, which is a subtype of `component`. Filtering by `--filter-type reward-supplier` matches all subtypes. `components types --tree` renders this hierarchy for the live account.

**Components wire together via sockets.** A rule component references a reward-supplier via a named socket. `--sockets` shows what a component connects to; `--tree` shows the full downstream subgraph.

**The agentic pattern: learn from examples.** There is no static schema doc for what a `reward-supplier-v10.0` requires. The reliable approach is to find a known-good instance (`extole components --filter-type reward-supplier-v10`), read its full config (`extole components get <id>`), and reason from that. `extole chat` can also answer type-specific questions.

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

Each `--webhook-tag` generates a `javascript@buildtime` variable that resolves the webhook ID from the tag when the campaign is published. The component stores the resolved ID — not the tag — so there is no runtime tag lookup overhead.

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

# Print resolved component.json contents (post-%{...}% include expansion) without uploading
extole components deploy --source ./my_integration --dry-run

# Show full API error details on failure
extole components deploy --source ./my_integration --verbose
```

Running `deploy` without `--component` always creates a new campaign. Pass `--component` with the ID from the first deploy to update in place.

Settings values can reference external files using `%{/path/to/file.js}%` — the CLI inlines the file content before uploading. Webhook `request` and `response_handler` scripts must start with `javascript@runtime:`; build-time-only values use `javascript@buildtime:`.

### Patching component settings

Update one or more settings on an already-deployed component without redeploying the bundle:

```
extole components set <component-id> --setting apiKey=test_key_123
extole components set <component-id> --setting apiKey=k1 --setting endpoint=https://example.com
extole components set <component-id> --setting apiKey=k1 --dry-run    # show payload only
```

Useful for iteration loops and CI: tweak a setting, fire an event, observe the result without round-tripping through the bundle. Values are sent as strings; the platform validates against the setting's declared type and rejects mismatches with a clear error.

If the component is on a LIVE campaign, the change is staged but not active in production until you republish the campaign (via `components deploy --publish` or my.extole).

### Deleting components

```
extole components delete <component-id>             # prompts for confirmation
extole components delete <component-id> --confirm   # skip prompt (for scripts)
extole components delete <component-id> --dry-run   # show what would be deleted
```

Deleting a root component archives its entire campaign. The CLI shows the component name and type and warns if it's a root before prompting.

For a full walkthrough of the bundle format, sub-component structure, and deployment workflow, contact your Extole solutions engineer or refer to internal Extole documentation.

## Feedback

```
extole feedback the --filter-state flag should mention it is REWARD-only in the help text
extole feedback auth login flow was confusing at first, needed to read the README
```

Creates a Jira ticket via the Extole AI agent. Includes your account name and CLI version automatically.

## AI (extole chat)

`extole chat` gives you access to an Extole AI agent with deep knowledge of Extole's API surface, program configuration model, event semantics, component type system, and reward flows. Use it **before** exploring the API blindly — it can tell you which endpoint to use, what parameters it accepts, what the response shape is, and how concepts relate to each other.

Good uses:
- **API discovery**: "what endpoint do I use to filter steps by a specific event?"
- **Concept clarification**: "what's the difference between a journey and a step?"
- **Debugging guidance**: "why would a purchase event not trigger a reward?"
- **Design validation**: "if I want to enroll a person into a program, what's the right API approach?"
- **Schema lookup**: "what fields does the reward-supplier component type require?"

```
extole chat "what endpoint filters person steps by cause event id?"
extole chat "why aren't events firing for jane@example.com"
extole chat "explain the reward supplier types available"
extole chat "what's the difference between causeEventIds and rootEventIds on steps?"
```

Uses your stored Extole token — no separate login required. Uses a dedicated CLI agent (`extole_assistant_cli`) tuned for CLI workflows.

`chat` and `feedback` are excluded from `extole serve` — they call the AI agent and would be circular if exposed as MCP tools.

## Share Links

Two directions:

```
extole share-links list --email jane@example.com              # all share links for a person
extole share-links list --email jane@example.com --label credit-cards
extole share-links list --email jane@example.com --json

extole share-links lookup chrisbackfillcw214                  # reverse: code → owner
extole share-links lookup https://demo-data-finserv.extole.io/chrisbackfillcw214
extole share-links lookup chrisbackfillcw214 --json
```

`list` returns the share links for a person — label, code, and full URL. Use `--label` to filter when a person has links across multiple programs (e.g. verifying a backfill wrote the correct label).

`lookup` is the reverse: given a share code or full share URL (from analytics, a webhook payload, a customer report, a screenshot), return the owning person and program. URL parsing is automatic — pass the whole URL or just the code.

Error messages distinguish person-not-found from person-has-no-links:
- `No person found for jane@example.com` — email not in Extole
- `No share links found for jane@example.com (person ID: abc123)` — person exists, no links

## Zones

```
extole zones                                           # list embed zone names for this account
extole zones --json

extole zones core                                      # print the core.js <script> tag for this account
extole zones tag <zone_name>                           # print the embed snippet for a zone

extole zones call <zone_name> --email <email>          # POST to a zone (test FRONTEND_CONTROLLER pipelines)
extole zones call <zone_name> --email <email> --param partner_user_id=abc123
extole zones call <zone_name> --email <email> --json
```

`zones call` POSTs to `/v5/zones/<zone_name>` with the given email and any extra `--param` fields. Useful for testing FRONTEND_CONTROLLER + DISPLAY action pipelines without a browser.

## MCP server (Claude Desktop / Claude Code)

`extole serve` runs the CLI as an MCP stdio server — Claude Desktop and Claude Code can spawn it and call any CLI command as a tool.

```
extole serve setup    # auto-configure Claude Desktop and Claude Code; restart the client to activate
extole serve remove   # remove the MCP server registration from all detected clients
extole serve          # start the MCP server (Claude Desktop spawns this automatically after setup)
```

`serve setup` detects Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) and Claude Code (`~/.claude/settings.json`) and writes the MCP server entry to each. Re-run after updating the CLI to pick up new tools.

## API (escape hatch)

Direct authenticated access to any Extole endpoint — for cases where no specific subcommand exists yet:

```
extole api /v2/campaigns/123/controllers
extole api /v6/webhooks/built
extole api /v2/campaigns/123/publish --method POST --body '{}'
extole api /v4/tokens --auth-base              # use api.extole.com instead of api.extole.io
```

GET by default. `--method` to override, `--body` for POST/PUT/PATCH, `--auth-base` for the auth API. Output is JSON-formatted and supports `--compact`.

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

## Contributing

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/extole/extole-cli/issues). For bugs, include the CLI version (`extole --version`), the command you ran, and the output.

## License

MIT

## Releasing

1. Update `package.json` and `package-lock.json` for the release version.
2. Merge the release change to `master`.
3. Publish a GitHub Release from `master` with tag `v<package version>`.
4. Publishing the GitHub Release triggers the release workflow, which runs tests, verifies the tag matches `package.json`, requires the release commit to be current `master`, checks that the version is not already published, and publishes through npm trusted publishing.
