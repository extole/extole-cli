---
name: extole-program-description
description: Produce a marketer-readable description of an Extole referral campaign — covering reward amounts, eligibility rules, share limits, and fraud/quality rules — by reading the live campaign configuration. Use this whenever a user asks to describe, summarize, explain, or write up an Extole program or campaign for any client (for example, "describe the Burpee refer-a-friend program", "summarize this campaign for marketing", "give me a plain-English version of these reward rules", "what are the rules of this program", "what does this program do"). Trigger even if the user doesn't say "skill" — any request for a non-technical, marketer-style summary of an Extole campaign's rules and rewards is in scope.
---

# Extole Program Description

This skill turns an Extole V10 campaign's live configuration into a clean, marketer-readable program description. The audience is a marketer or product manager — not an engineer — so the output reads like prose with bullets, not a list of underscored rule names with technical settings. Every limit and threshold is inlined as a concrete value (e.g. "100 shares per 7 days"), never as the rule's internal label.

## Output format

Always produce output in exactly this shape, substituting the campaign's actual roles, rewards, and rules. Use bold for the three section headers, hyphens for bullets, and never leave a rule's underscored symbol name visible.

```
This is a [program type] program that rewards [role A] and [role B] for qualifying [action].

**The [friend role] will be rewarded [VALUE] on a qualifying [action]**
- (eligibility / limit bullets, plain English, with concrete values)

**The [advocate role] will be rewarded [VALUE] on a qualifying [action] by a [friend role]**
- (eligibility / limit bullets, plain English, with concrete values)

**Quality Rules for All Participants**
- (geo / email / self-referral / bot / fraud bullets, plain English, with concrete values)
```

The "friend" and "advocate" labels are conventions — use whatever role names the campaign actually uses. If a campaign rewards only one role, drop the unused section.

## Workflow

### 1. Get on the right client

If the user named a client, call `extole_client_select` with the short name or client id. If the conversation already established the client, skip this.

### 2. Pick the campaign

