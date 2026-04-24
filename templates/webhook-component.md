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
| All four webhook types (GENERIC, CLIENT, REWARD, PARTNER) supported | **Confirmed** | `WebhookType.java` enum; `WebhookEndpoints.java` accepts all four |
| `GENERIC` is internally named `CONSUMER` | **Confirmed** | `WebhookDispatchEndpointsImpl.toWebhookType()`: `case CONSUMER → GENERIC` |
| CLIENT webhooks fire for admin/operational events | **Confirmed** | `ClientWebhookEventProducer.java` wraps `ClientEvent`; `ClientWebhookRuntimeContext.getClientEvent()` |
| GENERIC webhooks fire for person/consumer journey events | **Confirmed** | `ConsumerWebhookDispatchBuilder.java`; `ConsumerWebhookRuntimeContext.getData()` |
| REWARD webhooks fire on reward state transitions | **Confirmed** | `RewardWebhookDispatchBuilder.java`; `RewardWebhookRuntimeContext.getReward()` |
| PARTNER webhooks are manual-dispatch only | **Confirmed** | `PartnerWebhookDispatcher` only called from `WebhookDispatchEndpointsImpl.sendSyncWebhookEvent()` — no event-triggered path |
| `response_body_handler` only applies to PARTNER type | **Confirmed** | Only `PartnerWebhookBuilder` applies it; absent from other builders |
| `javascript@buildtime` tag discovery pattern is real | **Confirmed** | Used in Tango, BHN, SessionM integration components: `context.getComponent().createElementsQuery().withType('WEBHOOK').withTag(...).list()` |
| Reward filter types: STATE, SUPPLIER, TAGS, EXPRESSION | **Confirmed** | `RewardWebhookFilterType.java` enum |
| Reward state filter values | **Confirmed** | `DetailedRewardState.java`: EARNED, FULFILLED, FULFILL_FAILED, SENT, REDEEMED, FAILED, CANCELED, REVOKED |
| `campaign_id` is always required | **Unverified** | Observed in all tested flows; no proof there's no account-level scope |
| Omitting `types` bypasses schema enforcement | **Observed** | Works in practice; exact bypass mechanism not confirmed from code |
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

## 1. Webhook types

There are four types. Each fires under different conditions and exposes a different
runtime context in the `request` script.

| Type | Internal name | Trigger | Runtime context | Unique field |
|---|---|---|---|---|
| `GENERIC` | `CONSUMER` | Person/consumer journey events (referral, share, purchase, custom) | `ConsumerWebhookRuntimeContext` | — |
| `CLIENT` | `CLIENT` | Admin/operational `ClientEvent`s (config change, report complete, campaign started, webhook failure, etc.) | `ClientWebhookRuntimeContext` | — |
| `REWARD` | `REWARD` | Reward state transitions (EARNED, FULFILLED, FAILED, etc.) | `RewardWebhookRuntimeContext` extends CONSUMER | `filters` |
| `PARTNER` | `PARTNER` | Manual dispatch only via `POST /v6/webhooks/events/send` | base `WebhookRuntimeContext` | `response_body_handler` |

**GENERIC** is the right default for integrations that receive person journey events.
**CLIENT** is for operational callbacks — e.g. notify a system when a campaign goes live
or when a report finishes. **REWARD** is for fulfillment integrations that need to act
on reward state changes. **PARTNER** has no automatic trigger — only used when you
want to manually fire a webhook via the API.

---

## 2. Request script context by type

### GENERIC (`ConsumerWebhookRuntimeContext`)

```javascript
javascript@runtime:(function () {
    var requestBuilder = context.createRequestBuilder();

    // getData() — the Extole event payload as Map<String, Object>
    var data = context.getData();
    var eventData = JSON.parse(
        context.getGlobalServices().getJsonService().toJsonString(data)
    );

    // Helper: unwrap Extole's { value: "..." } field wrappers if present
    function unwrap(obj) {
        var out = {};
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) {
                out[k] = obj[k] && obj[k].value != null ? obj[k].value : obj[k];
            }
        }
        return out;
    }
    var d = unwrap(eventData);

    // Optional: filter by event name or sandbox
    // var sandbox = context.getSandbox(); // "true"/"false"

    var body = {
        email:     d.email      || null,
        firstName: d.first_name || null,
        lastName:  d.last_name  || null,
        timestamp: new Date().getTime()
    };

    return requestBuilder
        .withMethod("POST")
        .addHeader("Content-Type", "application/json")
        .addHeader("Authorization", "Bearer " + context.getWebhook().getClientKey().getKey())
        .withBody(JSON.stringify(body))
        .build();
})();
```

**GENERIC context API:**

| Method | Returns |
|---|---|
| `context.getData()` | `Map<String, Object>` — the event payload |
| `context.getSandbox()` | `Sandbox` — sandbox flag |
| `context.getWebhook()` | The webhook config object |
| `context.getWebhook().getClientKey().getKey()` | Secret from Security Center |
| `context.getAttemptCount()` | Number of prior retry attempts |
| `context.createRequestBuilder()` | Builder for the outbound HTTP request |

Returning `null` suppresses the dispatch entirely — no HTTP call, no dispatch record.
Use this to filter events inside the script.

---

### CLIENT (`ClientWebhookRuntimeContext`)

