# Template: Component-Driven Webhook Integration

A component-driven webhook wires an external API call into Extole's event flow.
The component owns the configuration and business logic. The webhook is the outbound
HTTP primitive. They are linked by **tags**.

This pattern is used for integrations like Iterable, Pendo, Salesforce, etc.
It is more powerful than the controller/trigger model because the component can
handle multiple webhooks, complex payload mapping, and event filtering in one place.

---

## How the pieces fit together

```
  [ Extole Event ]
        │
        ▼
  [ Component ]  ←── owns configuration, event routing logic
        │               discovers webhooks by tag at build time
        ▼
  [ Webhook ]    ←── outbound HTTP call
        │               request script maps payload + injects auth
        ▼
  [ External API ]
```

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

```json
{
  "name": "my_integration",
  "display_name": "My Integration",
  "description": "Sends referral events and subscription changes to My Integration",
  "variables": [

    // ── Configuration ──────────────────────────────────────────────────────
    {
      "name": "listId",
      "display_name": "Subscription List ID",
      "type": "STRING",
      "values": { "default": "REPLACE_ME" },
      "tags": ["category:Configuration"]
    },
    {
      "name": "sendEvents",
      "display_name": "Send Events",
      "type": "BOOLEAN",
      "values": { "default": true },
      "tags": ["category:Configuration"]
    },

    // ── Webhook discovery ──────────────────────────────────────────────────
    // These variables resolve at build time by finding webhooks tagged with
    // the matching tag. The component stores the resolved ID, not the tag.
    {
      "name": "eventsWebhookId",
      "display_name": "Events Webhook ID",
      "type": "STRING",
      "values": {
        "default": "javascript@buildtime:(function(){ var items = Java.from(context.getComponent().createElementsQuery().withType('WEBHOOK').withTag('my-integration-events').list()); return items && items.length > 0 ? items[0].getId() : null; })()"
      },
      "tags": ["category:Webhooks"]
    },
    {
      "name": "subscriptionWebhookId",
      "display_name": "Subscription Webhook ID",
      "type": "STRING",
      "values": {
        "default": "javascript@buildtime:(function(){ var items = Java.from(context.getComponent().createElementsQuery().withType('WEBHOOK').withTag('my-integration-subscription').list()); return items && items.length > 0 ? items[0].getId() : null; })()"
      },
      "tags": ["category:Webhooks"]
    }

  ]
}
```

**The `javascript@buildtime` pattern:**
```javascript
javascript@buildtime:(function(){
    var items = Java.from(
        context.getComponent()
            .createElementsQuery()
            .withType('WEBHOOK')
            .withTag('my-integration-events')
            .list()
    );
    return items && items.length > 0 ? items[0].getId() : null;
})()
```

- Runs once when the component is built/published, not on every event
- `Java.from(...)` converts a Java list to a JS array
- `.withType('WEBHOOK')` scopes the query to webhooks
- `.withTag('...')` matches the tag on the webhook definition
- Returns the webhook's ID, which is then stored as the variable value

---

## 4. Checklist

Before deploying:

- [ ] Webhooks created in Tech Center → Outbound Webhooks with correct tags
- [ ] Client key created in Security Center and assigned to each webhook
- [ ] `request` script tested with `extole webhooks listen` against a sandbox event
- [ ] Component variables verified — `eventsWebhookId` etc. should resolve to real IDs (not null)
- [ ] `sendEvents` / feature flag variables default to `false` for safe rollout
- [ ] `retry_intervals` set appropriately for the destination API's tolerance
- [ ] Webhooks tagged with `internal:app_type=<domain>` for dispatch filtering

---

## 5. Debugging

```bash
# Verify webhooks exist with correct tags
extole webhooks --json | jq '.[] | {name, tags, enabled}'

# Check dispatch attempts
extole webhooks dispatches <webhook-id>

# Check HTTP outcomes (response codes, error bodies)
extole webhooks dispatch-results <webhook-id>

# Live tail during testing
extole webhooks listen --url https://your-server.com/hook --campaign <id> --event signed_up

# Stream events to confirm they're arriving
extole stream --event-type INPUT --filter signed_up
```
