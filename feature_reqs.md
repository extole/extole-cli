# Extole CLI — Feature Requests

## 1. Event count by name / time window

```
extole events count --event-name lead_created --since 10m
extole events count --event-name opportunity_closedwon --since 1h --sandbox
```

**Use case:** Post-test verification. After a bulk Lead import or event config test, confirm how many events of a given name arrived in Extole within the last N minutes — without having to stream or check Salesforce telemetry.

---

## 2. Version update notifications

On startup, check whether a newer version of the CLI is available and print a warning if the local version is behind:

```
⚠ extole-cli 1.2.0 is available (you have 1.1.0). Run: npm install -g extole-cli
```

Throttle the check to once per day via a timestamp in `~/.extole/config`.

**Blocker:** Distribution strategy not finalized — CLI is not on npm yet. Implement once a version endpoint or release tag is available.

---

## 3. Feedback command

```
extole feedback "suggestion or bug report"
```

Routes feedback to an internal channel (destination TBD — not GitHub).

**Blocker:** Internal feedback destination not decided yet. Options: email alias, Slack intake, Jira/Linear form.

---

## 4. Audiences

```
extole audiences list
extole audiences create --name "Closed Won 60d"
extole audiences add <audience-id> --email jane@example.com
extole audiences add <audience-id> --file members.csv
extole audiences status <audience-id> --operation-id <op-id>
```

Wraps `/v1/audiences` and `/v1/audiences/{id}/operations`. Primary use case: testing the audience sync feature (e.g. SFDC-driven bulk enrollment) before it's built into the app.

---

## 6. Component template library

Build a library of annotated component templates by inspecting known-good live instances
and stripping client-specific values. Each template explains the structure, required
variables, and how pieces wire together — for both humans and agents building integrations.

Priority templates (in order):

1. **`webhook-component`** ✓ — done. GENERIC/CLIENT webhook + owning component, tag-based
   discovery, `request` script patterns (filter via `return null`, payload mapping, auth).

2. **`integration-v10.1`** — the Partners UI card. Type `integration-v10.1`, `internal:ui-display`
   tagged variables drive the card (short.description, categories, logo, imageKey, URLs),
   `CLIENT_KEY` variable type for Security Center keys, `MULTI_SOCKET` sockets for child
   components. BHN (`7597354224252648223`) is the canonical example.

3. **`event-stream-view-v10.0`** — the monitoring tabs inside a partner card (usage graph,
   live events, etc.). Socketed into the `views` MULTI_SOCKET on integration components.
   Four instances on BHN: `7626642088441783792`, `7626642090081238543`,
   `7629768086440970382`, `7629781326299192934`.

4. **`bhn-reward-supplier-v10.0`** — reward supplier config component, socketed into
   `rewardSuppliers` on the integration. Contains fulfillment webhook wiring.

5. **`role-v4`** — top-level program container. Showed up in PolicyGenius as the
   root of the component tree.

Templates live in `templates/`. Each is a markdown file with annotated JSON examples,
context object reference, and a checklist.

**Expression type reference (discovered so far):**
- `javascript@runtime` — runs on every event dispatch; return null to suppress
- `javascript@buildtime` — runs once at publish; used for tag-based webhook discovery
- `spel@buildtime` — Spring Expression Language; used for asset URL lookups

## 5. Webhook listen — Extole-managed relay URL

Currently `extole webhooks listen` requires `--url` pointing at a publicly reachable server. Once Extole builds relay infrastructure (similar to Stripe's `stripe listen`), the `--url` flag becomes optional and the CLI provisions the endpoint automatically:

```
extole webhooks listen --campaign <id> --event signed_up   # no --url needed
```

The `--url` flag and the command contract stay unchanged — relay is just the default when no URL is provided.
