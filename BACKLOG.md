# Backlog

## npm publish prep

- [ ] Remove `"private": true` from package.json — npm will refuse to publish with it set
- [ ] Add `"license"` field (e.g. `"MIT"`) — npm warns on publish; enterprise scanners flag unlicensed packages
- [ ] Add `author`, `keywords`, `repository`, `homepage`, `bugs` fields for npm registry discoverability

## Features

- [ ] `extole components deploy --dry-run` should print the resolved JSON (post-%{...}% include expansion), not just file paths — needed to verify what actually gets uploaded
- [ ] `extole webhooks detach <webhook-id> --campaign <id>` (inverse of `attach`) — small standalone primitive for cleaning up wiring; uses `DELETE /v2/campaigns/{id}/controllers/{cid}` (confirmed in pluribus)
- [ ] `extole person relationships --email <e>` — wraps `GET /v5/persons/{id}/relationships`; lists advocate↔friend referral relationships; extends the `--route` debugging chain
- [ ] `extole person stats --email <e>` — wraps `GET /v4/persons/{id}/stats` and `/network-stats`; profile + referral network summary (share counts, conversions, friends referred)
- [ ] Add a controllers surface (`extole controllers <event_id>` or `wismr --controllers`) — pulls the per-event integration execution log where the actual BHN/Tango partner error lives; the missing diagnostic layer below `wismr`
- [ ] Gate `extole wismr` to SU-only accounts (via `su_client` in config) — wismr hits a data ceiling for self-service clients ("FAILED FULFILLED" but no error message); keep `rewards` client-facing

## Explorations

- [ ] Investigate MCP/agent output variance for `describe`-style commands — run same prompt N times, check if output clusters or is truly random; compare stripped vs full skill bodies; capture which tool calls succeed/fail per run
- [ ] CLI-gathers-MCP-narrates pattern — pre-fetch structured data via CLI helpers, send to MCP only for prose narration; deterministic data layer, no tool-reach gaps
