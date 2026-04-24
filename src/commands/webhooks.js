import { Command } from 'commander';
import { createInterface } from 'readline';
import { resolveToken, PERSON_BASE, BASE_URL } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase() === 'y'); });
  });
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchWebhooks(token, params, verbose) {
  const qs = new URLSearchParams(params);
  const path = `/v6/webhooks/built${qs.toString() ? '?' + qs : ''}`;
  return apiJson(path, token, { verbose, baseUrl: PERSON_BASE });
}

async function fetchWebhook(id, token, built, verbose) {
  const path = `/v6/webhooks/${id}${built ? '/built' : ''}`;
  return apiJson(path, token, { verbose, baseUrl: PERSON_BASE });
}

async function fetchDispatches(id, token, params, verbose) {
  const qs = new URLSearchParams(params);
  const path = `/v6/webhooks/${id}/dispatches/recent${qs.toString() ? '?' + qs : ''}`;
  return apiJson(path, token, { verbose, baseUrl: PERSON_BASE });
}

async function fetchDispatchResults(id, token, params, verbose) {
  const qs = new URLSearchParams(params);
  const path = `/v6/webhooks/${id}/dispatch-results/recent${qs.toString() ? '?' + qs : ''}`;
  return apiJson(path, token, { verbose, baseUrl: PERSON_BASE });
}

// ── webhooks (list) ────────────────────────────────────────────────────────────

