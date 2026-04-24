# Template: Component-Driven Webhook Integration

A component-driven webhook wires an external API call into Extole's event flow.
The component owns the configuration and business logic. The webhook is the outbound
HTTP primitive. They are linked by **tags**.

This pattern is used for integrations like Iterable, Tango, Pendo, Salesforce, etc.
It is more powerful than the controller/trigger model because the component can
handle multiple webhooks, complex payload mapping, and event filtering in one place.

---

## Verification status

| Claim | Status | Source |
|---|---|---|
| `/v1/components` is a real creation endpoint | **Confirmed** | Recent tests + release notes explicitly reference it |
| All four webhook types (GENERIC, CLIENT, REWARD, PARTNER) supported | **Confirmed** | `ComponentBundleElementsConfiguration` maps each to a distinct `ExternalElementType` |
| `response_body_handler` only applies to PARTNER type | **Confirmed** | Only `PartnerWebhookBuilder` applies it |
| `javascript@buildtime` tag discovery pattern is real | **Confirmed** | Tango integration PR uses `context.getComponent().createElementsQuery().withType('WEBHOOK').withTag(...).list()` |
| `campaign_id` is always required | **Unverified** | Observed in all tested flows; no proof there's no account-level scope |
| Omitting `types` bypasses schema enforcement | **Observed** | Works in practice; exact bypass mechanism not confirmed from code |
| CLIENT only fires for browser/SDK events | **Observed** | Runtime behavior, not code-backed |
| `api.extole.io` normalizes CLIENT→GENERIC; `my.extole.com/api` preserves it | **Observed** | Confirmed via request/response testing, not traced in code |

---

## How the pieces fit together

```
  [ Extole Event ]
        │
        ▼
  [ Component ]  ←── owns configuration; build-time evaluatables resolve
        │               tagged external elements during campaign build/publish
        ▼
  [ Webhook ]    ←── outbound HTTP call
        │               request script maps payload + injects auth
        ▼
  [ External API ]
```

The component references webhooks by **tag**, not by ID. At campaign build/publish
time, the `javascript@buildtime` expression in each variable runs once, resolves
the matching webhook by tag, and stores the ID. This makes the component portable —
the webhook can be recreated or swapped without editing the component.

---

## 1. Webhooks

Each webhook is a named outbound HTTP endpoint. Tag it so the component can
discover it at build time.

```json
{
  "name": "My Integration — Events",
  "type": "GENERIC",
  "url": "https://destination.example.com/api/events",
  "enabled": true,
  "description": "Send referral events to My Integration",
  "tags": [
    "my-integration-events",
    "internal:app_type=my-integration.com"
  ],
  "retry_intervals": [1, 30, 60],
  "request": "javascript@runtime:(function () { ... })()"
}
```

**Tag conventions:**
- `my-integration-<purpose>` — used by the component to discover this webhook by role
- `internal:app_type=<domain>` — groups all webhooks belonging to an integration; used for filtering in dispatches

**One webhook per outbound endpoint/purpose.** If the integration has separate
endpoints for events, subscriptions, and unsubscribes, create three webhooks with
distinct tags.

**CLI:**
```bash
extole webhooks create \
  --name "My Integration Events" \
  --url "https://destination.example.com/api/events" \
  --type GENERIC \
  --tag "my-integration-events" \
  --tag "internal:app_type=my-integration.com"
```

---

## 2. The `request` script

The `request` field is a `javascript@runtime` script that runs on every potential
dispatch. It builds the outbound HTTP request — or returns `null` to suppress it.

This is where payload mapping, auth injection, and event filtering live.

```javascript
javascript@runtime:(function () {
    var requestBuilder = context.createRequestBuilder();

    // ── Event filtering ────────────────────────────────────────────────────
    // Return null to suppress the dispatch for non-matching events.
    var clientEvent = context.getClientEvent();
    if (!clientEvent) return null;

    var eventName = String(clientEvent.getName());
    var allowedEvents = ["signed_up", "referred_purchase"];
    if (allowedEvents.indexOf(eventName) === -1) return null;

    // ── Auth ───────────────────────────────────────────────────────────────
    // The client key is configured in Security Center and referenced here.
    var apiKey = context.getWebhook().getClientKey().getKey();

    // ── Payload mapping ────────────────────────────────────────────────────
    // context.getData() returns the Extole event payload.
    // Map it to whatever shape the destination API expects.
    var raw = JSON.parse(
        context.getGlobalServices().getJsonService().toJsonString(clientEvent.getData())
    );

    // Helper: unwrap Extole's { value: "..." } field wrappers
    function unwrap(obj) {
        var out = {};
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) {
                out[k] = obj[k] && obj[k].value != null ? obj[k].value : obj[k];
            }
        }
        return out;
    }
    var data = unwrap(raw);

    var body = {
        event:     eventName,
        email:     data.email       || null,
        firstName: data.first_name  || null,
        lastName:  data.last_name   || null,
        clientId:  String(clientEvent.getClientId()),
        timestamp: new Date().getTime()
    };

    return requestBuilder
        .withMethod("POST")
        .addHeader("Content-Type", "application/json")
        .addHeader("Authorization", "Bearer " + apiKey)
        .withBody(JSON.stringify(body))
        .build();
})();
```

**Key context objects:**

