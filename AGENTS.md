# AGENTS.md

Guidance for AI agents working in this repo. Read before making changes.

## Repo purpose

Developer CLI for the Extole API. Plain ESM Node.js — no build step, no transpilation, no bundler.

## Structure

```
bin/extole.js          entry point — imports and registers all commands
src/commands/          one file per command group (webhooks.js, components.js, etc.)
src/config.js          account/token resolution, base URL constants
src/api.js             HTTP helpers (apiJson, apiFetch)
src/utils.js           addGlobalOptions helper
src/output.js          printJson helper
```

**Adding a new command:**
1. Create `src/commands/<name>.js` exporting a `<name>Command()` function
2. Import it in `bin/extole.js`
3. Register it with `program.addCommand(<name>Command())`

Both steps are required — forgetting step 2 or 3 means the command silently doesn't exist.

## Testing

The package is installed via `npm link`, so `~/.npm-global/lib/node_modules/extole-cli` is a symlink to this repo. **Changes are live immediately** — no install step needed after editing.

Test with the installed binary:
```bash
extole <command> --help
extole <command> [args]
```

Do NOT run `node src/...` directly — the entry point is `bin/extole.js` and relative imports won't resolve correctly from outside the package root.

## Key constants (src/config.js)

| Export | Value | Used for |
|---|---|---|
| `BASE_URL` | `https://my.extole.com` | Campaign, controller, webhook CRUD |
| `PERSON_BASE` | `https://api.extole.io` | Person, component, event-stream, built-webhook endpoints |
| `AUTH_BASE` | `https://api.extole.com` | Token auth |

## Known gotchas

### Commander option shadowing
Parent command options silently consume subcommand options of the same name before the subcommand sees them. Example: if `webhooks` (list) has `--type` and `webhooks create` also has `--type`, the parent consumes it and `create` gets the default.

**Fix:** name parent list-filter options distinctively — `--filter-type`, `--filter` — so they don't collide with subcommand options.

### Webhook type routing
`CLIENT`, `REWARD`, and `PARTNER` webhooks must be created via `BASE_URL + /api/v6/webhooks`. The `PERSON_BASE + /v6/webhooks` path normalizes them to `GENERIC` silently.

```javascript
const isTyped = ['CLIENT', 'REWARD', 'PARTNER'].includes(opts.type);
const webhookBase = isTyped ? BASE_URL : PERSON_BASE;
const webhookPath = isTyped ? '/api/v6/webhooks' : '/v6/webhooks';
```

### REWARD webhook filters are a separate API call
The `/v6/webhooks` create endpoint does not accept `webhook_filters`. State filters are created after the webhook via `POST /v4/webhooks/reward/{id}/filters/state` with body `{ "states": [...] }`.

### Component settings vs variables
The `/v1/components` API uses `settings` (not `variables`) with nested `values.default` (not `value`). Schema-enforced component types (`extension`, `integration-v1`) require `description` to be non-null and `icon` to be a real URL — not null, empty string, or a non-URL string. Omitting `types` bypasses schema enforcement.

## Webhook type reference

| API type | Internal name | Triggers on | Runtime context |
|---|---|---|---|
| `GENERIC` | `CONSUMER` | Person/consumer journey events | `ConsumerWebhookRuntimeContext` — use `context.getData()` |
| `CLIENT` | `CLIENT` | Admin/operational `ClientEvent`s (config change, report complete, campaign started, webhook failures) | `ClientWebhookRuntimeContext` — use `context.getClientEvent()` |
| `REWARD` | `REWARD` | Reward state transitions | `RewardWebhookRuntimeContext` — use `context.getReward()` |
| `PARTNER` | `PARTNER` | Manual dispatch only (`POST /v6/webhooks/events/sync/send`, requires `CLIENT_SUPERUSER` scope) | base `WebhookRuntimeContext` |

Do not confuse `GENERIC` (API name) with `CONSUMER` (internal dispatch type) — they are the same thing.

## Adding global options to a command

All commands should call `addGlobalOptions` from `src/utils.js` rather than manually adding `--json`, `--verbose`, `--token`, `--account`. Pass `output: true` to include `--json` and `--compact`:

```javascript
addGlobalOptions(cmd, {
  output: true,   // adds --json, --compact
  examples: [
    'extole mycommand --arg value',
  ],
});
```

## Commit style

No `Co-Authored-By` lines. Commit messages should be concise and describe the why, not just the what.
