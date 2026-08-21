The Extole CLI is a command-line tool for developers and technical operators working with the Extole API. It runs from the terminal and integrates into scripts and automation pipelines.

> For complete per-command documentation, flags, and examples, see the [GitHub README](https://github.com/extole/extole-cli).

## Install

**Binary (no Node required) -- Mac and Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/extole/extole-cli/master/install.sh | sh
```

Installs to `/usr/local/bin/extole` when writable; otherwise to `~/.local/bin/extole`. Open a new terminal after installing. Override with `EXTOLE_INSTALL=/your/path`.

**Binary -- Windows:**

Download `extole-windows-x64.exe` from the [latest release](https://github.com/extole/extole-cli/releases/latest), rename to `extole.exe`, and place it on your PATH.

**Homebrew (Mac):**

```bash
brew install extole/tap/extole
```

**npm (requires Node 22.12+):**

```bash
npm install -g @extole/cli
```

Verify: `extole --version`

## Getting a token

Log in to [my.extole.com](https://my.extole.com), navigate to **Settings -- API Access**, and create or copy an API token. The token needs `CLIENT_ADMIN` scope for most read operations and `CLIENT_SUPERUSER` for write operations and advanced diagnostics.

## Authenticate

```bash
extole auth login --token TOKEN
```

For scripts and CI, prefer environment variables:

```bash
export EXTOLE_TOKEN=your-token-here
export EXTOLE_ACCOUNT=acme
```

## Commands

| Domain | Commands | What they do |
| ------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth** | `extole auth *`, `extole ping`, `extole whoami` | Manage credentials, switch between accounts, verify token validity and expiry |
| **Events & People** | `extole events fire` | Fire events -- sandbox by default (safe), `--live` for production. Trace campaign routing with `--trace` |
| | `extole events listen` | Tail live inbound events in real time with filters by type, person, or source |
| | `extole events report <event_id>` | Look up a past event by ID |
| | `extole person get/steps/relationships/stats` | Look up a person's profile, step history, referral graph, and network stats |
| | `extole person rewards` | Rewards for a specific person |
| | `extole person report` | Full profile events report for a person |
| **Rewards** | `extole rewards` | Look up rewards by person, get full details, history, fulfillments, sends, redeems, and cancels |
| | `extole rewards state-summary` | Account-wide reward counts by state, bucketed over time |
| | `extole rewards find-coupon` | Reverse-lookup: given a coupon code, find who received it and its current state |
| **Reward Suppliers** | `extole reward-suppliers` | List configured suppliers (Tango, Salesforce coupons, manual coupon batches, etc.) with face values |
| | `extole reward-suppliers get` | Full supplier detail, including limits, expiry, and tags |
| | `extole reward-suppliers coupons` | For manual-coupon suppliers: count, inventory preview, and depletion warnings |
| | `extole reward-suppliers create` | Create a new reward supplier (MANUAL_COUPON, CUSTOM_REWARD, etc.) *(write)* |
| | `extole reward-suppliers upload-coupons` | Upload coupon codes to a MANUAL_COUPON supplier *(write)* |
| **Components** | `extole components` | List, inspect, and traverse campaign components and their type hierarchy |
| | `extole components create/set/deploy/delete` | Create integration components, patch settings, deploy bundles, and delete components *(write)* |
| **Webhooks** | `extole webhooks` | List, inspect, create, attach, and delete webhooks |
| | `extole webhooks dispatches/dispatch-results/listen` | Inspect dispatch history, HTTP response outcomes, and tail live results in real time |
| | `extole webhooks trace` | Temporarily wire a URL to a campaign event and tail dispatch results |
| **Campaigns & Programs** | `extole programs` | List programs by state and type |
| | `extole campaigns quality-rules/reward-rules/maxmind` | Inspect quality rules, reward rules, and MaxMind fraud-scoring settings per campaign |
| **Audiences** | `extole audiences list/get/members` | List audiences, view size, and page through members |
| | `extole audiences history` | View recent add/remove/replace/sync runs; tail with `--listen` |
| **Reports** | `extole reports recommended/types/describe` | Discover available reports and inspect their parameters before running |
| | `extole reports run/status/download` | Run a report, check completion, and stream results to stdout |
| **Notifications** | `extole notifications` | View recent platform alerts (webhook failures, integration errors); tail with `--listen` |
| **Health** | `extole health` | Email domain deliverability checks (SPF, DMARC, DKIM, MX) and program domain resolution |
| | `extole health provision-dkim` | Provision DKIM keys for an email domain *(write)* |
| **Share Links** | `extole share-links list` | List share links for a person |
| | `extole share-links lookup` | Reverse-lookup: given a share code or URL, find the owning person and program |
| **Zones** | `extole zones` | List embed zone names, get the core.js script tag, and retrieve embed snippets |
| | `extole zones call` | POST to a zone to test FRONTEND_CONTROLLER pipelines without a browser |
| **API** | `extole api <path>` | Authenticated access to any Extole endpoint -- GET by default, supports `--method`, `--body` |
| | `extole api search <keyword>` | Search published Extole API endpoints by keyword across path, summary, and description |
| **Feedback** | `extole feedback` | Submit feedback or bug reports directly from the CLI |

Run `extole --help` or `extole <command> --help` for full options on any command.

## Output conventions

- Human-readable by default; add `--json` on any command for machine-readable output
- `--compact` strips nulls and empty fields
- `--verbose` logs each HTTP request to stderr
- Data goes to stdout, status to stderr -- fully pipeable

## AI integration

The CLI exposes an AI assistant with deep knowledge of the Extole API:

```bash
extole chat "why would a purchase event not trigger a reward?"
extole chat "what endpoint filters person steps by cause event id?"
```

## Source

[github.com/extole/extole-cli](https://github.com/extole/extole-cli)