| Object | What it gives you |
|---|---|
| `context.getClientEvent()` | The triggering event — name, data, userId, clientId |
| `context.getWebhook().getClientKey().getKey()` | The secret from Security Center |
| `context.getGlobalServices().getJsonService().toJsonString(x)` | Serialize a Java object to JSON string |
| `context.getData()` | Shorthand for event data (same as `clientEvent.getData()`) |
| `context.createRequestBuilder()` | Builder for the outbound HTTP request |

**Returning `null` suppresses the dispatch entirely** — no HTTP call, no dispatch
record. Use this to filter events inside the script rather than relying on a
controller trigger.

---

## 3. The component

The component owns the integration. It holds configuration variables (API keys,
list IDs, feature flags) and discovers the webhooks it needs by tag at build time.

The `javascript@buildtime` expression runs once during campaign build/publish —
not on every event. It resolves the webhook ID by tag and stores it as the
variable's value for runtime use.

**Component API shape:**
```json
{
  "name": "my_integration",
  "display_name": "My Integration",
  "description": "Sends referral events to My Integration",
  "campaign_id": "<campaign-id>",
  "settings": [

    // ── Configuration ──────────────────────────────────────────────────────
    {
      "name": "listId",
      "display_name": "Subscription List ID",
      "type": "STRING",
      "values": { "default": "REPLACE_ME" },
      "tags": ["category:Configuration"]
    },

    // ── Webhook discovery ──────────────────────────────────────────────────
    // Resolved at build/publish time by finding webhooks tagged with the
    // matching tag. Stores the resolved ID, not the tag.
    {
      "name": "eventsWebhookId",
      "display_name": "Events Webhook Id",
      "type": "STRING",
      "values": {
        "default": "javascript@buildtime:(function(){ var items = Java.from(context.getComponent().createElementsQuery().withType('WEBHOOK').withTag('my-integration-events').list()); return items && items.length > 0 ? items[0].getId() : null; })()"
      },
      "tags": ["category:Webhooks"]
    }

  ]
}
```

**Note on `types`:** Registered types (`extension`, `integration-v1`) enforce a
JSON schema that requires specific UI display settings (`short.description`, `icon`,
etc.). Omitting `types` bypasses schema enforcement and is appropriate for custom or
programmatic components. If you want the component to appear in the Partners UI, use
`extension` or `integration-v1` and supply all required settings.

**CLI (creates component + webhook discovery in one step):**
```bash
# Single webhook tag
extole components create \
  --name "my_integration" \
  --display-name "My Integration" \
  --campaign "<campaign-id>" \
  --description "Sends referral events to My Integration" \
  --webhook-tag "my-integration-events"

# Multiple webhooks — auto-derives varName from tag
extole components create \
  --name "my_integration" \
  --campaign "<campaign-id>" \
  --webhook-tag "my-integration-events" \
  --webhook-tag "my-integration-subscriptions"

# Explicit varName:tag syntax
extole components create \
  --name "my_integration" \
  --campaign "<campaign-id>" \
  --webhook-tag "eventsWebhookId:my-integration-events"
```

---

## 4. Webhook types

| Type | Trigger | Unique field | CLI notes |
|---|---|---|---|
| `GENERIC` | Any event routed by component or controller | — | Default; use for backend/API events |
| `CLIENT` | Browser/mobile SDK events only | — | Must be created via `my.extole.com/api`, not `api.extole.io` |
| `REWARD` | Reward fulfillment events | `filters` | Reward-specific filtering |
| `PARTNER` | Partner/integration flows | `response_body_handler` | Parses HTTP response body into structured data |

All types share: `name`, `type`, `url`, `client_key_id`, `tags`, `request`,
`response_handler`, `enabled`, `description`, `default_method`, `retry_intervals`,
`component_ids`, `component_references`.

---

## 5. Checklist

Before deploying:

- [ ] Webhooks created with correct tags
- [ ] Client key created in Security Center and assigned to each webhook
- [ ] `request` script tested against a real event (use `webhook-listen.js` + tunnel)
- [ ] Component variables verified — `eventsWebhookId` etc. resolve to real IDs after publish
- [ ] Feature flag variables default to `false` for safe rollout
- [ ] `retry_intervals` set appropriately for the destination API's tolerance
- [ ] Webhooks tagged with `internal:app_type=<domain>` for dispatch grouping

---

## 6. Open questions (unverified)

1. Is `/v1/components` the intended stable external creation endpoint, or an internal surface that happens to work?
2. Does omitting `types` skip schema enforcement by design, or is it a side effect?
3. Does build-time tag lookup behave correctly through a full publish → install → republish cycle, including webhook swaps?
4. Are all components campaign-scoped in the product model, or only in the flows exercised here?
5. Is `api.extole.io` vs `my.extole.com/api` webhook type behavior (CLIENT normalization) a supported distinction or an artifact of which controller is being hit?

---

## 7. Debugging

```bash
# Verify webhooks exist with correct tags
extole webhooks --filter-type GENERIC --json | jq '.[] | {name, tags, enabled}'

# Check dispatch attempts
extole webhooks dispatches <webhook-id>

# Check HTTP outcomes (response codes, error bodies)
extole webhooks dispatch-results <webhook-id>

# Local HTTP server + public tunnel for live testing
node ~/projects/webhook-listen.js
node ~/projects/webhook-listen.js --create-webhook --account "Demo Data Finserv"

# Stream events to confirm they're arriving
extole stream --event-type INPUT --filter signed_up
```
