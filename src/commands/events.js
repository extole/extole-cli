import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiFetch, apiJson } from '../api.js';
import { printJson, printJsonText } from '../output.js';
import { collect, sleep, addGlobalOptions, POLL_INTERVAL_MS, isValidEmail, formatEventTime } from '../utils.js';
import { findPerson, getPersonSteps } from '../person-api.js';


export function eventsCommand() {
  const events = new Command('events').description('Fire events and watch downstream steps');

  const fireCmd = new Command('fire')
    .argument('<event_name>', 'Event name to fire')
    .description('Fire a single event via POST /v5/events')
    .allowExcessArguments(false)
    .option('--email <email>', 'email param shortcut')
    .option('--advocate_code <code>', 'advocate_code param shortcut')
    .option('--amount <amount>', 'amount param shortcut')
    .option('-p, --param <kv>', 'key=value param (repeatable)', collect, [])
    .option('--live', 'Fire the event against the live production API')
    .option('--sandbox [name]', 'Fire in sandbox mode (default: production-test); mutually exclusive with --live')
    .option('--dry-run', 'Print request payload without sending')
    .option('--watch', 'After firing, tail the event stream for this email for 15s')
    .option('--watch-timeout <seconds>', 'How long to tail when using --watch', '15')
    .option('--route', 'After firing, trace which campaigns the event reached. Requires --email.')
    .option('--route-timeout <seconds>', 'Seconds to wait for steps to appear when using --route', '8')
    .option('--route-webhook <id>', 'With --route, also check this webhook for dispatches caused by the event')
    .option('--summary', 'With --route, emit a 3-5 line summary instead of the full diagnostic. Designed for chained scripting and agent pipelines.')
    .action(async (eventName, opts) => {
      if (opts.live && opts.sandbox) {
        console.error('Error: --live and --sandbox are mutually exclusive.');
        process.exit(2);
      }
      const token = resolveToken(opts);
      const data = {};
      if (opts.email) data.email = opts.email;
      if (opts.advocate_code) data.advocate_code = opts.advocate_code;
      if (opts.amount) data.amount = opts.amount;
      for (const kv of opts.param) {
        const idx = kv.indexOf('=');
        if (idx < 0) { console.error(`Invalid param (expected key=value): ${kv}`); process.exit(2); }
        data[kv.slice(0, idx)] = kv.slice(idx + 1);
      }

      if (opts.sandbox) data.sandbox = typeof opts.sandbox === 'string' ? opts.sandbox : 'production-test';

      const payload = { event_name: eventName, data };
      if (opts.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      if (!opts.live && !opts.sandbox) {
        console.error('Error: --live or --sandbox is required to fire events.');
        console.error('Use --dry-run to preview the payload, --live to fire for real, or --sandbox to fire in sandbox mode.');
        process.exit(2);
      }

      const fireTime = new Date().toISOString();
      const res = await apiFetch('/v5/events', token, {
        method: 'POST',
        body: JSON.stringify(payload),
        verbose: opts.verbose,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`Error ${res.status}: ${text.slice(0, 300)}`);
        process.exit(1);
      }

      if (opts.json) {
        printJsonText(text, opts);
      } else {
        console.error(`OK  ${res.status}  fired ${eventName}`);
      }

      let firedEventId = null;
      try { firedEventId = JSON.parse(text)?.id || null; } catch { /* ignore */ }

      if (opts.route) {
        if (opts.watch) {
          console.error('Error: --route and --watch are mutually exclusive.');
          process.exit(2);
        }
        if (!opts.email) {
          console.error('Error: --route requires --email.');
          process.exit(2);
        }
        if (!firedEventId) {
          console.error('Error: could not extract event ID from fire response — cannot trace route.');
          process.exit(1);
        }

        const routeTimeout = parseInt(opts.routeTimeout, 10);
        if (isNaN(routeTimeout) || routeTimeout <= 0) {
          console.error('--route-timeout must be a positive integer');
          process.exit(2);
        }

        // Summary mode: suppress verbose diagnostic output, collect a structured
        // summary as the diagnostic runs, emit it at the end. Console suppression
        // is restored before the summary print so summary lines are visible.
        const summary = {
          path: null,                  // 'no_person' | 'no_steps' | 'no_match' | 'matched'
          subscribers: null,
          findings: [],
          requiredJourneys: null,
          personJourneys: null,
          byCampaign: null,
          webhookProbes: [],           // [{webhook_id, name, dispatched, status, total}]
        };
        const _origLog = console.log;
        const _origErr = console.error;
        if (opts.summary) {
          console.log = () => {};
          console.error = () => {};
        }

        const match = await findPerson(opts.email, token, opts.verbose);
        if (match) {
          console.error(`\nTracing route for event ${firedEventId} (waiting up to ${routeTimeout}s for steps)...`);
        } else {
          console.error(`\nThe fire succeeded (HTTP 200), but person lookup didn't return a record for ${opts.email}.`);
          console.error(`  → most likely: identity-key index hasn't propagated yet (race after fire — common right after first contact)`);
          console.error(`  → less likely: the email is genuinely new and not yet indexed, or has lookup ambiguity`);
          console.error(`  → person-level diagnostics (step trace, journey check) are skipped; running campaign-wiring diagnostics only`);
        }

        const deadline = Date.now() + routeTimeout * 1000;
        const stepsById = new Map();
        let stableCount = 0;
        while (match && Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS);
          let steps = [];
          try {
            steps = await getPersonSteps(match.id, token, 200, opts.verbose);
          } catch (e) {
            console.error(`poll error: ${e.message}`);
            continue;
          }
          const sizeBefore = stepsById.size;
          for (const s of (steps || [])) {
            if (s.cause_event_id === firedEventId || s.root_event_id === firedEventId) {
              stepsById.set(s.id, s);
            }
          }
          if (stepsById.size === sizeBefore && stepsById.size > 0) {
            stableCount++;
            if (stableCount >= 2) break;
          } else {
            stableCount = 0;
          }
        }

        const allSteps = [...stepsById.values()];
        const campaignSteps = allSteps.filter(s => s.campaign_id);
        const orphanSteps  = allSteps.filter(s => !s.campaign_id);

        // Cache campaigns/built — used by subscriber discovery, audience checks, and webhook auto-discovery
        let _builtCache = undefined;
        const getBuilt = async () => {
          if (_builtCache !== undefined) return _builtCache;
          try {
            const data = await apiJson('/v2/campaigns/built', token, { verbose: opts.verbose, baseUrl: API_BASE });
            _builtCache = Array.isArray(data) ? data : [];
          } catch (e) {
            console.log(`  → could not load campaigns/built: ${e.message}`);
            _builtCache = null;
          }
          return _builtCache;
        };

        const findSubscribers = async () => {
          const built = await getBuilt();
          if (!built) return null;
          const subs = [];
          for (const c of built) {
            // Collect journey_names from the specific steps that subscribe to our event
            const matchingJourneys = new Set();
            let matched = false;
            for (const step of (c.steps || [])) {
              const stepMatches = (step.triggers || []).some(trig => (trig.event_names || []).includes(eventName));
              if (stepMatches) {
                matched = true;
                for (const j of (step.journey_names || [])) matchingJourneys.add(j);
              }
            }
            if (matched) subs.push({
              id: c.campaign_id,
              name: c.name,
              state: c.state,
              program_label: c.program_label || null,
              journey_names: [...matchingJourneys],
            });
          }
          return subs;
        };

        const getPersonJourneys = async (personId) => {
          try {
            const data = await apiJson(
              `/v5/persons/${personId}/journeys`,
              token,
              { verbose: opts.verbose, baseUrl: API_BASE }
            );
            return Array.isArray(data) ? data : [];
          } catch (e) {
            return null;
          }
        };

        // Friend-side journey names that imply referral flow (share→click required to enroll)
        const FRIEND_JOURNEY_PATTERN = /^(friend|participant)$/i;

        const reportJourneyMismatch = async (subscribers) => {
          if (!subscribers || subscribers.length === 0) return null;
          if (!match) return null;
          const live = subscribers.filter(s => s.state === 'LIVE');
          if (live.length === 0) return null;
          const requiredJourneys = new Set();
          for (const s of live) for (const j of (s.journey_names || [])) requiredJourneys.add(j);
          if (requiredJourneys.size === 0) return null;

          const personJourneys = await getPersonJourneys(match.id);
          if (personJourneys === null) {
            console.log(`  → could not fetch person's journey memberships.`);
            return null;
          }

          summary.personJourneys = personJourneys;
          summary.requiredJourneys = [...requiredJourneys];

          const personJourneyNames = new Set(personJourneys.map(j => j.name));
          const overlap = [...requiredJourneys].filter(j => personJourneyNames.has(j));

          let foundJourneyBlocker = false;

          console.log('');
          if (personJourneys.length === 0) {
            console.log(`  → cause: person has no journey memberships, but LIVE campaigns using this event require {${[...requiredJourneys].join(', ')}}.`);
            foundJourneyBlocker = true;
          } else {
            const personDescription = personJourneys
              .map(j => `${j.name}${j.program ? `@${j.program}` : ''}`)
              .join(', ');
            console.log(`  → person is in: ${personDescription}`);
            console.log(`  → LIVE campaigns using this event require journey ∈ {${[...requiredJourneys].join(', ')}}`);
            if (overlap.length === 0) {
              console.log(`  → cause: no overlap. Person isn't enrolled in any journey that the campaigns using this event target.`);
              foundJourneyBlocker = true;
            } else {
              console.log(`  → overlap: {${overlap.join(', ')}} — journey is satisfied; the miss is from another targeting filter.`);
            }
          }

          // Friend-side journey hint: if any required journey is friend-side AND person isn't in it,
          // note the typical enrollment path without claiming it's the only one.
          const friendRequired = [...requiredJourneys].filter(j => FRIEND_JOURNEY_PATTERN.test(j));
          const personInFriendJourney = [...personJourneyNames].some(j => FRIEND_JOURNEY_PATTERN.test(j));
          if (friendRequired.length > 0 && !personInFriendJourney) {
            console.log('');
            console.log(`  → friend-side journey required: ${friendRequired.join(', ')}. Person must be enrolled in one of these for the event to qualify them.`);
            console.log(`     typical enrollment path: advocate share → friend visits link → friend journey created.`);
            console.log(`     other paths exist (direct API enrollment, custom journey assignment, integration-driven membership).`);
            console.log(`     to test: simulate the share→click flow, or fire as an email already enrolled in one of these journeys.`);
          }

          return foundJourneyBlocker ? 'journey' : null;
        };

        // Cache webhook id → name lookup; one bulk fetch
        let _webhookNameCache = undefined;
        const getWebhookName = async (webhookId) => {
          if (_webhookNameCache === undefined) {
            try {
              const data = await apiJson(
                '/v6/webhooks/built?limit=200',
                token,
                { verbose: opts.verbose, baseUrl: API_BASE }
              );
              const list = Array.isArray(data) ? data : (data?.webhooks || data?.results || []);
              _webhookNameCache = new Map(list.map(w => [w.id || w.webhook_id, w.name]));
            } catch {
              _webhookNameCache = new Map();
            }
          }
          return _webhookNameCache.get(webhookId) || null;
        };

        // Walk a campaign's actions to find WEBHOOK actions; returns [{webhook_id, action_id, enabled, event_names}]
        const getCampaignWebhooks = (built, campaignId) => {
          if (!built) return [];
          const c = built.find(c => c.campaign_id === campaignId);
          if (!c) return [];
          const webhooks = [];
          for (const step of (c.steps || [])) {
            const eventNames = new Set();
            for (const trig of (step.triggers || [])) {
              for (const n of (trig.event_names || [])) eventNames.add(n);
            }
            for (const action of (step.actions || [])) {
              if (action.action_type === 'WEBHOOK' && action.webhook_id) {
                webhooks.push({
                  webhook_id: action.webhook_id,
                  action_id: action.action_id,
                  enabled: action.enabled,
                  event_names: [...eventNames],
                });
              }
            }
          }
          return webhooks;
        };

        // Fetch a webhook's recent dispatches and filter by our event ID
        const checkWebhookForEvent = async (webhookId) => {
          try {
            const data = await apiJson(
              `/v6/webhooks/${webhookId}/dispatch-results/recent?limit=50`,
              token,
              { verbose: opts.verbose, baseUrl: API_BASE }
            );
            const list = Array.isArray(data) ? data : (data?.results || []);
            return {
              total: list.length,
              matching: list.filter(d => d.cause_event_id === firedEventId || d.root_event_id === firedEventId),
            };
          } catch (e) {
            return { error: e.message };
          }
        };

        const renderWebhookResult = async (webhook, result, indent = '    ', { inMatchedCampaign = false } = {}) => {
          const name = await getWebhookName(webhook.webhook_id);
          const triggerMatches = (webhook.event_names || []).includes(eventName);
          const triggerMarker = !triggerMatches && webhook.event_names && webhook.event_names.length > 0
            ? `  (trigger: ${webhook.event_names.join(', ')} — does not match ${eventName})`
            : '';
          const label = name ? `${webhook.webhook_id}  ${name}` : webhook.webhook_id;

          // Stash summary state regardless of render mode
          if (result.error) {
            summary.webhookProbes.push({ webhook_id: webhook.webhook_id, name, error: result.error });
          } else if (result.matching.length === 0) {
            summary.webhookProbes.push({
              webhook_id: webhook.webhook_id,
              name,
              dispatched: false,
              total: result.total,
              triggerMatches,
            });
          } else {
            for (const d of result.matching) {
              summary.webhookProbes.push({
                webhook_id: webhook.webhook_id,
                name,
                dispatched: true,
                status: d.response_status_code,
                attempts: d.attempt_count,
              });
            }
          }

          if (result.error) {
            console.log(`${indent}${label}${triggerMarker}  → could not fetch dispatches (${result.error})`);
            return;
          }
          if (result.matching.length === 0) {
            console.log(`${indent}${label}${triggerMarker}  → 0 dispatches caused by this event  (${result.total} recent dispatch${result.total === 1 ? '' : 'es'} on this webhook)`);
            // If the trigger DID match and we're in a matched campaign, the controller fired but
            // the webhook didn't dispatch — most likely cause is the request script returning null.
            if (triggerMatches && inMatchedCampaign) {
              console.log(`${indent}  → controller fired but no dispatch recorded — request script may have returned null to filter; check script behavior for this event.`);
            }
            return;
          }
          for (const d of result.matching) {
            const status = d.response_status_code || 'no-response';
            const attempts = d.attempt_count != null ? `  attempts=${d.attempt_count}` : '';
            const url = d.url ? `  ${d.url}` : '';
            console.log(`${indent}${label}${triggerMarker}  ✓ status=${status}${attempts}${url}`);
          }
        };

        const compareEventVsSubscribers = (sample, subscribers) => {
          if (!sample || !subscribers || subscribers.length === 0) return null;
          const live = subscribers.filter(s => s.state === 'LIVE');
          if (live.length === 0) return null;

          let foundProgramBlocker = false;

          console.log('');
          const containerLabel = sample.container === 'test' ? 'test (sandbox)'
            : sample.container === 'production' ? 'production (live)'
            : (sample.container || '?');
          console.log(`  → event landed: container=${containerLabel}  program=${sample.program || 'none'}  journey=${sample.journey_name || 'none'}`);

          if (!sample.program) {
            const labels = [...new Set(live.map(s => s.program_label).filter(Boolean))];
            if (labels.length > 0) {
              console.log(`  → likely cause: the event landed unattributed to any program, but LIVE campaigns using this event are program-scoped: {${labels.join(', ')}}. Program-scoped campaigns only process events tagged with their program_label.`);
              console.log(`  → program assignment usually comes from a label injector, the person's journey membership, or a matching site_pattern — not the event payload alone. Verify the integration's pre-event data setup.`);
              foundProgramBlocker = true;
            }
          }

          if (!sample.journey_name) {
            console.log(`  → also: event has no journey assignment. Campaigns scoped to a specific journey (ADVOCATE / FRIEND) require the person to be enrolled in that journey first.`);
          }

          if (sample.container === 'test' && opts.sandbox) {
            console.log(`  → also: --sandbox routed to container=test. By default campaigns accept both containers, but if a LIVE campaign has been restricted to container=production it won't see this event. Check campaign config if other diagnostics don't explain the miss.`);
          }

          return foundProgramBlocker ? 'program' : null;
        };

        const formatSubscriberLine = (s) => {
          const parts = [];
          if (s.program_label) parts.push(`program=${s.program_label}`);
          if (s.journey_names && s.journey_names.length > 0) {
            parts.push(`journey=${s.journey_names.join('|')}`);
          }
          const constraints = parts.length ? `  ${parts.join('  ')}` : '';
          return `      ${s.id}  ${s.name}${constraints}`;
        };

        const reportSubscribers = (subscribers) => {
          if (subscribers === null) return;
          if (subscribers.length === 0) {
            console.log(`  → cause: no campaign uses event "${eventName}". The event has no controllers wired to it.`);
            console.log(`  → fix: attach a webhook to a campaign with --event ${eventName}, or check that an existing controller's event_names actually includes this name.`);
          } else {
            const live = subscribers.filter(s => s.state === 'LIVE');
            const others = subscribers.filter(s => s.state !== 'LIVE');
            console.log(`  → ${subscribers.length} campaign(s) DO use "${eventName}" but none triggered for this person.`);
            if (live.length) {
              console.log(`  → LIVE campaigns using this event (${live.length}):`);
              for (const s of live.slice(0, 8)) console.log(formatSubscriberLine(s));
            }
            if (others.length) {
              console.log(`  → Non-LIVE campaigns using this event (${others.length}): may not process events depending on state.`);
              for (const s of others.slice(0, 4)) console.log(`${formatSubscriberLine(s)}  [${s.state}]`);
            }
          }
        };

        if (!match) {
          summary.path = 'no_person';
          console.log(`\n[Subscriber wiring check — person diagnostics skipped due to lookup miss]`);
          const subscribers = await findSubscribers();
          summary.subscribers = subscribers;
          if (subscribers === null) {
            console.log(`  → could not load campaigns/built; can't check which campaigns use this event either.`);
          } else if (subscribers.length === 0) {
            reportSubscribers(subscribers);
          } else {
            const live = subscribers.filter(s => s.state === 'LIVE');
            const others = subscribers.filter(s => s.state !== 'LIVE');
            console.log(`  → ${subscribers.length} campaign(s) use "${eventName}":`);
            if (live.length) {
              console.log(`  → LIVE campaigns using this event (${live.length}):`);
              for (const s of live.slice(0, 8)) console.log(formatSubscriberLine(s));
            }
            if (others.length) {
              console.log(`  → Non-LIVE campaigns using this event (${others.length}):`);
              for (const s of others.slice(0, 4)) console.log(`${formatSubscriberLine(s)}  [${s.state}]`);
            }
            console.log('');
            console.log(`  → wiring is in place; person-level qualification can't be checked from here.`);
            console.log(`  → re-run --route once the person record is queryable (a few seconds after the fire) for full diagnostics.`);
          }
        } else if (allSteps.length === 0) {
          summary.path = 'no_steps';
          console.log(`\nNo steps caused by event ${firedEventId} after ${routeTimeout}s.`);
          const subscribers = await findSubscribers();
          summary.subscribers = subscribers;
          if (subscribers !== null && subscribers.length === 0) {
            reportSubscribers(subscribers);
          } else {
            console.log('  → event may have been rejected, processing may be incomplete, or the API call did not produce step records.');
            console.log('  → try increasing --route-timeout, or fire with --verbose to see the API response.');
            if (subscribers !== null && subscribers.length > 0) {
              console.log(`  → ${subscribers.length} campaign(s) use "${eventName}" but no steps were generated — unusual; try --route-timeout 30.`);
            }
          }
        } else if (campaignSteps.length === 0) {
          summary.path = 'no_match';
          console.log(`\nNo campaigns matched.`);
          console.log(`  → event was accepted (${orphanSteps.length} processing step(s) recorded), but no campaign was triggered.`);
          const subscribers = await findSubscribers();
          summary.subscribers = subscribers;
          reportSubscribers(subscribers);
          const findings = [];
          const programFinding = compareEventVsSubscribers(orphanSteps[0], subscribers);
          if (programFinding) findings.push(programFinding);
          const journeyFinding = await reportJourneyMismatch(subscribers);
          if (journeyFinding) findings.push(journeyFinding);
          summary.findings = findings;
          if (findings.length >= 2) {
            console.log('');
            console.log(`  → multiple constraints unmet — ${findings.join(' AND ')} would each block independently.`);
          }

          // Even though no campaign matched, probe subscribing campaigns' webhooks — if any DID dispatch
          // despite no step record, that's a surprising signal worth surfacing.
          if (!opts.routeWebhook && subscribers && subscribers.length > 0) {
            const built = await getBuilt();
            const checked = new Set();
            const probes = [];
            for (const sub of subscribers) {
              for (const wh of getCampaignWebhooks(built, sub.id)) {
                if (checked.has(wh.webhook_id)) continue;
                checked.add(wh.webhook_id);
                probes.push({ webhook: wh, campaign: sub });
              }
            }
            if (probes.length > 0) {
              console.log('');
              console.log(`  Probing ${probes.length} webhook(s) attached to campaigns using this event:`);
              for (const { webhook, campaign } of probes) {
                const result = await checkWebhookForEvent(webhook.webhook_id);
                if (result.matching && result.matching.length > 0) {
                  console.log(`    ⚠ webhook ${webhook.webhook_id} (campaign ${campaign.name}) DID dispatch for this event despite no step record:`);
                  await renderWebhookResult(webhook, result, '      ');
                } else {
                  await renderWebhookResult(webhook, result, '    ');
                }
              }
            }
          }
        } else {
          summary.path = 'matched';
          const byCampaign = new Map();
          for (const s of campaignSteps) {
            if (!byCampaign.has(s.campaign_id)) byCampaign.set(s.campaign_id, []);
            byCampaign.get(s.campaign_id).push(s);
          }
          summary.byCampaign = byCampaign;

          console.log(`\nReached ${byCampaign.size} campaign(s):\n`);
          for (const [campaignId, steps] of byCampaign) {
            const program = steps[0].program || '';
            console.log(`  Campaign ${campaignId}${program ? `  (${program})` : ''}`);
            const sorted = steps.slice().sort((a, b) =>
              new Date(a.event_date || a.created_date) - new Date(b.event_date || b.created_date)
            );
            for (const s of sorted) {
              const time = formatEventTime(s.event_date || s.created_date);
              console.log(`    ${time}  ${s.name || ''}`);
            }

            // Auto-discover webhooks for this campaign and report dispatch outcomes
            if (!opts.routeWebhook) {
              const built = await getBuilt();
              const webhooks = getCampaignWebhooks(built, campaignId);
              if (webhooks.length > 0) {
                console.log(`    Webhooks (${webhooks.length}):`);
                for (const wh of webhooks) {
                  const result = await checkWebhookForEvent(wh.webhook_id);
                  await renderWebhookResult(wh, result, '      ', { inMatchedCampaign: true });
                }
              }
            }
            console.log('');
          }

          if (orphanSteps.length > 0) {
            console.log(`  (plus ${orphanSteps.length} pre-campaign processing step(s))\n`);
          }
        }

        if (opts.routeWebhook) {
          console.log(`Checking webhook ${opts.routeWebhook} for dispatches...`);
          let dispatches = [];
          try {
            dispatches = await apiJson(
              `/v6/webhooks/${opts.routeWebhook}/dispatch-results/recent?limit=50`,
              token,
              { verbose: opts.verbose, baseUrl: API_BASE }
            );
          } catch (e) {
            console.log(`  → could not fetch dispatches: ${e.message}`);
          }
          const list = Array.isArray(dispatches) ? dispatches : (dispatches?.results || []);
          const matching = list.filter(d => d.cause_event_id === firedEventId);
          if (matching.length === 0) {
            console.log(`  → no dispatches found for cause_event_id=${firedEventId}`);
            console.log(`    (webhook had ${list.length} recent dispatches, none caused by this event)`);
          } else {
            for (const d of matching) {
              const status = d.response_status_code || 'no-response';
              const attempts = d.attempt_count != null ? `  attempts=${d.attempt_count}` : '';
              const url = d.url ? `  ${d.url}` : '';
              console.log(`  ✓ status=${status}${attempts}${url}`);
            }
          }
        }

        // Restore console and emit summary if --summary
        if (opts.summary) {
          console.log = _origLog;
          console.error = _origErr;

          const lines = [];
          const fmtSet = (xs) => `{${[...new Set(xs)].join(', ')}}`;

          if (summary.path === 'no_person') {
            lines.push(`outcome: fire ok; person lookup pending for ${opts.email}`);
            const subs = summary.subscribers;
            if (subs && subs.length > 0) {
              const live = subs.filter(s => s.state === 'LIVE').length;
              const other = subs.length - live;
              lines.push(`campaigns using "${eventName}": ${subs.length} (${live} LIVE${other ? `, ${other} other` : ''})`);
            } else if (subs && subs.length === 0) {
              lines.push(`campaigns using "${eventName}": 0`);
            } else {
              lines.push(`campaigns using "${eventName}": could not check`);
            }
            lines.push(`next: re-run --route in a few seconds for full person-level diagnostics`);
          } else if (summary.path === 'no_steps') {
            const subs = summary.subscribers;
            if (subs && subs.length === 0) {
              lines.push(`outcome: event "${eventName}" not wired to any campaign`);
              lines.push(`next: attach a webhook with --event ${eventName}`);
            } else {
              lines.push(`outcome: no steps after ${routeTimeout}s — event may have been rejected or processing incomplete`);
              lines.push(`next: try --route-timeout 30, or fire with --verbose`);
            }
          } else if (summary.path === 'no_match') {
            lines.push(`outcome: no campaign matched for ${opts.email}`);
            const subs = summary.subscribers || [];
            const live = subs.filter(s => s.state === 'LIVE');
            const liveLabels = fmtSet(live.map(s => s.program_label).filter(Boolean));
            const liveJourneys = summary.requiredJourneys ? fmtSet(summary.requiredJourneys) : null;
            if (summary.findings && summary.findings.length > 0) {
              lines.push(`causes: ${summary.findings.join(' AND ')}${summary.findings.length >= 2 ? ' would each block independently' : ''}`);
            }
            if (summary.findings.includes('program') && liveLabels !== '{}') {
              lines.push(`program: event unattributed; LIVE campaigns using this event require ${liveLabels}`);
            }
            if (summary.findings.includes('journey')) {
              const personDesc = summary.personJourneys && summary.personJourneys.length > 0
                ? fmtSet(summary.personJourneys.map(j => `${j.name}${j.program ? '@' + j.program : ''}`))
                : '{} (none)';
              lines.push(`journey: person in ${personDesc}; LIVE campaigns using this event require ${liveJourneys || '{?}'}`);
            }
          } else if (summary.path === 'matched') {
            const campaignNames = [...summary.byCampaign.values()].map(steps => steps[0].program || steps[0].campaign_id);
            lines.push(`outcome: reached ${summary.byCampaign.size} campaign(s): ${[...new Set(campaignNames)].join(', ')}`);
            if (summary.webhookProbes.length > 0) {
              const dispatched = summary.webhookProbes.filter(p => p.dispatched);
              if (dispatched.length > 0) {
                const detail = dispatched.map(p => `${p.name || p.webhook_id} ${p.status || '?'}`).join(', ');
                lines.push(`webhooks: ${detail}`);
              } else {
                lines.push(`webhooks: ${summary.webhookProbes.length} probed, 0 dispatched for this event`);
              }
            }
          } else {
            lines.push(`outcome: route diagnostic completed but no path matched`);
          }

          for (const line of lines) console.log(line);
        }

        return;
      }

      if (!opts.watch) return;

      const email = opts.email;
      if (!email) {
        console.error('--watch requires --email to be set');
        process.exit(2);
      }

      const watchTimeout = parseInt(opts.watchTimeout, 10);
      if (isNaN(watchTimeout) || watchTimeout <= 0) {
        console.error('--watch-timeout must be a positive integer');
        process.exit(2);
      }

      const match = await findPerson(email, token, opts.verbose);
      if (!match) {
        console.error(`No person found for ${email} — cannot watch`);
        process.exit(1);
      }

      const deadline = Date.now() + watchTimeout * 1000;
      const seen = new Set();

      console.error(`\nWatching steps for ${email} for ${watchTimeout}s...\n`);

      while (Date.now() < deadline) {
        try {
          const steps = await getPersonSteps(match.id, token, 25, opts.verbose);
          const newSteps = steps.filter(s => {
            if (seen.has(s.id)) return false;
            const stepTime = new Date(s.event_date || s.created_date).getTime();
            return stepTime >= new Date(fireTime).getTime();
          });
          for (const step of newSteps.reverse()) {
            seen.add(step.id);
            if (opts.json) {
              printJson(step, opts);
            } else {
              const time = formatEventTime(step.event_date || step.created_date);
              const name = (step.name || '').padEnd(35);
              const program = step.program || '';
              console.log(`${time}  ${name}  ${program}`);
            }
          }
        } catch (e) {
          console.error(`poll error: ${e.message}`);
        }
        await sleep(POLL_INTERVAL_MS);
      }

      console.error(`\nDone watching (${watchTimeout}s).`);
    });

  addGlobalOptions(fireCmd, {
    output: true,
    examples: [
      'extole events fire lead_created --email jane@example.com --dry-run',
      'extole events fire lead_created --email jane@example.com --live',
      'extole events fire lead_created --email jane@example.com --sandbox',
      'extole events fire conversion -p amount=500 --live',
      'extole events fire lead_created --email jane@example.com --live --watch',
      'extole events fire lead_created --email jane@example.com --live --route',
      'extole events fire signed_up --email jane@example.com --live --route --route-webhook <id>',
    ],
  });

  events.addCommand(fireCmd);
  return events;
}
