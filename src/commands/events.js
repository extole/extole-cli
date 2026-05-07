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

        const match = await findPerson(opts.email, token, opts.verbose);
        if (!match) {
          console.error(`No person found for ${opts.email} — cannot trace route`);
          process.exit(1);
        }

        console.error(`\nTracing route for event ${firedEventId} (waiting up to ${routeTimeout}s for steps)...`);

        const deadline = Date.now() + routeTimeout * 1000;
        const stepsById = new Map();
        let stableCount = 0;
        while (Date.now() < deadline) {
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

        const findSubscribers = async () => {
          try {
            const built = await apiJson('/v2/campaigns/built', token, { verbose: opts.verbose, baseUrl: API_BASE });
            const list = Array.isArray(built) ? built : [];
            const subs = [];
            for (const c of list) {
              const matched = (c.steps || []).some(step =>
                (step.triggers || []).some(trig => (trig.event_names || []).includes(eventName))
              );
              if (matched) subs.push({
                id: c.campaign_id,
                name: c.name,
                state: c.state,
                program_label: c.program_label || null,
              });
            }
            return subs;
          } catch (e) {
            console.log(`  → could not check event subscribers: ${e.message}`);
            return null;
          }
        };

        const compareEventVsSubscribers = (sample, subscribers) => {
          if (!sample || !subscribers || subscribers.length === 0) return;
          const live = subscribers.filter(s => s.state === 'LIVE');
          if (live.length === 0) return;

          console.log('');
          console.log(`  → event landed: container=${sample.container || '?'}  program=${sample.program || 'none'}  journey=${sample.journey_name || 'none'}`);

          if (!sample.program) {
            const labels = [...new Set(live.map(s => s.program_label).filter(Boolean))];
            if (labels.length > 0) {
              console.log(`  → likely cause: the event landed unattributed to any program, but LIVE subscribers are program-scoped: {${labels.join(', ')}}. Program-scoped campaigns only process events tagged with their program_label.`);
              console.log(`  → program assignment usually comes from a label injector, the person's journey membership, or a matching site_pattern — not the event payload alone. Verify the integration's pre-event data setup.`);
            }
          }

          if (!sample.journey_name) {
            console.log(`  → also: event has no journey assignment. Campaigns scoped to a specific journey (ADVOCATE / FRIEND) require the person to be enrolled in that journey first.`);
          }

          if (sample.container === 'test' && opts.sandbox) {
            console.log(`  → also: --sandbox routed to container=test. By default campaigns accept both containers, but if a LIVE campaign has been restricted to container=production it won't see this event. Check campaign config if other diagnostics don't explain the miss.`);
          }
        };

        const reportSubscribers = (subscribers) => {
          if (subscribers === null) return;
          if (subscribers.length === 0) {
            console.log(`  → cause: no campaign subscribes to event "${eventName}". The event has no controllers wired to it.`);
            console.log(`  → fix: attach a webhook to a campaign with --event ${eventName}, or check that an existing controller's event_names actually includes this name.`);
          } else {
            const live = subscribers.filter(s => s.state === 'LIVE');
            const others = subscribers.filter(s => s.state !== 'LIVE');
            console.log(`  → ${subscribers.length} campaign(s) DO subscribe to "${eventName}" but none triggered for this person. Likely a targeting filter.`);
            if (live.length) {
              console.log(`  → LIVE subscribers (${live.length}):`);
              for (const s of live.slice(0, 8)) console.log(`      ${s.id}  ${s.name}`);
            }
            if (others.length) {
              console.log(`  → Non-LIVE subscribers (${others.length}): may not process events depending on state.`);
              for (const s of others.slice(0, 4)) console.log(`      ${s.id}  ${s.name}  [${s.state}]`);
            }
            console.log(`  → check: program_label, audience filters, sandbox vs live, journey assignment for the matching campaigns.`);
          }
        };

        if (allSteps.length === 0) {
          console.log(`\nNo steps caused by event ${firedEventId} after ${routeTimeout}s.`);
          const subscribers = await findSubscribers();
          if (subscribers !== null && subscribers.length === 0) {
            reportSubscribers(subscribers);
          } else {
            console.log('  → event may have been rejected, processing may be incomplete, or the API call did not produce step records.');
            console.log('  → try increasing --route-timeout, or fire with --verbose to see the API response.');
            if (subscribers !== null && subscribers.length > 0) {
              console.log(`  → ${subscribers.length} campaign(s) subscribe to "${eventName}" but no steps were generated — unusual; try --route-timeout 30.`);
            }
          }
        } else if (campaignSteps.length === 0) {
          console.log(`\nNo campaigns matched.`);
          console.log(`  → event was accepted (${orphanSteps.length} processing step(s) recorded), but no campaign was triggered.`);
          const subscribers = await findSubscribers();
          reportSubscribers(subscribers);
          compareEventVsSubscribers(orphanSteps[0], subscribers);
        } else {
          const byCampaign = new Map();
          for (const s of campaignSteps) {
            if (!byCampaign.has(s.campaign_id)) byCampaign.set(s.campaign_id, []);
            byCampaign.get(s.campaign_id).push(s);
          }

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