Call `extole_programs` to see programs and their campaigns. If the user named a program, use that. Default to the LIVE production campaign; if there are multiple LIVE campaigns in scope, ask the user which one. Note both the campaign id (you'll need it next) and the campaign **name** — the headline reward usually lives in the campaign name (e.g. "Give 20%, Get 20%"), and that's often the easiest path to the reward face value.

### 3. Pull the campaign overview

Call `extole_campaign_overview_get` with the campaign id. The response gives you a `componentTree` and a `productVersion`.

- This skill is for V10. If `productVersion` is V8 or earlier, stop and tell the user — V8 uses controllers, not the component tree, and needs a different read path.
- Walk the tree to identify, for each role:
  - **Rewards** (children with `socketName: "rewards"`) — name plus the reward rules attached underneath (`socketName: "rewardRules"`).
  - **Journeys** (children with `socketName: "journeys"`) — and underneath each, the **business events** with their `qualityRules` and their `triggerRules`.
  - **Targeting scenario** (children with `socketName: "targetingScenario"`) — its `ongoingRules` are the always-on fraud rules.

### 3a. Read the trigger event names per business event

For each business event, find the child component with `socketName: "triggerRules"` (typically named "Input event matches event names"). Call `extole_component_setting_list` on it and read `triggerEventNames` — it's a `STRING_LIST` whose default value is an array of inbound event names (e.g. `["share", "shared", "extole.share"]` for a Shared business event).

The inbound event names and the business event name are distinct concepts: the inbound name is what arrives on the wire from an integration; the business event name is the campaign component listening for it. **One business event commonly accepts multiple inbound names** (Burpee's `Shared` listens for `share`/`shared`/`extole.share`; Madison Reed's V8 `Converted` listens for `conversion`/`completed_order`/`purchased`). Capture every inbound name on every business event — never collapse to "the trigger" singular when the list has more than one entry.

Some V10 business events are **zone-driven** rather than event-driven — they have no `triggerRules` child at all, and instead fire when one of their bound zones is rendered. Burpee's `Promotion Viewed` is zone-driven: it has no triggerRules and instead fires from the zones in its `onsitePromotions` and `emailPromotions` sockets (`global_footer`, `confirmation`, `mail_after_purchase_email`). For these, capture the zone names as the triggers, marked as zones rather than events.

When emitting the description's business-events listing, include a "Trigger inputs" line per business event that lists each trigger on its own line, marked as event or zone:

> **Shared (advocate)**
> Trigger inputs:
>   - share *(event)*
>   - shared *(event)*
>   - extole.share *(event)*

> **Promotion Viewed (advocate)**
> Trigger inputs:
>   - global_footer *(zone)*
>   - confirmation *(zone)*
>   - mail_after_purchase_email *(email zone)*

This mirrors the integration skill's primary section so the two outputs read consistently.

### 4. Read the actual settings for every rule

For each rule component (reward rules, quality rules, ongoing rules), call `extole_component_setting_list` to get its settings. Important parameter detail: the parameter name is **`componentId`**, not `id`. Easy to get wrong.

The response gives the list of settings with their *default* values. When a campaign hasn't overridden a setting (which is the common case), the default is what's in effect. Capture the values you'll need to render: `countMax`, `recentActivityWindow`, `scope`, the individual booleans on self-referral and bot rules, country lists, blocked subnets, blocked referrer sites, etc.

### 5. Resolve the reward face value

V10 reward containers can return "component not found" through the standard component-read APIs, so the reward amount isn't always reachable directly. Walk this fallback chain:

1. **Campaign name.** The campaign is usually named after the headline reward ("Give 20%, Get 20%", "$10 for you, $10 for a friend"). Lift the value straight from the name.
2. **Reward supplier list.** Call `extole_reward_supplier_list` and look for a supplier whose name or partner id matches the program label or the client (e.g. supplier name containing "burpee", or matching the program label). The supplier's `face_value` and `face_value_type` give you the value (e.g. `20.0` + `PERCENT_OFF` → "20% off"; `25.0` + `USD` → "$25"; `500.0` + `POINTS` → "500 points").
3. **If neither nails it down**, write `[reward value — could not be confirmed from campaign config; please verify]` and flag it in your reply. Don't guess.

### 6. Translate rule names into marketer English

Always inline the actual setting values from step 4. Never leave an underscored rule name in the output.

| Rule (component name) | Marketer-readable form |
|---|---|
| `business_event_quality` | Do not render as its own bullet. Its meaning is the union of the per-event quality rules below; rendering it separately just creates a confusing meta-rule. |
| `has_email_address` | "Must have a valid email address" |
| `has_not_been_rewarded_for_relationship` (scope=CLIENT) | "This [advocate]–[friend] pair must not have already been rewarded together anywhere in the [client] account" |
| `has_not_been_rewarded_for_relationship` (scope=PROGRAM) | "This pair must not have already been rewarded together in this program" |
| `has_not_been_rewarded` (countMax=0) | "Must not have been rewarded in this program before" |
| `has_not_been_rewarded` (countMax=N>0) | "Can be rewarded at most N times in this program" |
| `reward_limit` (countMax=N, scope=PROGRAM, no window) | "Can earn at most N rewards from this program (lifetime cap)" |
| `reward_limit` (countMax=N, scope=PROGRAM, recentActivityWindow=W) | "Can earn at most N rewards from this program every W" |
| `mass_share_limit` (countMax=N, window=W) | "At most N shares per W" |
| `share_email_limit` (countMax=N, window=W) | "At most N share emails per W" |
| `bot_click_prevention` | "Bot multi-click prevention is on. Rapid click prevention is on (clicks within X seconds are filtered)" — X comes from `rapidClickRecentActivityWindow` |
| `valid_email_filter` | "Valid, deliverable email address required" (often redundant with `has_email_address`; pick one wording per output) |
| `Self Referral Prevention` | "No self-referral — blocks if the [friend] has [list of enabled signals as plain English]". Note any signals that are explicitly off, e.g. "(same-IP block is currently off)". The signals are: `customerIdentity` → "the same customer identity (email or key) as the [advocate]"; `similarEmail` → "a similar email"; `sameDeviceIdFilter` → "the same browser ID"; `sameIpFilter` → "the same IP". |
| `Is New Customer` (countMax=0, scope=CLIENT, window=W) | "Must be a new customer (no qualifying action in the [client] account in the last W)" |
| `Fraud Prevention & Traffic Filtering` | Render its sub-settings, not the rule label: country whitelist or blacklist (use `countryFilterAsWhitelist` to know which); blocked subnets (skip if empty); blocked referrer sites (group naturally as "coupon and affiliate domains"). |

Useful ISO-8601 duration conversions you'll see most:

- `PT5S` → "5 seconds"
- `PT24H` → "24 hours"
- `PT168H` → "7 days"
- `PT720H` → "30 days"
- `PT4320H` → "180 days"

### 7. Bucket the rules into the three sections

**Per-reward bullets** — for each reward, render its own reward rules and any reward-specific behavioral limits. Examples:

- The advocate's lifetime reward cap (`reward_limit` on the advocate reward) belongs under the advocate.
- Advocate-only share volume caps (`mass_share_limit`, `share_email_limit` on the advocate's `Shared` business event) belong under the advocate.
- The friend's "must not have been rewarded before" (`has_not_been_rewarded`) belongs under the friend.
- The "must be a new customer" check usually belongs under the friend (it's gating the friend's eligibility).
- Pair-level "not rewarded together before" (`has_not_been_rewarded_for_relationship`) usually belongs under both rewards — it gates each issuance.

**Quality Rules for All Participants** — anything that runs on every event in the journey or applies equally to both roles: country/geo filter, valid email, self-referral prevention, bot and rapid-click prevention, blocked referrer sites, blocked subnets. If the same rule (e.g. self-referral) shows up on multiple business events, render it once here, not three times.

If a rule is genuinely shared (e.g. self-referral runs on signup, conversion, and share click), state it once in Quality Rules.

### 8. Sanity-check the output before sending it

Read your draft against this checklist:

- No underscored rule names left in the output (`mass_share_limit`, `business_event_quality`, etc.). Translate them.
- Every limit has an actual number and time window — "at most 100 shares per 7 days", not "limited shares".
- Country whitelist mentioned with the actual countries. If the list contains a country that's clearly Extole-internal (e.g. Moldova for Extole's own dev team), call it out neutrally — don't editorialize, just give the user a chance to decide what to do about it.
- If the reward face value couldn't be confirmed, say so explicitly rather than guessing.
- Headers are bolded. Bullets use hyphens. No symbol soup.

## Worked example — Burpee, refer-a-friend, V10

After running this skill against Burpee's `PROD Refer a Friend - Give 20%, Get 20%`:

```
This is a referral program that rewards the advocate and the friend for qualifying purchases.

**The friend will be rewarded 20% off on a qualifying purchase**
- Must be a new customer (no purchase in the Burpee account in the last 180 days)
- Can only be rewarded once in this program
- This advocate–friend pair must not have already been rewarded together anywhere in the Burpee account

**The advocate will be rewarded 20% off on a qualifying purchase by a friend**
- Can earn at most 10 rewards from this program (lifetime cap)
- Can send at most 5 share emails per 24 hours and at most 100 shares per 7 days
- This advocate–friend pair must not have already been rewarded together anywhere in the Burpee account

**Quality Rules for All Participants**
- Must be in the US (Moldova is also currently whitelisted to allow internal dev/QA traffic)
- Must have a valid email address
- No self-referral — blocks if the friend has the same customer identity (email/key) as the advocate, a similar email, or the same browser ID. (Same-IP block is currently off.)
- Bot multi-click prevention is on
- Rapid click prevention is on (clicks within a 5-second window are filtered)
- Traffic from coupon and affiliate domains is blocked (RetailMeNot, Slickdeals, CouponCabin, Savings.com, Dan's Deals, ReferralCodes, CouponChief, CouponsMarter, RefAround, and Google ad redirects)
```

## Tools used

- `extole_client_select` — switch client
- `extole_programs` — list programs and campaigns
- `extole_campaign_overview_get` — pull the V10 component tree
- `extole_component_setting_list` — read settings (param name is `componentId`)
- `extole_reward_supplier_list` — fall-back reward face-value lookup

## Known gotchas

- **Reward containers can return "component not found"** through the component-read APIs in V10 — that's why step 5's fallback chain exists. Don't assume the reward amount is reachable directly.
- **Param name is `componentId`** for `extole_component_setting_list`; `id` is rejected.
- **Empty `settings` arrays from built-component reads mean defaults** are in effect; trust the defaults reported by `extole_component_setting_list`.
- **Country whitelists may include Extole-internal countries** (Moldova for Extole's dev team). Surface it without overinterpreting.
- **V8 only**: bail out. This skill is V10 only.