```javascript
javascript@runtime:(function () {
    var clientEvent = context.getClientEvent();
    var eventName = String(clientEvent.getName());

    // CLIENT events worth acting on — see ClientEvent.java constants
    var watchedEvents = ["report_completed", "campaign_started", "webhook_dispatch_failed"];
    if (watchedEvents.indexOf(eventName) === -1) return null;

    var data = JSON.parse(
        context.getGlobalServices().getJsonService().toJsonString(clientEvent.getData())
    );

    var body = {
        event:     eventName,
        clientId:  String(clientEvent.getClientId()),
        level:     String(clientEvent.getLevel()),  // INFO / WARN / ERROR
        message:   clientEvent.getMessage(),
        timestamp: new Date().getTime()
    };

    return context.createRequestBuilder()
        .withMethod("POST")
        .addHeader("Content-Type", "application/json")
        .withBody(JSON.stringify(body))
        .build();
})();
```

**CLIENT context API (extends base):**

| Method | Returns |
|---|---|
| `context.getClientEvent()` | The `ClientEvent` — name, tags, level, message, data, userId, clientId |
| `clientEvent.getName()` | String event name (e.g. `"report_completed"`) |
| `clientEvent.getLevel()` | `INFO`, `WARN`, or `ERROR` |
| `clientEvent.getMessage()` | Human-readable message |
| `clientEvent.getData()` | `Map<String, DataValue>` — structured data fields |

**Named CLIENT event constants** (from `ClientEvent.java`):

```
config_change            report_completed         report_failed
campaign_started         campaign_published        webhook_created
webhook_dispatch_failed  webhook_dispatch_failed   reward_fulfillment_failed
reward_not_fulfillable   coupon_balance_warn_limit_reached
audience_created         batch_job_created         erasure_request
user_login               user_first_login
```

---

### REWARD (`RewardWebhookRuntimeContext`)

```javascript
javascript@runtime:(function () {
    var reward = context.getReward();

    // State at dispatch time
    var state = reward.getType();   // "EARNED", "FULFILLED", "FAILED", etc.

    var body = {
        rewardId:         reward.getRewardId(),
        state:            state,
        personId:         reward.getPersonId(),
        partnerUserId:    reward.getPartnerUserId(),
        rewardSupplier:   reward.getRewardSupplierName(),
        faceValue:        reward.getFaceValue(),
        faceValueType:    reward.getFaceValueType(),
        partnerRewardId:  reward.getPartnerRewardId(),  // null until FULFILLED
        data:             reward.getData()
    };

    return context.createRequestBuilder()
        .withMethod("POST")
        .addHeader("Content-Type", "application/json")
        .withBody(JSON.stringify(body))
        .build();
})();
```

**REWARD context API (extends GENERIC):**

| Method | Returns |
|---|---|
| `context.getReward()` | `PublicReward` — full reward snapshot at dispatch time |
| `reward.getType()` | State string: `EARNED`, `FULFILLED`, `SENT`, `REDEEMED`, `FAILED`, `FAILED_FULFILLMENT`, `CANCELED`, `REVOKED` |
| `reward.getRewardId()` | Extole reward ID |
| `reward.getPersonId()` | Extole person ID |
| `reward.getPartnerUserId()` | Partner's user identifier |
| `reward.getRewardSupplierName()` | Name of the reward supplier |
| `reward.getFaceValue()` / `getFaceValueType()` | Reward amount + currency/type |
| `reward.getPartnerRewardId()` | Supplier's ID for the reward (non-null after FULFILLED) |
| `reward.getData()` | `Map<String, Object>` — custom data attached to the reward |

**REWARD webhook filters** (`/v4/webhooks/reward/{id}/filters` — types: STATE, SUPPLIER, TAGS, EXPRESSION):

```json
"webhook_filters": [
    { "reward_supplier_ids_filter": ["<supplier-id-1>", "<supplier-id-2>"] },
    { "reward_state_filter": ["EARNED"] }
]
```

Reward filter states: `EARNED`, `FULFILLED`, `FULFILL_FAILED`, `SENT`, `REDEEMED`, `FAILED`, `CANCELED`, `REVOKED`

---

## 3. Webhooks — creation

Each webhook is a named outbound HTTP endpoint. Tag it so the component can
discover it at build time.

```json
{
  "name": "My Integration - Events",
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

## 4. The component

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

## 5. Checklist

Before deploying:

- [ ] Webhooks created with correct tags and correct type (GENERIC for person events, CLIENT for admin events, REWARD for reward state)
- [ ] Client key created in Security Center and assigned to each webhook
- [ ] `request` script tested against a real event (use `webhook-listen.js` + tunnel)
- [ ] Component variables verified — `eventsWebhookId` etc. resolve to real IDs after publish
- [ ] Feature flag variables default to `false` for safe rollout
- [ ] `retry_intervals` set appropriately for the destination API's tolerance
- [ ] Webhooks tagged with `internal:app_type=<domain>` for dispatch grouping

---

## 6. Debugging

```bash
# Verify webhooks exist with correct tags
extole webhooks --filter-type GENERIC --json | jq '.[] | {name, tags, enabled}'

# Check dispatch attempts
extole webhooks dispatches <webhook-id>

# Check HTTP outcomes (response codes, error bodies)
extole webhooks dispatch-results <webhook-id>

# List built (buildtime-evaluated) webhooks — resolves all javascript@buildtime expressions
# GET /v6/webhooks/built — useful to verify tag resolution worked

# Local HTTP server + public tunnel for live testing
node ~/projects/webhook-listen.js
node ~/projects/webhook-listen.js --create-webhook --account "Demo Data Finserv"

# Stream events to confirm they're arriving
extole stream --event-type INPUT --filter signed_up
```
