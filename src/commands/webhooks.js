import { readFileSync } from 'fs';
import { Command } from 'commander';
import { createInterface } from 'readline';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson, apiFetch, formatApiErrorBody } from '../api.js';
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
  return apiJson(path, token, { verbose, baseUrl: API_BASE });
}

async function fetchWebhook(id, token, built, verbose) {
  const path = `/v6/webhooks/${id}${built ? '/built' : ''}`;
  return apiJson(path, token, { verbose, baseUrl: API_BASE });
}

async function fetchDispatches(id, token, params, verbose) {
  const qs = new URLSearchParams(params);
  const path = `/v6/webhooks/${id}/dispatches/recent${qs.toString() ? '?' + qs : ''}`;
  return apiJson(path, token, { verbose, baseUrl: API_BASE });
}

async function fetchDispatchResults(id, token, params, verbose) {
  const qs = new URLSearchParams(params);
  const path = `/v6/webhooks/${id}/dispatch-results/recent${qs.toString() ? '?' + qs : ''}`;
  return apiJson(path, token, { verbose, baseUrl: API_BASE });
}

// ── webhooks (list) ────────────────────────────────────────────────────────────

export function webhooksCommand() {
  const webhooks = new Command('webhooks')
    .description('List outbound webhooks. Shows id, type, name, and destination URL.')
    .option('--enabled <bool>', 'Filter by enabled status (true|false)')
    .option('--filter-type <type>', 'Filter by webhook type: GENERIC, CLIENT, REWARD, PARTNER')
    .option('--filter <substr>', 'Filter by name substring (case-insensitive)')
    .option('--limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Offset for pagination', '0')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const params = { limit: opts.limit, offset: opts.offset, include_archived: 'false' };
      if (opts.enabled !== undefined) params.enabled = opts.enabled;
      if (opts.filterType) params.type = opts.filterType;
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
      'extole webhooks --filter-type GENERIC',
      'extole webhooks --filter "sfdc"',
      'extole webhooks --json',
    ],
  });

  // ── get ───────────────────────────────────────────────────────────────────

  const getCmd = new Command('get')
    .description('Show full configuration for a webhook, including URL, method, tags, and retry intervals.')
    .argument('<webhook-id>', 'Webhook ID')
    .option('--built', 'Show resolved representation with inherited defaults applied')
    .action(async function (webhookId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const w = await fetchWebhook(webhookId, token, opts.built, opts.verbose);
      // For REWARD webhooks, fetch state filters
      let rewardFilters = null;
      if ((w.type || '').toUpperCase() === 'REWARD') {
        try {
          rewardFilters = await apiJson(`/v4/webhooks/reward/${w.webhook_id || w.id}/filters`, token, { verbose: opts.verbose, baseUrl: API_BASE });
        } catch (_) { /* non-fatal */ }
      }

      if (opts.json) {
        const out = rewardFilters ? { ...w, filters: rewardFilters } : w;
        printJson(out, opts);
        return;
      }

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
      if (rewardFilters?.length) {
        console.log(`filters:`);
        for (const f of rewardFilters) {
          const type = f.type || f.filter_type || '?';
          const detail = f.states ? `states=${f.states.join(', ')}`
            : f.reward_supplier_ids ? `suppliers=${f.reward_supplier_ids.join(', ')}`
            : f.tags ? `tags=${f.tags.join(', ')}`
            : JSON.stringify(f);
          console.log(`  ${type.padEnd(12)}  ${detail}`);
        }
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
    .description('Create an outbound webhook. GENERIC fires for consumer/person journey events (default); CLIENT fires for admin/operational events (config change, report complete, campaign started); REWARD fires on reward state transitions; PARTNER is manual-dispatch only. Use --tag to enable build-time discovery by a component.')
    .option('--name <name>', 'Webhook name')
    .option('--url <url>', 'Destination URL')
    .option('--type <type>', 'Webhook type: GENERIC | CLIENT | REWARD | PARTNER', 'GENERIC')
    .option('--enabled <bool>', 'Enable immediately (default: true)', 'true')
    .option('--description <text>', 'Optional description')
    .option('--method <method>', 'HTTP method (POST, PUT)', 'POST')
    .option('--tag <tag>', 'Tag (repeatable) — used by components to discover this webhook at build time', (val, acc) => [...acc, val], [])
    .option('--filter-state <state>', '(REWARD only) Filter to specific reward states (repeatable): EARNED, FULFILLED, FULFILL_FAILED, SENT, REDEEMED, FAILED, CANCELED, REVOKED', (val, acc) => [...acc, val], [])
    .option('--request <script>', 'javascript@runtime request script (inline) — runs per dispatch, return null to suppress')
    .option('--request-file <path>', 'Path to a file containing the request script')
    .option('--built', 'Show resolved (built) representation of the webhook after creation')
    .option('--dry-run', 'Print the request payload and exit without creating anything')
    .action(async function () {
      const opts = this.optsWithGlobals();
      if (!opts.name) { console.error('error: --name is required'); process.exit(2); }
      if (!opts.url)  { console.error('error: --url is required');  process.exit(2); }
      if (opts.request && opts.requestFile) {
        console.error('error: --request and --request-file are mutually exclusive');
        process.exit(2);
      }
      if (opts.filterState?.length && opts.type !== 'REWARD') {
        console.error('error: --filter-state is only valid with --type REWARD');
        process.exit(2);
      }
      const token = resolveToken(opts);

      let requestScript = opts.request || null;
      if (opts.requestFile) {
        try {
          requestScript = readFileSync(opts.requestFile, 'utf8').trim();
        } catch (e) {
          console.error(`error reading --request-file: ${e.message}`);
          process.exit(2);
        }
      }

      const payload = {
        name: opts.name,
        url: opts.url,
        type: opts.type,
        enabled: opts.enabled !== 'false',
        default_method: opts.method,
      };
      if (opts.description) payload.description = opts.description;
      if (opts.tag?.length) payload.tags = opts.tag;
      if (requestScript) payload.request = requestScript;

      if (opts.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        if (opts.filterState?.length) {
          console.log('\n// state filter (posted separately after creation):');
          console.log(JSON.stringify({ states: opts.filterState }, null, 2));
        }
        return;
      }

      const res = await apiFetch('/v6/webhooks', token, {
        method: 'POST',
        body: JSON.stringify(payload),
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`Error ${res.status}: ${text.slice(0, 300)}`);
        process.exit(1);
      }
      let w;
      try { w = JSON.parse(text); } catch {
        console.error(`Unexpected non-JSON response (${res.status}): ${text.slice(0, 200)}`);
        process.exit(1);
      }
      const webhookId = w.webhook_id || w.id;

      // Add state filters for REWARD webhooks
      if (opts.filterState?.length) {
        const filterRes = await apiFetch(`/v4/webhooks/reward/${webhookId}/filters/state`, token, {
          method: 'POST',
          body: JSON.stringify({ states: opts.filterState }),
          verbose: opts.verbose,
          baseUrl: API_BASE,
        });
        const filterText = await filterRes.text();
        if (!filterRes.ok) {
          console.error(`Warning: webhook created (${webhookId}) but state filter failed ${filterRes.status}: ${filterText.slice(0, 300)}`);
        }
      }

      // Optionally fetch built representation
      const display = opts.built ? await fetchWebhook(webhookId, token, true, opts.verbose) : w;

      if (opts.json) { printJson(display, opts); return; }
      console.log(`created: ${webhookId}`);
      console.log(`name:    ${display.name}`);
      console.log(`url:     ${display.url}`);
      console.log(`type:    ${display.type}`);
      console.log(`enabled: ${display.enabled}`);
      if (opts.filterState?.length) console.log(`filters: state=${opts.filterState.join(', ')}`);
    });

  addGlobalOptions(createCmd, {
    output: true,
    examples: [
      'extole webhooks create --name "SFDC Events" --url https://example.com/hook',
      'extole webhooks create --name "Reward Hook" --url https://example.com/hook --type REWARD --filter-state EARNED',
      'extole webhooks create --name "Reward Hook" --url https://example.com/hook --type REWARD --filter-state EARNED --filter-state FULFILLED',
      'extole webhooks create --name "Iterable Events" --url https://api.iterable.com/api/events/track --type CLIENT --tag iterable-events --request-file request.js',
      'extole webhooks create --name "Test" --url https://example.com/hook --built --json',
    ],
  });

  // ── delete ────────────────────────────────────────────────────────────────

  const deleteCmd = new Command('delete')
    .description('Archive a webhook. Fails if the webhook is still wired to campaign controller actions — detach it first.')
    .argument('<webhook-id>', 'Webhook ID')
    .action(async function (webhookId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const res = await apiFetch(`/v6/webhooks/${webhookId}`, token, {
        method: 'DELETE',
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      if (!res.ok) {
        const text = await res.text();
        let detail = formatApiErrorBody(text);
        try {
          const err = JSON.parse(text);
          // The bind list lives under parameters.webhook_controller_actions in
          // the structured error envelope. Surface it as a friendly hint
          // alongside the formatted error.
          const actions = err.parameters?.webhook_controller_actions || err.webhook_controller_actions;
          if (actions?.length) {
            const lines = actions.map(a => `  - controller ${a.controller_id || '?'} on campaign ${a.campaign_id || '?'} (${a.controller_name || 'unnamed'})`);
            detail = `${detail}\n\nWebhook is still wired to ${actions.length} controller action(s). Detach them first:\n${lines.join('\n')}`;
          }
        } catch (_) { /* use formatted body */ }
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
    .option('--event-type <type>', 'Trigger discriminator. Common values: INPUT (business event from an integration), STEP (internal processing step), SHAREABLE (share-link generation), SHARE (share action), REWARD (reward state transition). Must match the event_type the campaign expects. Default: INPUT', 'INPUT')
    .option('--controller <id>', 'Use an existing controller ID instead of creating a new one')
    .option('--quality <q>', 'Dispatch priority: HIGH (normal), LOW (best-effort), ALWAYS (bypasses targeting rules). Default: HIGH', 'HIGH')
    .option('--skip-publish', 'Skip publishing the campaign after wiring. Use when attaching multiple events — pass --skip-publish on all but the last call to publish once at the end.')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      let controllerId = opts.controller;

      if (!controllerId) {
        const res = await apiFetch(`/v2/campaigns/${opts.campaign}/controllers`, token, {
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
          baseUrl: API_BASE,
        });
        const text = await res.text();
        if (!res.ok) { console.error(`Error creating controller ${res.status}: ${text.slice(0, 300)}`); process.exit(1); }
        let ctrl;
        try { ctrl = JSON.parse(text); } catch {
          console.error(`Unexpected non-JSON response creating controller: ${text.slice(0, 200)}`);
          process.exit(1);
        }
        controllerId = ctrl.id;
        if (!opts.json) console.log(`created controller: ${controllerId}`);
      } else {
        if (!opts.json) console.log(`using controller:   ${controllerId}`);
      }

      const trigRes = await apiFetch(
        `/v2/campaigns/${opts.campaign}/controllers/${controllerId}/triggers/events`,
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
          baseUrl: API_BASE,
        }
      );
      const trigText = await trigRes.text();
      if (!trigRes.ok) { console.error(`Error adding trigger ${trigRes.status}: ${trigText.slice(0, 300)}`); process.exit(1); }
      let trigger;
      try { trigger = JSON.parse(trigText); } catch {
        console.error(`Unexpected non-JSON response adding trigger: ${trigText.slice(0, 200)}`); process.exit(1);
      }
      if (!opts.json) console.log(`added trigger:      ${trigger.trigger_id}  (${opts.event} / ${opts.eventType.toUpperCase()})`);

      const actRes = await apiFetch(
        `/v2/campaigns/${opts.campaign}/controllers/${controllerId}/actions/webhooks`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({ webhook_id: opts.webhook, quality: opts.quality.toUpperCase(), enabled: true }),
          verbose: opts.verbose,
          baseUrl: API_BASE,
        }
      );
      const actText = await actRes.text();
      if (!actRes.ok) { console.error(`Error adding action ${actRes.status}: ${actText.slice(0, 300)}`); process.exit(1); }
      let action;
      try { action = JSON.parse(actText); } catch {
        console.error(`Unexpected non-JSON response adding action: ${actText.slice(0, 200)}`); process.exit(1);
      }
      if (!opts.json) console.log(`added action:       ${action.action_id}  (WEBHOOK / ${opts.quality.toUpperCase()})`);

      if (!opts.skipPublish) {
        const pubRes = await apiFetch(`/v2/campaigns/${opts.campaign}/live`, token, {
          method: 'POST',
          verbose: opts.verbose,
          baseUrl: API_BASE,
        });
        const pubText = await pubRes.text();
        if (!pubRes.ok) { console.error(`Error publishing ${pubRes.status}: ${pubText.slice(0, 300)}`); process.exit(1); }
        let campaign;
        try { campaign = JSON.parse(pubText); } catch {
          console.error(`Unexpected non-JSON response publishing: ${pubText.slice(0, 200)}`); process.exit(1);
        }
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
    .option('--event-type <type>', 'Trigger discriminator. Common values: INPUT, STEP, SHAREABLE, SHARE, REWARD. Must match the event_type the campaign expects. Default: INPUT', 'INPUT')
    .option('--quality <q>', 'Dispatch priority: HIGH (normal), LOW (best-effort), ALWAYS (bypasses targeting rules). Default: HIGH', 'HIGH')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async function () {
      const opts = this.optsWithGlobals();
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
        baseUrl: API_BASE,
      });
      const wText = await wRes.text();
      if (!wRes.ok) { console.error(`Error creating webhook ${wRes.status}: ${wText.slice(0, 300)}`); process.exit(1); }
      let webhook;
      try { webhook = JSON.parse(wText); } catch {
        console.error(`Unexpected non-JSON response creating webhook: ${wText.slice(0, 200)}`); process.exit(1);
      }
      const webhookId = webhook.webhook_id || webhook.id;
      console.log(`created webhook:    ${webhookId}`);

      // Create controller
      const ctrlRes = await apiFetch(`/v2/campaigns/${opts.campaign}/controllers`, token, {
        method: 'POST',
        body: JSON.stringify({ type: 'CONTROLLER', name: `listen-${opts.event}-webhook`, enabled: true, enabled_on_states: ['LIVE'], selectors: ['TARGET'], scope: 'PUBLIC' }),
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      const ctrlText = await ctrlRes.text();
      if (!ctrlRes.ok) {
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        console.error(`Error creating controller ${ctrlRes.status}: ${ctrlText.slice(0, 300)}`); process.exit(1);
      }
      let ctrl;
      try { ctrl = JSON.parse(ctrlText); } catch {
        console.error(`Unexpected non-JSON response creating controller: ${ctrlText.slice(0, 200)}`);
        process.exit(1);
      }
      const controllerId = ctrl.id;
      console.log(`created controller: ${controllerId}`);

      // Add event trigger
      const trigRes = await apiFetch(
        `/v2/campaigns/${opts.campaign}/controllers/${controllerId}/triggers/events`, token,
        { method: 'POST', body: JSON.stringify({ event_names: [opts.event], event_type: opts.eventType.toUpperCase(), trigger_phase: 'MATCHING', trigger_name: `${opts.event}-trigger`, enabled: true }), verbose: opts.verbose, baseUrl: API_BASE }
      );
      const trigText = await trigRes.text();
      if (!trigRes.ok) {
        await apiFetch(`/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        console.error(`Error adding trigger ${trigRes.status}: ${trigText.slice(0, 300)}`); process.exit(1);
      }
      let trigger;
      try { trigger = JSON.parse(trigText); } catch {
        console.error(`Unexpected non-JSON response adding trigger: ${trigText.slice(0, 200)}`); process.exit(1);
      }
      console.log(`added trigger:      ${trigger.trigger_id}`);

      // Add webhook action
      const actRes = await apiFetch(
        `/v2/campaigns/${opts.campaign}/controllers/${controllerId}/actions/webhooks`, token,
        { method: 'POST', body: JSON.stringify({ webhook_id: webhookId, quality: opts.quality.toUpperCase(), enabled: true }), verbose: opts.verbose, baseUrl: API_BASE }
      );
      const actText = await actRes.text();
      if (!actRes.ok) {
        await apiFetch(`/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        console.error(`Error adding action ${actRes.status}: ${actText.slice(0, 300)}`); process.exit(1);
      }
      let action;
      try { action = JSON.parse(actText); } catch {
        console.error(`Unexpected non-JSON response adding action: ${actText.slice(0, 200)}`); process.exit(1);
      }
      console.log(`added action:       ${action.action_id}`);

      // Publish
      const pubRes = await apiFetch(`/v2/campaigns/${opts.campaign}/live`, token, { method: 'POST', verbose: opts.verbose, baseUrl: API_BASE });
      const pubText = await pubRes.text();
      if (!pubRes.ok) {
        await apiFetch(`/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        console.error(`Error publishing ${pubRes.status}: ${pubText.slice(0, 300)}`); process.exit(1);
      }
      let campaign;
      try { campaign = JSON.parse(pubText); } catch {
        console.error(`Unexpected non-JSON response publishing: ${pubText.slice(0, 200)}`); process.exit(1);
      }
      console.log(`published:          campaign ${opts.campaign}  state=${campaign.state}`);
      console.log(`\nListening for "${opts.event}" dispatches... (Ctrl-C to stop and clean up)\n`);

      // Cleanup on exit
      let cleaningUp = false;
      async function cleanup() {
        if (cleaningUp) return;
        cleaningUp = true;
        console.log('\nCleaning up...');
        await apiFetch(`/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        console.log(`deleted controller: ${controllerId}`);
        await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: API_BASE });
        console.log(`deleted webhook:    ${webhookId}`);
        await apiFetch(`/v2/campaigns/${opts.campaign}/live`, token, { method: 'POST', baseUrl: API_BASE });
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
            const id = d.event_id || d.dispatch_id || d.id || '';
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const ts = (d.event_time || d.dispatched_at || d.created_date || '').toString().slice(0, 19).replace('T', ' ');
            console.log(`${ts.padEnd(19)}  ${id}`);
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
    .action(async (webhookId, _o, command) => {
      const opts = command.optsWithGlobals();
      const token = resolveToken(opts);
      const data = await fetchDispatches(webhookId, token, { limit: opts.limit, offset: opts.offset }, opts.verbose);
      const list = Array.isArray(data) ? data : (data.dispatches || data.results || []);

      if (opts.json) { printJson(list, opts); return; }
      if (list.length === 0) { console.log('No dispatches found.'); return; }

      for (const d of list) {
        const ts = (d.event_time || d.dispatched_at || d.created_date || '').toString().slice(0, 19).replace('T', ' ');
        const eventId = d.event_id || d.dispatch_id || d.id || '';
        const causeId = d.cause_event_id || (d.event && d.event.cause_event_id) || '';
        console.log(`${ts.padEnd(19)}  ${eventId.padEnd(20)}  cause=${causeId}`);
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
    .action(async (webhookId, _o, command) => {
      const opts = command.optsWithGlobals();
      const token = resolveToken(opts);
      const data = await fetchDispatchResults(webhookId, token, { limit: opts.limit, offset: opts.offset }, opts.verbose);
      const list = Array.isArray(data) ? data : (data.results || []);

      if (opts.json) { printJson(list, opts); return; }
      if (list.length === 0) { console.log('No dispatch results found.'); return; }

      for (const d of list) {
        const ts = (d.event_time || d.dispatched_at || d.created_date || '').toString().slice(0, 19).replace('T', ' ');
        const code = String(d.response_status_code ?? d.response_code ?? d.http_status ?? d.status ?? '').padEnd(4);
        const eventId = d.event_id || d.dispatch_id || d.id || '';
        const msg = (d.response_body || d.response_message || '').toString().slice(0, 80);
        console.log(`${ts.padEnd(19)}  ${code}  ${eventId.padEnd(20)}  ${msg}`);
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

  // ── watch ─────────────────────────────────────────────────────────────────
  // Follow-tail of dispatch results (HTTP responses) for one webhook. Replaces
  // the manual repeat of `dispatch-results` while debugging integrations.
  const watchCmd = new Command('watch')
    .description('Tail dispatch results for a webhook in real time. Polls every 3s and prints new attempts with their HTTP response code and body. Ctrl-C to stop.')
    .argument('<webhook-id>', 'Webhook ID')
    .option('--interval <seconds>', 'Poll interval in seconds (default 3)', '3')
    .option('--show-body', 'Print full response body on its own line under each row (default truncates to 80 chars inline)')
    .action(async (webhookId, _o, command) => {
      const opts = command.optsWithGlobals();
      const token = resolveToken(opts);
      const intervalMs = Math.max(1, Number(opts.interval) || 3) * 1000;

      console.log(`Watching webhook ${webhookId} for dispatch results... (Ctrl-C to stop)\n`);

      const seen = new Set();
      let firstPoll = true;

      const poll = async () => {
        try {
          const data = await fetchDispatchResults(webhookId, token, { limit: '20' }, false);
          const list = Array.isArray(data) ? data : (data.results || []);
          // Mark everything seen on the first poll without printing — we want
          // to follow-tail, not dump history.
          if (firstPoll) {
            for (const r of list) {
              const id = r.event_id || r.webhook_event_id || r.id;
              if (id) seen.add(id);
            }
            firstPoll = false;
            return;
          }
          // Print oldest-first so the timeline reads top-to-bottom.
          for (const r of list.reverse()) {
            const id = r.event_id || r.webhook_event_id || r.id || '';
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const ts = (r.event_time || r.dispatched_at || '').toString().slice(0, 19).replace('T', ' ');
            const code = String(r.response_status_code ?? r.response_code ?? r.http_status ?? '???').padEnd(4);
            const body = (r.response_body || '').toString();
            const inline = opts.showBody ? '' : body.slice(0, 80);
            console.log(`${ts.padEnd(19)}  ${code}  ${id.padEnd(20)}  ${inline}`);
            if (opts.showBody && body) {
              console.log(`  ${body}`);
            }
          }
        } catch (_) { /* ignore transient poll errors */ }
      };

      // Run immediately to seed seen-set, then on the interval.
      await poll();
      const handle = setInterval(poll, intervalMs);
      const cleanup = () => { clearInterval(handle); process.exit(0); };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });

  addGlobalOptions(watchCmd, {
    examples: [
      'extole webhooks watch <webhook-id>',
      'extole webhooks watch <webhook-id> --interval 5',
      'extole webhooks watch <webhook-id> --show-body',
    ],
  });

  webhooks.addCommand(getCmd);
  webhooks.addCommand(createCmd);
  webhooks.addCommand(deleteCmd);
  webhooks.addCommand(dispatchesCmd);
  webhooks.addCommand(dispatchResultsCmd);
  webhooks.addCommand(watchCmd);

  return webhooks;
}
