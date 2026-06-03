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
  const queryParams = new URLSearchParams(params);
  const path = `/v6/webhooks/built${queryParams.toString() ? '?' + queryParams : ''}`;
  return apiJson(path, token, { verbose, baseUrl: API_BASE });
}

async function fetchWebhook(webhookId, token, built, verbose) {
  const path = `/v6/webhooks/${webhookId}${built ? '/built' : ''}`;
  return apiJson(path, token, { verbose, baseUrl: API_BASE });
}

async function fetchDispatches(webhookId, token, params, verbose) {
  const queryParams = new URLSearchParams(params);
  const path = `/v6/webhooks/${webhookId}/dispatches/recent${queryParams.toString() ? '?' + queryParams : ''}`;
  return apiJson(path, token, { verbose, baseUrl: API_BASE });
}

async function fetchDispatchResults(webhookId, token, params, verbose) {
  const queryParams = new URLSearchParams(params);
  const path = `/v6/webhooks/${webhookId}/dispatch-results/recent${queryParams.toString() ? '?' + queryParams : ''}`;
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
    .action(async (options) => {
      const token = resolveToken(options);
      const params = { limit: options.limit, offset: options.offset, include_archived: 'false' };
      if (options.enabled !== undefined) params.enabled = options.enabled;
      if (options.filterType) params.type = options.filterType;
      if (options.filter) params.name = options.filter;

      const data = await fetchWebhooks(token, params, options.verbose);
      const webhookList = Array.isArray(data) ? data : (data.webhooks || data.results || []);

      if (options.json) { printJson(webhookList, options); return; }
      if (webhookList.length === 0) { console.log('No webhooks found.'); return; }

      const idColumnWidth = 24, typeColumnWidth = 8, nameColumnWidth = 30, urlColumnWidth = 50;
      console.log(`${'id'.padEnd(idColumnWidth)}  ${'type'.padEnd(typeColumnWidth)}  ${'name'.padEnd(nameColumnWidth)}  url`);
      console.log(`${'─'.repeat(idColumnWidth)}  ${'─'.repeat(typeColumnWidth)}  ${'─'.repeat(nameColumnWidth)}  ${'─'.repeat(urlColumnWidth)}`);
      for (const webhook of webhookList) {
        const id = (webhook.webhook_id || webhook.id || '').padEnd(idColumnWidth);
        const type = (webhook.type || '').padEnd(typeColumnWidth);
        const name = (webhook.name || '').padEnd(nameColumnWidth);
        const url = webhook.url || '';
        const truncatedUrl = url.length > urlColumnWidth ? url.slice(0, urlColumnWidth - 1) + '…' : url;
        console.log(`${id}  ${type}  ${name}  ${truncatedUrl}`);
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
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const webhook = await fetchWebhook(webhookId, token, options.built, options.verbose);
      let rewardFilters = null;
      if ((webhook.type || '').toUpperCase() === 'REWARD') {
        try {
          rewardFilters = await apiJson(`/v4/webhooks/reward/${webhook.webhook_id || webhook.id}/filters`, token, { verbose: options.verbose, baseUrl: API_BASE });
        } catch (_) { /* non-fatal */ }
      }

      if (options.json) {
        const output = rewardFilters ? { ...webhook, filters: rewardFilters } : webhook;
        printJson(output, options);
        return;
      }

      console.log(`id:       ${webhook.webhook_id || webhook.id}`);
      console.log(`name:     ${webhook.name || ''}`);
      console.log(`type:     ${webhook.type || ''}`);
      console.log(`enabled:  ${webhook.enabled}`);
      console.log(`url:      ${webhook.url || ''}`);
      if (webhook.description) console.log(`desc:     ${webhook.description}`);
      if (webhook.default_method || webhook.defaultMethod) console.log(`method:   ${webhook.default_method || webhook.defaultMethod}`);
      const tags = webhook.tags?.filter(tag => !tag.startsWith('internal:'));
      const internalTags = webhook.tags?.filter(tag => tag.startsWith('internal:'));
      if (tags?.length) console.log(`tags:     ${tags.join(', ')}`);
      if (internalTags?.length) console.log(`internal: ${internalTags.join(', ')}`);
      if (webhook.retry_intervals || webhook.retryIntervals) {
        console.log(`retries:  ${(webhook.retry_intervals || webhook.retryIntervals).join(', ')}`);
      }
      if (rewardFilters?.length) {
        console.log(`filters:`);
        for (const rewardFilter of rewardFilters) {
          const filterType = rewardFilter.type || rewardFilter.filter_type || '?';
          const detail = rewardFilter.states ? `states=${rewardFilter.states.join(', ')}`
            : rewardFilter.reward_supplier_ids ? `suppliers=${rewardFilter.reward_supplier_ids.join(', ')}`
            : rewardFilter.tags ? `tags=${rewardFilter.tags.join(', ')}`
            : JSON.stringify(rewardFilter);
          console.log(`  ${filterType.padEnd(12)}  ${detail}`);
        }
      }
      if (webhook.component_ids?.length) console.log(`components: ${webhook.component_ids.join(', ')}`);
      if (webhook.request) {
        console.log(`request:`);
        console.log(webhook.request.split('\n').map(line => `  ${line}`).join('\n'));
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
        } catch (error) {
          console.error(`error reading --request-file: ${error.message}`);
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

      const createResponse = await apiFetch('/v6/webhooks', token, {
        method: 'POST',
        body: JSON.stringify(payload),
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      const createText = await createResponse.text();
      if (!createResponse.ok) {
        console.error(`Error ${createResponse.status}: ${createText.slice(0, 300)}`);
        process.exit(1);
      }
      let createdWebhook;
      try { createdWebhook = JSON.parse(createText); } catch {
        console.error(`Unexpected non-JSON response (${createResponse.status}): ${createText.slice(0, 200)}`);
        process.exit(1);
      }
      const webhookId = createdWebhook.webhook_id || createdWebhook.id;

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
      const display = opts.built ? await fetchWebhook(webhookId, token, true, opts.verbose) : createdWebhook;

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
      const deleteResponse = await apiFetch(`/v6/webhooks/${webhookId}`, token, {
        method: 'DELETE',
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      if (!deleteResponse.ok) {
        const text = await deleteResponse.text();
        let detail = formatApiErrorBody(text);
        try {
          const errorBody = JSON.parse(text);
          const actions = errorBody.parameters?.webhook_controller_actions || errorBody.webhook_controller_actions;
          if (actions?.length) {
            const lines = actions.map(action => `  - controller ${action.controller_id || '?'} on campaign ${action.campaign_id || '?'} (${action.controller_name || 'unnamed'})`);
            detail = `${detail}\n\nWebhook is still wired to ${actions.length} controller action(s). Detach them first:\n${lines.join('\n')}`;
          }
        } catch (_) { /* use formatted body */ }
        console.error(`Error ${deleteResponse.status}: ${detail}`);
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

  const traceCmd = new Command('trace')
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
        try {
          await apiFetch(`/v2/campaigns/${opts.campaign}/controllers/${controllerId}`, token, { method: 'DELETE', baseUrl: API_BASE });
          console.log(`deleted controller: ${controllerId}`);
        } catch (error) {
          console.log(`  warning: could not delete controller ${controllerId}: ${error.message}`);
        }
        try {
          await apiFetch(`/v6/webhooks/${webhookId}`, token, { method: 'DELETE', baseUrl: API_BASE });
          console.log(`deleted webhook:    ${webhookId}`);
        } catch (error) {
          console.log(`  warning: could not delete webhook ${webhookId}: ${error.message}`);
        }
        try {
          await apiFetch(`/v2/campaigns/${opts.campaign}/live`, token, { method: 'POST', baseUrl: API_BASE });
          console.log(`republished:        campaign ${opts.campaign}`);
        } catch (error) {
          console.log(`  warning: could not republish campaign ${opts.campaign}: ${error.message}`);
        }
      }

      process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
      process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });

      // Poll dispatches
      const seen = new Set();
      setInterval(async () => {
        try {
          const data = await fetchDispatches(webhookId, token, { limit: '20' }, false);
          const dispatchList = Array.isArray(data) ? data : (data.dispatches || data.results || []);
          for (const dispatch of dispatchList.reverse()) {
            const id = dispatch.event_id || dispatch.dispatch_id || dispatch.id || '';
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const timestamp = (dispatch.event_time || dispatch.dispatched_at || dispatch.created_date || '').toString().slice(0, 19).replace('T', ' ');
            console.log(`${timestamp.padEnd(19)}  ${id}`);
          }
        } catch (_) { /* ignore transient poll errors in listen loop */ }
      }, 3000);
    });

  addGlobalOptions(traceCmd, {
    examples: [
      'extole webhooks trace --url https://my-server.com/hook --campaign <id> --event signed_up',
      'extole webhooks trace --url https://my-server.com/hook --campaign <id> --event conversion --event-type STEP',
      'extole webhooks trace --url https://my-server.com/hook --campaign <id> --event signed_up --yes',
    ],
  });

  webhooks.addCommand(traceCmd);

  // ── dispatches ────────────────────────────────────────────────────────────

  const dispatchesCmd = new Command('dispatches')
    .description('Show recent dispatch attempts for a webhook — what Extole tried to send. One record per attempt. Use dispatch-results to see the HTTP response side.')
    .argument('<webhook-id>', 'Webhook ID')
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Offset', '0')
    .action(async (webhookId, _unusedOptions, command) => {
      const options = command.optsWithGlobals();
      const token = resolveToken(options);
      const data = await fetchDispatches(webhookId, token, { limit: options.limit, offset: options.offset }, options.verbose);
      const dispatchList = Array.isArray(data) ? data : (data.dispatches || data.results || []);

      if (options.json) { printJson(dispatchList, options); return; }
      if (dispatchList.length === 0) { console.log('No dispatches found.'); return; }

      for (const dispatch of dispatchList) {
        const timestamp = (dispatch.event_time || dispatch.dispatched_at || dispatch.created_date || '').toString().slice(0, 19).replace('T', ' ');
        const eventId = dispatch.event_id || dispatch.dispatch_id || dispatch.id || '';
        const causeId = dispatch.cause_event_id || (dispatch.event && dispatch.event.cause_event_id) || '';
        console.log(`${timestamp.padEnd(19)}  ${eventId.padEnd(20)}  cause=${causeId}`);
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
    .action(async (webhookId, _unusedOptions, command) => {
      const options = command.optsWithGlobals();
      const token = resolveToken(options);
      const data = await fetchDispatchResults(webhookId, token, { limit: options.limit, offset: options.offset }, options.verbose);
      const resultList = Array.isArray(data) ? data : (data.results || []);

      if (options.json) { printJson(resultList, options); return; }
      if (resultList.length === 0) { console.log('No dispatch results found.'); return; }

      for (const result of resultList) {
        const timestamp = (result.event_time || result.dispatched_at || result.created_date || '').toString().slice(0, 19).replace('T', ' ');
        const statusCode = String(result.response_status_code ?? result.response_code ?? result.http_status ?? result.status ?? '').padEnd(4);
        const eventId = result.event_id || result.dispatch_id || result.id || '';
        const responseMessage = (result.response_body || result.response_message || '').toString().slice(0, 80);
        console.log(`${timestamp.padEnd(19)}  ${statusCode}  ${eventId.padEnd(20)}  ${responseMessage}`);
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
  const listenCmd = new Command('listen')
    .description('Tail dispatch results for a webhook in real time. Polls every 3s and prints new attempts with their HTTP response code and body. Ctrl-C to stop.')
    .argument('<webhook-id>', 'Webhook ID')
    .option('--interval <seconds>', 'Poll interval in seconds (default 3)', '3')
    .option('--duration <seconds>', 'Stop automatically after this many seconds')
    .option('--show-body', 'Print full response body on its own line under each row (default truncates to 80 chars inline)')
    .action(async (webhookId, _unusedOptions, command) => {
      const options = command.optsWithGlobals();
      const token = resolveToken(options);
      const intervalMs = Math.max(1, Number(options.interval) || 3) * 1000;

      const stopLine = options.duration ? ` (stops after ${options.duration}s)` : ' (Ctrl-C to stop)';
      console.log(`Watching webhook ${webhookId} for dispatch results...${stopLine}\n`);

      const seenIds = new Set();
      let firstPoll = true;

      const poll = async () => {
        try {
          const data = await fetchDispatchResults(webhookId, token, { limit: '20' }, false);
          const resultList = Array.isArray(data) ? data : (data.results || []);
          if (firstPoll) {
            for (const result of resultList) {
              const id = result.event_id || result.webhook_event_id || result.id;
              if (id) seenIds.add(id);
            }
            firstPoll = false;
            return;
          }
          for (const result of resultList.reverse()) {
            const id = result.event_id || result.webhook_event_id || result.id || '';
            if (!id || seenIds.has(id)) continue;
            seenIds.add(id);
            const timestamp = (result.event_time || result.dispatched_at || '').toString().slice(0, 19).replace('T', ' ');
            const statusCode = String(result.response_status_code ?? result.response_code ?? result.http_status ?? '???').padEnd(4);
            const body = (result.response_body || '').toString();
            const inlineBody = options.showBody ? '' : body.slice(0, 80);
            console.log(`${timestamp.padEnd(19)}  ${statusCode}  ${id.padEnd(20)}  ${inlineBody}`);
            if (options.showBody && body) {
              console.log(`  ${body}`);
            }
          }
        } catch (_) { /* ignore transient poll errors */ }
      };

      // Run immediately to seed seen-set, then on the interval.
      await poll();
      const pollHandle = setInterval(poll, intervalMs);
      const cleanup = () => { clearInterval(pollHandle); process.exit(0); };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
      if (options.duration) setTimeout(cleanup, Math.max(1, Number(options.duration)) * 1000);
    });

  addGlobalOptions(listenCmd, {
    examples: [
      'extole webhooks listen <webhook-id>',
      'extole webhooks listen <webhook-id> --interval 5',
      'extole webhooks listen <webhook-id> --show-body',
      'extole webhooks listen <webhook-id> --duration 60',
    ],
  });

  webhooks._mcpDescription = 'List outbound webhooks configured on this account. Returns webhook_id, type (GENERIC/CLIENT/REWARD/PARTNER), name, enabled status, and destination URL. webhook_id feeds into webhooks_get, webhooks_dispatches, webhooks_dispatch-results, and webhooks_listen.';
  getCmd._mcpDescription = 'Get full configuration for a webhook by webhook_id. Returns URL, HTTP method, tags, retry intervals, and for REWARD webhooks also the state/supplier filters. Use --built to see inherited defaults applied. Tags reveal which component integrations use this webhook.';
  createCmd._mcpDescription = 'Create an outbound webhook. GENERIC fires for person/journey events; CLIENT fires for admin/operational events (config changes, report completions); REWARD fires on reward state transitions; PARTNER is manual-dispatch only. Returns webhook_id.';
  deleteCmd._mcpDescription = 'Archive a webhook by webhook_id. Fails with a helpful error listing the controller actions still wired to it if it\'s still attached to campaigns — detach those first with webhooks_attach or by deleting the controller.';
  attachCmd._mcpDescription = 'Wire a webhook to a campaign so that matching events trigger a dispatch. Creates a controller with an event trigger and webhook action, then publishes the campaign. Use --event for the event name and --skip-publish when attaching multiple events to publish once at the end.';
  dispatchesCmd._mcpDescription = 'Show recent dispatch attempts for a webhook — the outbound HTTP request records. Use to confirm Extole tried to send (attempt records). Pair with webhooks_dispatch-results for the HTTP response side. Returns event_id, timestamp, and cause_event_id.';
  dispatchResultsCmd._mcpDescription = 'Show recent dispatch results for a webhook — HTTP response codes, response bodies, and request bodies. Use to debug integration failures: non-200 status codes, error messages, timeouts. The definitive answer for "did Extole send this and what did the endpoint say back?"';
  listenCmd._mcpDescription = 'Tail dispatch results for an existing webhook in real time. Polls every 3s and prints new dispatch attempts with HTTP status and body. Use --duration or --tail to set a time/count limit for non-interactive use. Best for watching a live integration in action.';
  traceCmd._mcpDescription = 'Temporarily wire a URL to a campaign event and tail live dispatches — creates a webhook, publishes the campaign, polls for results, then tears everything down on exit. WARNING: publishes the campaign as part of setup. Use only when the user has confirmed the target campaign and URL. Prompts for confirmation before acting — do not pass --yes unless the user has explicitly approved. Prefer events_fire --trace-webhook for lighter-weight testing that does not publish.';

  webhooks.addCommand(getCmd);
  webhooks.addCommand(createCmd);
  webhooks.addCommand(deleteCmd);
  webhooks.addCommand(dispatchesCmd);
  webhooks.addCommand(dispatchResultsCmd);
  webhooks.addCommand(listenCmd);

  return webhooks;
}