export function webhooksCommand() {
  const webhooks = new Command('webhooks')
    .description('List outbound webhooks. Shows id, type, name, and destination URL.')
    .option('--enabled <bool>', 'Filter by enabled status (true|false)')
    .option('--type <type>', 'Filter by webhook type: GENERIC (event-triggered), CLIENT (share/referral), REWARD (fulfillment)')
    .option('--filter <substr>', 'Filter by name substring (case-insensitive)')
    .option('--limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Offset for pagination', '0')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const params = { limit: opts.limit, offset: opts.offset, include_archived: 'false' };
      if (opts.enabled !== undefined) params.enabled = opts.enabled;
      if (opts.type) params.type = opts.type;
      if (opts.filter) params.name = opts.filter;

      const data = await fetchWebhooks(token, params, opts.verbose);
      const list = Array.isArray(data) ? data : (data.webhooks || data.results || []);

      if (opts.json) { printJson(list, opts); return; }
      if (list.length === 0) { console.log('No webhooks found.'); return; }

      const idW = 24, typeW = 8, nameW = 30, urlW = 50;
      console.log(`${'id'.padEnd(idW)}  ${'type'.padEnd(typeW)}  ${'name'.padEnd(nameW)}  url`);
      console.log(`${'─'.repeat(idW)}  ${'─'.repeat(typeW)}  ${'─'.repeat(nameW)}  ${'─'.repeat(urlW)}`);
      for (const w of list) {
        const id = (w.webhook_id || w.id || '').padEnd(idW);
        const type = (w.type || '').padEnd(typeW);
        const name = (w.name || '').padEnd(nameW);
        const url = w.url || '';
        const urlTrunc = url.length > urlW ? url.slice(0, urlW - 1) + '…' : url;
        console.log(`${id}  ${type}  ${name}  ${urlTrunc}`);
      }
    });

  addGlobalOptions(webhooks, {
    output: true,
    examples: [
      'extole webhooks',
      'extole webhooks --enabled true',
      'extole webhooks --type GENERIC',
      'extole webhooks --name "sfdc"',
      'extole webhooks --json',
    ],
  });

  // ── get ───────────────────────────────────────────────────────────────────

  const getCmd = new Command('get')
    .description('Show full configuration for a webhook, including URL, method, tags, and retry intervals.')
    .argument('<webhook-id>', 'Webhook ID')
    .option('--built', 'Show resolved representation with inherited defaults applied')
    .action(async (webhookId, opts) => {
      const token = resolveToken(opts);
      const w = await fetchWebhook(webhookId, token, opts.built, opts.verbose);
      if (opts.json) { printJson(w, opts); return; }

      console.log(`id:       ${w.webhook_id || w.id}`);
      console.log(`name:     ${w.name || ''}`);
      console.log(`type:     ${w.type || ''}`);
      console.log(`enabled:  ${w.enabled}`);
      console.log(`url:      ${w.url || ''}`);
      if (w.description) console.log(`desc:     ${w.description}`);
      if (w.default_method || w.defaultMethod) console.log(`method:   ${w.default_method || w.defaultMethod}`);
      const tags = w.tags?.filter(t => !t.startsWith('internal:'));
      const internalTags = w.tags?.filter(t => t.startsWith('internal:'));
      if (tags?.length) console.log(`tags:     ${tags.join(', ')}`);
      if (internalTags?.length) console.log(`internal: ${internalTags.join(', ')}`);
      if (w.retry_intervals || w.retryIntervals) {
        console.log(`retries:  ${(w.retry_intervals || w.retryIntervals).join(', ')}`);
      }
      if (w.component_ids?.length) console.log(`components: ${w.component_ids.join(', ')}`);
      if (w.request) {
        console.log(`request:`);
        console.log(w.request.split('\n').map(l => `  ${l}`).join('\n'));
      }
    });

  addGlobalOptions(getCmd, {
    output: true,
    examples: [
      'extole webhooks get <webhook-id>',
      'extole webhooks get <webhook-id> --built',
      'extole webhooks get <webhook-id> --json',
    ],
  });

  // ── create ────────────────────────────────────────────────────────────────

  const createCmd = new Command('create')
    .description('Create a new webhook')
    .option('--name <name>', 'Webhook name')
    .option('--url <url>', 'Destination URL')
    .option('--type <type>', 'Webhook type (GENERIC, CLIENT, REWARD)', 'GENERIC')
    .option('--enabled <bool>', 'Enable immediately (default: true)', 'true')
    .option('--description <text>', 'Optional description')
    .option('--method <method>', 'HTTP method (POST, PUT)', 'POST')
    .option('--tag <tag>', 'Tag (repeatable)', (val, acc) => [...acc, val], [])
    .action(async (opts) => {
      if (!opts.name) { console.error('error: --name is required'); process.exit(2); }
      if (!opts.url)  { console.error('error: --url is required');  process.exit(2); }
      const token = resolveToken(opts);
      const payload = {
        name: opts.name,
        url: opts.url,
        type: opts.type,
        enabled: opts.enabled !== 'false',
        default_method: opts.method,
      };
      if (opts.description) payload.description = opts.description;
      if (opts.tag?.length) payload.tags = opts.tag;

      const res = await apiFetch('/v6/webhooks', token, {
        method: 'POST',
        body: JSON.stringify(payload),
        verbose: opts.verbose,
        baseUrl: PERSON_BASE,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`Error ${res.status}: ${text.slice(0, 300)}`);
        process.exit(1);
      }
      const w = JSON.parse(text);
      if (opts.json) { printJson(w, opts); return; }
      console.log(`created: ${w.webhook_id || w.id}`);
      console.log(`name:    ${w.name}`);
      console.log(`url:     ${w.url}`);
      console.log(`type:    ${w.type}`);
      console.log(`enabled: ${w.enabled}`);
    });

  addGlobalOptions(createCmd, {
    output: true,
    examples: [
      'extole webhooks create --name "SFDC Events" --url https://example.com/hook',
      'extole webhooks create --name "Reward Hook" --url https://example.com/hook --type REWARD',
      'extole webhooks create --name "Test" --url https://example.com/hook --json',
    ],
  });

  // ── delete ────────────────────────────────────────────────────────────────

  const deleteCmd = new Command('delete')
    .description('Archive a webhook. Fails if the webhook is still wired to campaign controller actions — detach it first.')
    .argument('<webhook-id>', 'Webhook ID')
    .action(async (webhookId, opts) => {
      const token = resolveToken(opts);
      const res = await apiFetch(`/v6/webhooks/${webhookId}`, token, {
        method: 'DELETE',
        verbose: opts.verbose,
        baseUrl: PERSON_BASE,
      });
      if (!res.ok) {
        const text = await res.text();
        let detail = text.slice(0, 300);
        try {
          const err = JSON.parse(text);
          const actions = err.webhook_controller_actions;
          if (actions?.length) {
            const campaignIds = [...new Set(actions.map(a => a.campaign_id).filter(Boolean))];
            detail = `webhook is still wired to campaign(s): ${campaignIds.join(', ')}. Delete the controller actions first.`;
          }
        } catch (_) { /* use raw text */ }
        console.error(`Error ${res.status}: ${detail}`);
        process.exit(1);
      }
      if (opts.json) { printJson({ deleted: webhookId }, opts); return; }
      console.log(`deleted: ${webhookId}`);
    });

  addGlobalOptions(deleteCmd, {
    output: true,
    examples: [
      'extole webhooks delete <webhook-id>',
    ],
  });

  // ── attach ────────────────────────────────────────────────────────────────

  const attachCmd = new Command('attach')
    .description('Wire a webhook to a campaign so that matching events trigger an outbound HTTP dispatch. Creates a campaign controller with an event trigger and webhook action, then publishes the campaign.')
    .requiredOption('--webhook <id>', 'Webhook ID to attach')
    .requiredOption('--campaign <id>', 'Campaign ID to wire the webhook into')
    .requiredOption('--event <name>', 'Event name that triggers dispatch (e.g. signed_up, lead_created)')
    .option('--event-type <type>', 'INPUT (business event fired by an integration) or STEP (internal Extole processing step). Default: INPUT', 'INPUT')
    .option('--controller <id>', 'Use an existing controller ID instead of creating a new one')
    .option('--quality <q>', 'Dispatch priority: HIGH (normal), LOW (best-effort), ALWAYS (bypasses targeting rules). Default: HIGH', 'HIGH')
    .option('--skip-publish', 'Skip publishing the campaign after wiring. Use when attaching multiple events — pass --skip-publish on all but the last call to publish once at the end.')
    .action(async (opts) => {
      const token = resolveToken(opts);

      let controllerId = opts.controller;

      if (!controllerId) {
        const res = await apiFetch(`/api/v2/campaigns/${opts.campaign}/controllers`, token, {
          method: 'POST',
          body: JSON.stringify({
            type: 'CONTROLLER',
            name: `${opts.event}-webhook`,
            enabled: true,
            enabled_on_states: ['LIVE'],
            selectors: ['TARGET'],
            scope: 'PUBLIC',
          }),
          verbose: opts.verbose,
          baseUrl: BASE_URL,
        });
        const text = await res.text();
        if (!res.ok) { console.error(`Error creating controller ${res.status}: ${text.slice(0, 300)}`); process.exit(1); }
        const ctrl = JSON.parse(text);
        controllerId = ctrl.id;
        if (!opts.json) console.log(`created controller: ${controllerId}`);
      } else {
        if (!opts.json) console.log(`using controller:   ${controllerId}`);
      }

      const trigRes = await apiFetch(
        `/api/v2/campaigns/${opts.campaign}/controllers/${controllerId}/triggers/events`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            event_names: [opts.event],
            event_type: opts.eventType.toUpperCase(),
            trigger_phase: 'MATCHING',
            trigger_name: `${opts.event}-trigger`,
            enabled: true,
          }),
          verbose: opts.verbose,
          baseUrl: BASE_URL,
        }
      );
      const trigText = await trigRes.text();
      if (!trigRes.ok) { console.error(`Error adding trigger ${trigRes.status}: ${trigText.slice(0, 300)}`); process.exit(1); }
      const trigger = JSON.parse(trigText);
      if (!opts.json) console.log(`added trigger:      ${trigger.trigger_id}  (${opts.event} / ${opts.eventType.toUpperCase()})`);

      const actRes = await apiFetch(
        `/api/v2/campaigns/${opts.campaign}/controllers/${controllerId}/actions/webhooks`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({ webhook_id: opts.webhook, quality: opts.quality.toUpperCase(), enabled: true }),
          verbose: opts.verbose,
          baseUrl: BASE_URL,
        }
      );
      const actText = await actRes.text();
      if (!actRes.ok) { console.error(`Error adding action ${actRes.status}: ${actText.slice(0, 300)}`); process.exit(1); }
      const action = JSON.parse(actText);
      if (!opts.json) console.log(`added action:       ${action.action_id}  (WEBHOOK / ${opts.quality.toUpperCase()})`);

      if (!opts.skipPublish) {
        const pubRes = await apiFetch(`/api/v2/campaigns/${opts.campaign}/live`, token, {
          method: 'POST',
          verbose: opts.verbose,
          baseUrl: BASE_URL,
        });
        const pubText = await pubRes.text();
        if (!pubRes.ok) { console.error(`Error publishing ${pubRes.status}: ${pubText.slice(0, 300)}`); process.exit(1); }
        const campaign = JSON.parse(pubText);
        if (!opts.json) console.log(`published:          campaign ${opts.campaign}  state=${campaign.state}`);
      }

      if (opts.json) {
        printJson({ controller_id: controllerId, trigger_id: trigger.trigger_id, action_id: action.action_id }, opts);
      }
    });

  addGlobalOptions(attachCmd, {
    output: true,
    examples: [
      'extole webhooks attach --webhook <webhook-id> --campaign <campaign-id> --event signed_up',
      'extole webhooks attach --webhook <webhook-id> --campaign <campaign-id> --event conversion --event-type STEP',
      'extole webhooks attach --webhook <webhook-id> --campaign <campaign-id> --event signed_up --controller <existing-id>',
      'extole webhooks attach --webhook <webhook-id> --campaign <campaign-id> --event signed_up --skip-publish',
    ],
  });

  webhooks.addCommand(attachCmd);

  // ── listen ────────────────────────────────────────────────────────────────

  const listenCmd = new Command('listen')
    .description('Temporarily wire a URL to a campaign event and tail incoming dispatches. Creates a webhook + controller, publishes the campaign, polls for dispatch results every 3 seconds, then deletes everything on Ctrl-C. The URL must be publicly reachable — Extole makes outbound HTTP POSTs to it.')
    .requiredOption('--url <url>', 'Publicly reachable URL to receive webhook POSTs')
    .requiredOption('--campaign <id>', 'Campaign ID to wire the webhook into')
    .requiredOption('--event <name>', 'Event name that triggers dispatch (e.g. signed_up)')
    .option('--event-type <type>', 'INPUT (business event) or STEP (internal processing step). Default: INPUT', 'INPUT')
    .option('--quality <q>', 'Dispatch priority: HIGH (normal), LOW (best-effort), ALWAYS (bypasses targeting rules). Default: HIGH', 'HIGH')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (opts) => {
      const token = resolveToken(opts);

      if (!opts.yes) {
        const ok = await confirm(
          `Will:\n` +
          `  create webhook        → ${opts.url}\n` +
          `  attach to campaign    ${opts.campaign}  event="${opts.event}"\n` +
          `  publish campaign\n` +
          `  tail dispatches (Ctrl-C stops and cleans up everything)\n` +
          `Proceed? (y/N) `
        );
        if (!ok) { console.log('Aborted.'); process.exit(0); }
      }

      // Create webhook
      const wRes = await apiFetch('/v6/webhooks', token, {
        method: 'POST',
        body: JSON.stringify({ name: `listen-${opts.event}-${Date.now()}`, url: opts.url, type: 'GENERIC', enabled: true, default_method: 'POST' }),
        verbose: opts.verbose,
        baseUrl: PERSON_BASE,
      });
      const wText = await wRes.text();
      if (!wRes.ok) { console.error(`Error creating webhook ${wRes.status}: ${wText.slice(0, 300)}`); process.exit(1); }
      const webhook = JSON.parse(wText);
      const webhookId = webhook.webhook_id || webhook.id;
      console.log(`created webhook:    ${webhookId}`);

      // Create controller
      const ctrlRes = await apiFetch(`/api/v2/campaigns/${opts.campaign}/controllers`, token, {
        method: 'POST',
        body: JSON.stringify({ type: 'CONTROLLER', name: `listen-${opts.event}-webhook`, enabled: true, enabled_on_states: ['LIVE'], selectors: ['TARGET'], scope: 'PUBLIC' }),
        verbose: opts.verbose,
        baseUrl: BASE_URL,
      });
      const ctrlText = await ctrlRes.text();
      if (!ctrlRes.ok) {
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: PERSON_BASE });
        console.error(`Error creating controller ${ctrlRes.status}: ${ctrlText.slice(0, 300)}`); process.exit(1);
      }
      const ctrl = JSON.parse(ctrlText);
      const controllerId = ctrl.id;
      console.log(`created controller: ${controllerId}`);

      // Add event trigger
      const trigRes = await apiFetch(
        `/api/v2/campaigns/${opts.campaign}/controllers/${controllerId}/triggers/events`, token,
        { method: 'POST', body: JSON.stringify({ event_names: [opts.event], event_type: opts.eventType.toUpperCase(), trigger_phase: 'MATCHING', trigger_name: `${opts.event}-trigger`, enabled: true }), verbose: opts.verbose, baseUrl: BASE_URL }
      );
      const trigText = await trigRes.text();
      if (!trigRes.ok) {
        await apiFetch(`/api/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: BASE_URL });
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: PERSON_BASE });
        console.error(`Error adding trigger ${trigRes.status}: ${trigText.slice(0, 300)}`); process.exit(1);
      }
      const trigger = JSON.parse(trigText);
      console.log(`added trigger:      ${trigger.trigger_id}`);

      // Add webhook action
      const actRes = await apiFetch(
        `/api/v2/campaigns/${opts.campaign}/controllers/${controllerId}/actions/webhooks`, token,
        { method: 'POST', body: JSON.stringify({ webhook_id: webhookId, quality: opts.quality.toUpperCase(), enabled: true }), verbose: opts.verbose, baseUrl: BASE_URL }
      );
      const actText = await actRes.text();
      if (!actRes.ok) {
        await apiFetch(`/api/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: BASE_URL });
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: PERSON_BASE });
        console.error(`Error adding action ${actRes.status}: ${actText.slice(0, 300)}`); process.exit(1);
      }
      const action = JSON.parse(actText);
      console.log(`added action:       ${action.action_id}`);

      // Publish
      const pubRes = await apiFetch(`/api/v2/campaigns/${opts.campaign}/live`, token, { method: 'POST', verbose: opts.verbose, baseUrl: BASE_URL });
      const pubText = await pubRes.text();
      if (!pubRes.ok) {
        await apiFetch(`/api/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: BASE_URL });
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: PERSON_BASE });
        console.error(`Error publishing ${pubRes.status}: ${pubText.slice(0, 300)}`); process.exit(1);
      }
      const campaign = JSON.parse(pubText);
      console.log(`published:          campaign ${opts.campaign}  state=${campaign.state}`);
      console.log(`\nListening for "${opts.event}" dispatches... (Ctrl-C to stop and clean up)\n`);

      // Cleanup on exit
      let cleaningUp = false;
      async function cleanup() {
        if (cleaningUp) return;
        cleaningUp = true;
        console.log('\nCleaning up...');
        await apiFetch(`/api/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: BASE_URL });
        console.log(`deleted controller: ${controllerId}`);
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: PERSON_BASE });
        console.log(`deleted webhook:    ${webhookId}`);
        await apiFetch(`/api/v2/campaigns/${opts.campaign}/live`, token, { method: 'POST', baseUrl: BASE_URL });
        console.log(`republished:        campaign ${opts.campaign}`);
      }

      process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
      process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });

      // Poll dispatches
      const seen = new Set();
      setInterval(async () => {
        try {
          const data = await fetchDispatches(webhookId, token, { limit: '20' }, false);
          const list = Array.isArray(data) ? data : (data.dispatches || data.results || []);
          for (const d of list.reverse()) {
            const id = d.dispatch_id || d.id || '';
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const ts = (d.dispatched_at || d.created_date || '').slice(0, 19).replace('T', ' ');
            const status = (d.status || d.result || '').padEnd(12);
            console.log(`${ts}  ${status}  ${id}`);
          }
        } catch (_) { /* ignore transient poll errors */ }
      }, 3000);
    });

  addGlobalOptions(listenCmd, {
    examples: [
      'extole webhooks listen --url https://my-server.com/hook --campaign <id> --event signed_up',
      'extole webhooks listen --url https://my-server.com/hook --campaign <id> --event conversion --event-type STEP',
      'extole webhooks listen --url https://my-server.com/hook --campaign <id> --event signed_up --yes',
    ],
  });

  webhooks.addCommand(listenCmd);

  // ── dispatches ────────────────────────────────────────────────────────────

  const dispatchesCmd = new Command('dispatches')
    .description('Show recent dispatch attempts for a webhook — what Extole tried to send. One record per attempt. Use dispatch-results to see the HTTP response side.')
    .argument('<webhook-id>', 'Webhook ID')
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Offset', '0')
    .action(async (webhookId, opts) => {
      const token = resolveToken(opts);
      const data = await fetchDispatches(webhookId, token, { limit: opts.limit, offset: opts.offset }, opts.verbose);
      const list = Array.isArray(data) ? data : (data.dispatches || data.results || []);

      if (opts.json) { printJson(list, opts); return; }
      if (list.length === 0) { console.log('No dispatches found.'); return; }

      for (const d of list) {
        const ts = d.dispatched_at || d.created_date || '';
        const status = d.status || d.result || '';
        const id = d.dispatch_id || d.id || '';
        console.log(`${ts}  ${status.padEnd(12)}  ${id}`);
      }
    });

  addGlobalOptions(dispatchesCmd, {
    output: true,
    examples: [
      'extole webhooks dispatches <webhook-id>',
      'extole webhooks dispatches <webhook-id> --limit 50',
      'extole webhooks dispatches <webhook-id> --json',
    ],
  });

  // ── dispatch-results ──────────────────────────────────────────────────────

  const dispatchResultsCmd = new Command('dispatch-results')
    .description('Show recent dispatch results for a webhook — HTTP response codes, response bodies, and request bodies. Use this to debug failures. Use dispatches to see the attempt records.')
    .argument('<webhook-id>', 'Webhook ID')
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Offset', '0')
    .action(async (webhookId, opts) => {
      const token = resolveToken(opts);
      const data = await fetchDispatchResults(webhookId, token, { limit: opts.limit, offset: opts.offset }, opts.verbose);
      const list = Array.isArray(data) ? data : (data.results || []);

      if (opts.json) { printJson(list, opts); return; }
      if (list.length === 0) { console.log('No dispatch results found.'); return; }

      for (const d of list) {
        const ts = d.dispatched_at || d.created_date || '';
        const status = String(d.http_status || d.status || '').padEnd(6);
        const id = d.dispatch_id || d.id || '';
        console.log(`${ts}  ${status}  ${id}`);
      }
    });

  addGlobalOptions(dispatchResultsCmd, {
    output: true,
    examples: [
      'extole webhooks dispatch-results <webhook-id>',
      'extole webhooks dispatch-results <webhook-id> --limit 50',
      'extole webhooks dispatch-results <webhook-id> --json',
    ],
  });

  webhooks.addCommand(getCmd);
  webhooks.addCommand(createCmd);
  webhooks.addCommand(deleteCmd);
  webhooks.addCommand(dispatchesCmd);
  webhooks.addCommand(dispatchResultsCmd);

  return webhooks;
}
