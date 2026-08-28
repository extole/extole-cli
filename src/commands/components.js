import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve, basename } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson, apiFetch, formatApiErrorBody } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, printDiff } from '../utils.js';

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase() === 'y'); });
  });
}

// Setting types that carry a plain string value — sent through unchanged.
const PLAIN_STRING_SETTING_TYPES = new Set([
  'STRING', 'GLOB_COMPONENT_PATH', 'BROWSER_SIDE_JAVASCRIPT', 'CSS', 'COLOR', 'IMAGE', 'FONT', 'URL',
  'CLIENT_KEY_FLOW', 'CLIENT_KEY', 'EXTOLE_CLIENT_KEY', 'REWARD_SUPPLIER_ID', 'AUDIENCE_ID', 'ENUM',
  'PARTNER_ENUM', 'HTML', 'ADMIN_ICON', 'COMPONENT_ID', 'DELAY', 'WEBHOOK_ID', 'PERSON_KEY_NAME', 'DATE_TIME',
]);

// Setting types whose value is a JSON array/object rather than a scalar.
const JSON_SETTING_TYPES = new Set([
  'STRING_LIST', 'STRING_MAP', 'INTEGER_LIST', 'DELAY_LIST', 'JSON', 'AUDIENCE_ID_LIST', 'ENUM_LIST',
  'PARTNER_ENUM_LIST', 'REWARD_SUPPLIER_ID_LIST', 'CLIENT_DOMAIN_ID_LIST', 'COMPONENT_REFERENCE',
  'COMPONENT_REFERENCE_LIST',
]);

// A COMPONENT_REFERENCE value is a map keyed by "component.id" (dot included), not a bare
// component ID string — {"component.id": "<id>"}. COMPONENT_REFERENCE_LIST is an array of
// those maps. Prefer `extole components references` for these once it exists; it builds this
// shape for you.
function jsonSettingExample(key, type) {
  if (type === 'COMPONENT_REFERENCE') return `--setting ${key}='{"component.id":"<component-id>"}'`;
  if (type === 'COMPONENT_REFERENCE_LIST') return `--setting ${key}='[{"component.id":"<component-id>"}]'`;
  if (type.endsWith('_MAP') || type === 'JSON') return `--setting ${key}='{"key":"value"}'`;
  return `--setting ${key}='["a","b"]'`;
}

// Structural/component-graph settings — not expressible as a single value via `set`.
const STRUCTURAL_SETTING_TYPES = new Set([
  'MULTI_SOCKET', 'SOCKET', 'TRIGGER_CONFIGURATION', 'COMPONENT_SETTING_LOOKUP',
]);

// Coerces a raw string (from --setting or a --setting-file's file contents) to the JSON
// value the platform expects for the setting's declared type. Returns { value } on success
// or { error } with a message naming the type and, where useful, a corrected example —
// every failure is decided before any network call, with no heuristics or silent fallback.
export function coerceSettingValue(key, rawValue, variable) {
  const type = variable?.type;
  if (!type || PLAIN_STRING_SETTING_TYPES.has(type)) return { value: rawValue };

  if (type === 'BOOLEAN') {
    const lower = rawValue.toLowerCase();
    if (lower === 'true') return { value: true };
    if (lower === 'false') return { value: false };
    return { error: `--setting ${key}=${rawValue} invalid — type BOOLEAN requires true or false` };
  }

  if (type === 'INTEGER') {
    const num = Number(rawValue);
    if (!Number.isInteger(num)) return { error: `--setting ${key}=${rawValue} invalid — type INTEGER requires a whole number` };
    return { value: num };
  }

  if (STRUCTURAL_SETTING_TYPES.has(type)) {
    return { error: `setting "${key}" is type ${type} — not settable via components set (sockets/structural settings are wired via components create/duplicate/deploy)` };
  }

  if (JSON_SETTING_TYPES.has(type)) {
    try {
      return { value: JSON.parse(rawValue) };
    } catch {
      return { error: `--setting ${key} invalid — type ${type} requires valid JSON, e.g. ${jsonSettingExample(key, type)}` };
    }
  }

  return { value: rawValue };
}

const COMPONENTS_PAGE_SIZE = 500;

async function fetchAllComponents(token, params, verbose) {
  const all = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ limit: String(COMPONENTS_PAGE_SIZE), offset: String(offset), ...params });
    const page = await apiJson(`/v1/components?${qs}`, token, { verbose, baseUrl: API_BASE });
    all.push(...page);
    if (page.length < COMPONENTS_PAGE_SIZE) break;
    offset += COMPONENTS_PAGE_SIZE;
  }
  return all;
}

async function fetchComponent(id, token, verbose) {
  return apiJson(`/v1/components/${id}`, token, { verbose, baseUrl: API_BASE });
}

async function fetchComponentTree(id, token, verbose) {
  return apiJson(`/v1/components/${id}/tree`, token, { verbose, baseUrl: API_BASE });
}

// Match if any entry in the types array contains the filter string (substring, case-insensitive).
// This catches both exact types and parent types, so passing 'reward-supplier' matches
// shopify-reward-supplier-v10.0 components that inherit from reward-supplier-v10.0.
function matchesType(component, filter) {
  const f = filter.toLowerCase();
  return (component.types || []).some(t => t.toLowerCase().includes(f));
}

function formatRow(c) {
  const id = (c.id || '').padEnd(22);
  const type = (c.type || (c.types || [])[0] || '').padEnd(34);
  const name = c.display_name || c.name || '';
  console.log(`${id}  ${type}  ${name}`);
}

export function renderTreeNode(node, prefix) {
  const children = Object.entries(node).filter(([key, val]) => key !== '.' && typeof val === 'object' && val !== null);
  children.forEach(([key, val], index) => {
    const isLast = index === children.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    const dot = val['.'] || {};
    const type = dot.type || (dot.types || [])[0] || '?';
    const name = dot.display_name || dot.name || key;
    const socket = dot.installed_into_socket ? `  \x1b[2m[${dot.installed_into_socket}]\x1b[0m` : '';
    const id = dot.id ? `  \x1b[2m${dot.id}\x1b[0m` : '';
    console.log(`${prefix}${connector}${name}  (${type})${socket}${id}`);

    renderTreeNode(val, childPrefix);
  });
}

export function componentsCommand() {
  const components = new Command('components')
    .description('Browse and inspect Extole components')
    .option('--program <id>', 'Filter by program (campaign) ID')
    .option('--filter-type <type>', 'Filter by component type (matches parent types and subtypes)')
    .option('--filter <substr>', 'Filter by name substring (case-insensitive)')
    .enablePositionalOptions()
    .action(async (opts) => {
      const token = resolveToken(opts);
      const params = {};
      if (opts.program) params.campaign_ids = opts.program;

      let list = await fetchAllComponents(token, params, opts.verbose);

      if (opts.filterType) list = list.filter(c => matchesType(c, opts.filterType));
      if (opts.filter) {
        const q = opts.filter.toLowerCase();
        list = list.filter(c =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.display_name || '').toLowerCase().includes(q)
        );
      }

      if (opts.json) { printJson(list, opts); return; }

      if (list.length === 0) { console.log('No components found.'); return; }

      console.log(`${'id'.padEnd(22)}  ${'type'.padEnd(34)}  name`);
      console.log(`${'─'.repeat(22)}  ${'─'.repeat(34)}  ${'─'.repeat(30)}`);
      for (const c of list) formatRow(c);
    });

  addGlobalOptions(components, {
    output: true,
    examples: [
      'extole components',
      'extole components --program <program-id>',
      'extole components --filter-type reward-supplier',
      'extole components --filter "gift card"',
    ],
  });

  // ── get ────────────────────────────────────────────────────────────────────

  const getCmd = new Command('get')
    .description('Show full configuration for a component')
    .argument('<component-id>', 'Component ID')
    .option('--tree', 'Show downstream subtree')
    .option('--sockets', 'Show socket references to other components')
    .action(async function (componentId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      if (opts.tree) {
        const tree = await fetchComponentTree(componentId, token, opts.verbose);
        if (opts.json) { printJson(tree, opts); return; }
        const rootVal = Object.values(tree)[0] || {};
        const dot = rootVal['.'] || {};
        const name = dot.display_name || dot.name || componentId;
        const type = dot.type || (dot.types || [])[0] || '?';
        console.log(`${name}  (${type})  \x1b[2m${componentId}\x1b[0m`);
        renderTreeNode(rootVal, '');
        return;
      }

      const c = await fetchComponent(componentId, token, opts.verbose);
      if (opts.json) { printJson(c, opts); return; }

      const type = c.type || (c.types || [])[0] || '?';
      const parents = (c.types || []).slice(1);
      console.log(`id:       ${c.id}`);
      console.log(`type:     ${type}`);
      if (parents.length > 0) console.log(`parents:  ${parents.join(', ')}`);
      console.log(`name:     ${c.display_name || c.name || ''}`);
      if (c.installed_into_socket) console.log(`socket:   ${c.installed_into_socket}`);
      if (c.campaign_id) console.log(`program:  ${c.campaign_id}`);

      if (opts.sockets) {
        const refs = c.component_references || [];
        if (refs.length > 0) {
          console.log('\nsockets:');
          for (const ref of refs) {
            const sockets = (ref.socket_names || []).join(', ') || '(unspecified)';
            console.log(`  ${ref.component_id}  ${sockets}`);
          }
        } else {
          console.log('\nsockets: none');
        }
      }

      const vars = (c.variables || []).filter(v => v.values?.default !== undefined);
      if (vars.length > 0) {
        console.log('\nconfiguration:');
        for (const v of vars) {
          console.log(`  ${(v.name || '').padEnd(30)}  ${JSON.stringify(v.values.default)}`);
        }
      }
    });

  addGlobalOptions(getCmd, {
    output: true,
    examples: [
      'extole components get <component-id>',
      'extole components get <component-id> --tree',
      'extole components get <component-id> --sockets',
      'extole components get <component-id> --json',
    ],
  });

  components.addCommand(getCmd);

  // ── types ──────────────────────────────────────────────────────────────────

  const typesCmd = new Command('types')
    .description('List component type families')
    .option('--parent <type>', 'Show subtypes of a specific parent type')
    .option('--tree', 'Render type hierarchy visually (most useful with --parent)')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const list = await fetchAllComponents(token, {}, opts.verbose);

      // Build map: concrete type → set of parent types
      const typeMap = new Map();
      for (const c of list) {
        const types = c.types || [];
        if (types.length === 0) continue;
        const primary = types[0];
        if (!typeMap.has(primary)) typeMap.set(primary, new Set(types.slice(1)));
      }

      let entries = [...typeMap.entries()].sort(([a], [b]) => a.localeCompare(b));

      if (opts.parent) {
        const f = opts.parent.toLowerCase();
        entries = entries.filter(([type, parents]) =>
          type.toLowerCase().includes(f) ||
          [...parents].some(p => p.toLowerCase().includes(f))
        );
      }

      if (opts.json) {
        printJson(entries.map(([type, parents]) => ({ type, parents: [...parents] })), opts);
        return;
      }

      if (entries.length === 0) { console.log('No types found.'); return; }

      if (opts.tree && opts.parent) {
        // Group by parent, render as simple hierarchy
        const roots = entries.filter(([, parents]) => parents.size === 0);
        const children = entries.filter(([, parents]) => parents.size > 0);
        const byParent = new Map();
        for (const [type, parents] of children) {
          for (const p of parents) {
            if (!byParent.has(p)) byParent.set(p, []);
            byParent.get(p).push(type);
          }
        }
        function printTypeTree(type, indent) {
          console.log(' '.repeat(indent) + type);
          for (const child of (byParent.get(type) || [])) printTypeTree(child, indent + 2);
        }
        const allTypes = entries.map(([t]) => t);
        const topLevel = allTypes.filter(t => ![...entries.flatMap(([, ps]) => [...ps])].includes(t) || roots.some(([r]) => r === t));
        for (const t of topLevel) printTypeTree(t, 0);
        return;
      }

      const col = Math.max(10, ...entries.map(([t]) => t.length)) + 2;
      console.log('type'.padEnd(col) + 'parents');
      console.log('─'.repeat(col) + '─'.repeat(40));
      for (const [type, parents] of entries) {
        console.log(type.padEnd(col) + ([...parents].join(', ') || '—'));
      }
    });

  addGlobalOptions(typesCmd, {
    output: true,
    examples: [
      'extole components types',
      'extole components types --parent reward-supplier',
      'extole components types --parent rule --tree',
    ],
  });

  components.addCommand(typesCmd);

  // ── create ─────────────────────────────────────────────────────────────────

  function buildtimeWebhookVar(varName, displayName, tag) {
    return {
      name: varName,
      display_name: displayName,
      type: 'STRING',
      values: {
        default: `javascript@buildtime:(function(){ var items = Java.from(context.getComponent().createElementsQuery().withType('WEBHOOK').withTag('${tag}').list()); return items && items.length > 0 ? items[0].getId() : null; })()`,
      },
      tags: ['category:Webhooks'],
    };
  }

  const createCmd = new Command('create')
    .description('Create a component attached to a campaign. --webhook-tag generates a build-time variable that resolves a webhook ID by tag when the campaign is published — the component-driven integration pattern.')
    .requiredOption('--name <name>',        'Component name, snake_case (e.g. my_integration)')
    .requiredOption('--campaign <id>',      'Campaign ID to attach to')
    .option('--display-name <name>',        'Human-readable display name (defaults to --name)')
    .option('--description <text>',         'Component description')
    .option('--type <type>',                'Component type, e.g. extension or integration-v1. Registered types enforce a settings schema; omit for custom/untyped components.')
    .option('--tag <tag>',                  'Tag on the component (repeatable)', (v, acc) => [...acc, v], [])
    .option('--webhook-tag <tag>',          'Add a build-time variable that discovers a webhook by tag (repeatable). Format: tag (auto-names the variable) or varName:tag (explicit name)', (v, acc) => [...acc, v], [])
    .option('--dry-run',                    'Print the request payload and exit without creating anything')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const settings = [];

      // Build webhook discovery variables
      for (const spec of opts.webhookTag) {
        // Accept "varName:tag" or just "tag" (auto-derive varName from tag)
        const colonIdx = spec.indexOf(':');
        let varName, tag;
        if (colonIdx > 0) {
          varName = spec.slice(0, colonIdx);
          tag = spec.slice(colonIdx + 1);
        } else {
          tag = spec;
          // Convert tag to camelCase varName: e.g. my-integration-events → myIntegrationEventsWebhookId
          varName = tag.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'WebhookId';
        }
        const displayName = varName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        settings.push(buildtimeWebhookVar(varName, displayName, tag));
      }

      const payload = {
        name: opts.name,
        display_name: opts.displayName || opts.name,
        campaign_id: opts.campaign,
      };
      if (opts.description) payload.description = opts.description;
      if (opts.type) payload.types = [opts.type];
      if (opts.tag?.length) payload.tags = opts.tag;
      if (settings.length) payload.settings = settings;

      if (opts.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      const res = await apiFetch('/v1/components', token, {
        method: 'POST',
        body: JSON.stringify(payload),
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`Error ${res.status}: ${text.slice(0, 400)}`);
        process.exit(1);
      }
      const c = JSON.parse(text);
      if (opts.json) { printJson(c, opts); return; }

      console.log(`created:  ${c.id}`);
      console.log(`name:     ${c.name}`);
      console.log(`display:  ${c.display_name || ''}`);
      console.log(`type:     ${(c.types || []).join(', ') || '(none)'}`);
      console.log(`program:  ${c.campaign_id}`);
      if (settings.length) {
        console.log(`webhooks:`);
        for (const s of settings) {
          console.log(`  ${s.name}`);
        }
      }
    });

  addGlobalOptions(createCmd, {
    output: true,
    examples: [
      'extole components create --name my_integration --campaign <id>',
      'extole components create --name iterable_events --campaign <id> --webhook-tag iterable-events',
      'extole components create --name sfdc_sync --campaign <id> --webhook-tag sfdc-events --webhook-tag sfdc-rewards --display-name "SFDC Sync"',
      'extole components create --name my_integration --campaign <id> --webhook-tag eventsWebhookId:my-integration-events --json',
    ],
  });

  components.addCommand(createCmd);

  // ── duplicate ──────────────────────────────────────────────────────────────

  const duplicateCmd = new Command('duplicate')
    .argument('<component-id>', 'Component ID to duplicate')
    .description('Duplicate a component. Omit --target-campaign to duplicate the entire campaign that owns the source component, as a brand-new campaign. Pass --target-campaign to instead duplicate just this one component into an existing campaign (optionally at a specific socket via --target-socket).')
    .option('--target-campaign <id>', 'Existing campaign ID to install the copy into. Omit to duplicate the source\'s entire owning campaign as a new campaign instead.')
    .option('--target-socket <name>', 'With --target-campaign: socket name to install the copy into (e.g. an existing component\'s socket)')
    .option('--display-name <name>', 'Display name for the duplicated component')
    .option('--description <text>', 'Description for the duplicated component')
    .option('--tag <tag>', 'Tag on the duplicated component (repeatable)', (v, acc) => [...acc, v], [])
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--dry-run', 'Print the request payload without duplicating anything')
    .action(async function (componentId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const source = await fetchComponent(componentId, token, opts.verbose);
      const sourceName = source.display_name || source.name || componentId;

      const payload = {};
      if (opts.targetCampaign) payload.target_campaign_id = opts.targetCampaign;
      if (opts.targetSocket) payload.target_setting_name = opts.targetSocket;
      if (opts.displayName) payload.component_display_name = opts.displayName;
      if (opts.description) payload.description = opts.description;
      if (opts.tag?.length) payload.tags = opts.tag;

      console.log(`source:      ${componentId}  (${sourceName})`);
      console.log(`from campaign: ${source.campaign_id}`);
      if (opts.targetCampaign) {
        console.log(`\nWill duplicate just this component into existing campaign ${opts.targetCampaign}${opts.targetSocket ? ` (socket: ${opts.targetSocket})` : ''}.`);
      } else {
        console.log(`\nWarning: no --target-campaign given — this duplicates the ENTIRE campaign that owns this component (campaign ${source.campaign_id}) as a brand-new campaign, not just this one component.`);
      }

      if (opts.dryRun) {
        console.log(`\nPOST /v1/components/${componentId}/duplicate`);
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      if (!opts.yes) {
        const ok = await confirm('\nProceed? (y/N) ');
        if (!ok) { console.log('Aborted.'); process.exit(0); }
      }

      const res = await apiFetch(`/v1/components/${componentId}/duplicate`, token, {
        method: 'POST',
        body: JSON.stringify(payload),
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`Error ${res.status}: ${formatApiErrorBody(text)}`);
        process.exit(1);
      }
      let duplicated;
      try { duplicated = JSON.parse(text); } catch {
        console.error(`Unexpected non-JSON response: ${text.slice(0, 200)}`);
        process.exit(1);
      }

      if (opts.json) { printJson(duplicated, opts); return; }
      console.log(`\nduplicated:  ${duplicated.id}`);
      console.log(`campaign:    ${duplicated.campaign_id}`);
      if (!opts.targetCampaign) console.log(`\nNote: the new campaign is NOT_LAUNCHED. Publish it via my.extole or the platform's publish workflow once configured.`);
    });

  addGlobalOptions(duplicateCmd, {
    output: true,
    examples: [
      'extole components duplicate <component-id> --display-name "My Integration Copy"',
      'extole components duplicate <component-id> --target-campaign <campaign-id>',
      'extole components duplicate <component-id> --target-campaign <campaign-id> --target-socket rewardSuppliers',
      'extole components duplicate <component-id> --dry-run',
    ],
  });

  components.addCommand(duplicateCmd);

  // ── delete ─────────────────────────────────────────────────────────────────

  const deleteCmd = new Command('delete')
    .description('Delete a component by ID. Deleting the root component archives the entire campaign.')
    .argument('<component-id>', 'Component ID to delete')
    .option('--confirm', 'Skip the interactive confirmation prompt')
    .option('--dry-run', 'Show what would be deleted without deleting')
    .action(async function (componentId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const c = await fetchComponent(componentId, token, opts.verbose);
      const type = c.type || (c.types || [])[0] || '(unknown type)';
      const name = c.display_name || c.name || componentId;
      const isRoot = c.name === 'root';
      const campaignId = c.campaign_id;

      console.log(`component:  ${c.id}`);
      console.log(`type:       ${type}`);
      console.log(`name:       ${name}`);
      if (campaignId) console.log(`campaign:   ${campaignId}`);
      if (isRoot) console.log(`\nWarning: this is the root component — deleting it will archive the entire campaign.`);

      if (opts.dryRun) {
        console.log('\nDry run — nothing deleted.');
        return;
      }

      if (!opts.confirm) {
        if (!process.stdin.isTTY) {
          console.error('\nAborted: --confirm required in non-interactive contexts (no TTY for prompt).');
          process.exit(1);
        }
        const answer = await new Promise(res => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question('\nDelete this component? [y/N] ', ans => { rl.close(); res(ans.trim().toLowerCase()); });
        });
        if (answer !== 'y' && answer !== 'yes') {
          console.log('Cancelled.');
          return;
        }
      }

      const res = await apiFetch(`/v1/components/${componentId}`, token, {
        method: 'DELETE',
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Error ${res.status}: ${formatApiErrorBody(text)}`);
        process.exit(1);
      }
      if (opts.json) { printJson({ deleted: componentId }, opts); return; }
      console.log(`deleted: ${componentId}`);
    });

  addGlobalOptions(deleteCmd, {
    output: true,
    examples: [
      'extole components delete <component-id>',
      'extole components delete <component-id> --dry-run',
      'extole components delete <component-id> --confirm',
    ],
  });

  components.addCommand(deleteCmd);

  // ── deploy ─────────────────────────────────────────────────────────────────

  const deployCmd = new Command('deploy')
    .description('Bundle a local component directory and upload it to the platform')
    .requiredOption('--source <dir>', 'Local directory containing component.json (root of bundle)')
    .option('--component <id>', 'Existing component ID to update (omit to create new)')
    .option('--publish', 'Publish the campaign after uploading')
    .option('--dry-run', 'Print resolved component.json contents (post-include expansion) without uploading')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const sourceDir = resolve(opts.source);
      if (!existsSync(sourceDir)) {
        console.error(`Error: source directory not found: ${sourceDir}`);
        process.exit(2);
      }
      if (!existsSync(join(sourceDir, 'component.json'))) {
        console.error(`Error: no component.json found in ${sourceDir}`);
        process.exit(2);
      }

      const bundleName = basename(sourceDir);
      const tmpDir = mkdtempSync(join(tmpdir(), 'extole-deploy-'));
      const stagingDir = join(tmpDir, bundleName);
      try {
        processDir(sourceDir, stagingDir, sourceDir);

        if (opts.dryRun) {
          printResolvedBundle(stagingDir, tmpDir);
          return;
        }

        const bundlePath = join(tmpDir, 'bundle.zip');
        try {
          execSync(`cd "${tmpDir}" && zip -r bundle.zip "${bundleName}"`, { stdio: 'pipe' });
        } catch (e) {
          console.error(`Error creating bundle zip: ${e.message}`);
          process.exit(1);
        }

        const token = resolveToken(opts);
        const zipBuffer = readFileSync(bundlePath);
        const formData = new FormData();
        formData.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'bundle.zip');

        const isUpdate = !!opts.component;
        const path = isUpdate ? `/v1/components/${opts.component}/upload-bundle` : '/v1/components/upload-bundle';
        const method = isUpdate ? 'PUT' : 'POST';

        process.stderr.write(`${isUpdate ? 'Updating' : 'Uploading'} bundle...\n`);
        const res = await apiFetch(path, token, {
          method,
          body: formData,
          verbose: opts.verbose,
          baseUrl: API_BASE,
        });
        const text = await res.text();
        if (!res.ok) {
          try {
            const errJson = JSON.parse(text);
            const params = errJson?.parameters || {};
            const detail = params.validation_result || params.details || errJson?.message || text;
            console.error(`Error ${res.status}: ${errJson?.code || res.status}`);
            console.error(detail);
            if (opts.verbose) console.error(JSON.stringify(errJson, null, 2));
          } catch {
            console.error(`Error ${res.status}: ${text.slice(0, 2000)}`);
          }
          process.exit(1);
        }

        let component;
        try { component = JSON.parse(text); } catch {
          console.error(`Unexpected non-JSON response: ${text.slice(0, 200)}`);
          process.exit(1);
        }

        const campaignId = component.campaign_id;
        if (opts.json) {
          printJson(component, opts);
        } else {
          console.log(`component:  ${component.id}`);
          console.log(`name:       ${component.name || ''}`);
          if (campaignId) console.log(`campaign:   ${campaignId}`);
          if (component.campaign_state) console.log(`state:      ${component.campaign_state}`);
          if (!opts.publish) console.log(`\nStaged as draft. Publish via my.extole or re-run with --publish.`);
        }

        if (opts.publish) {
          if (!campaignId) {
            console.error('Warning: cannot publish — no campaign_id in response');
          } else {
            const pubRes = await apiFetch(`/v2/campaigns/${campaignId}/publish`, token, {
              method: 'POST',
              body: JSON.stringify({}),
              verbose: opts.verbose,
              baseUrl: API_BASE,
            });
            if (!pubRes.ok) {
              const pubText = await pubRes.text();
              console.error(`Warning: uploaded but publish failed ${pubRes.status}: ${pubText.slice(0, 300)}`);
            } else {
              console.log(`published`);
            }
          }
        }
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

  addGlobalOptions(deployCmd, {
    output: true,
    examples: [
      'extole components deploy --source ./my_integration',
      'extole components deploy --source ./my_integration --publish',
      'extole components deploy --source ./my_integration --component <id>',
      'extole components deploy --source ./my_integration --dry-run',
    ],
  });

  components.addCommand(deployCmd);

  // ── set ────────────────────────────────────────────────────────────────────

  const setCmd = new Command('set')
    .description('Patch one or more settings on an existing component without redeploying the bundle. Useful for testing/iteration where you want to tweak a setting and re-fire events. Values are coerced to the setting\'s declared type (BOOLEAN, INTEGER, JSON arrays/objects for list types) — see the component\'s variables (components get <id>) for each setting\'s type. Use --setting-file for multi-line/script-shaped settings — it shows a diff against the current value and asks for confirmation before sending.')
    .argument('<component-id>', 'Component ID to update')
    .option('--setting <kv>', 'Setting in key=value form (repeatable)', (v, prev) => prev.concat([v]), [])
    .option('--setting-file <kv>', 'Setting in key=path form — reads the new value from a file (repeatable). Best for multi-line/script-shaped settings.', (v, prev) => prev.concat([v]), [])
    .option('-y, --yes', 'Skip confirmation prompt (only relevant with --setting-file)')
    .option('--dry-run', 'Print the payload that would be sent without making the API call')
    .action(async function (componentId) {
      const opts = this.optsWithGlobals();
      if ((!opts.setting || opts.setting.length === 0) && (!opts.settingFile || opts.settingFile.length === 0)) {
        console.error('Error: at least one --setting key=value or --setting-file key=path is required.');
        process.exit(2);
      }

      const inlineEdits = [];
      for (const kv of opts.setting || []) {
        const idx = kv.indexOf('=');
        if (idx < 0) {
          console.error(`Error: invalid --setting (expected key=value): ${kv}`);
          process.exit(2);
        }
        const key = kv.slice(0, idx).trim();
        const rawValue = kv.slice(idx + 1);
        if (!key) {
          console.error(`Error: --setting key cannot be empty: ${kv}`);
          process.exit(2);
        }
        inlineEdits.push({ key, rawValue });
      }

      const fileEdits = [];
      for (const kv of opts.settingFile || []) {
        const idx = kv.indexOf('=');
        if (idx < 0) {
          console.error(`Error: invalid --setting-file (expected key=path): ${kv}`);
          process.exit(2);
        }
        const key = kv.slice(0, idx).trim();
        const filePath = kv.slice(idx + 1);
        if (!key) {
          console.error(`Error: --setting-file key cannot be empty: ${kv}`);
          process.exit(2);
        }
        let rawValue;
        try {
          rawValue = readFileSync(filePath, 'utf8').trim();
        } catch (error) {
          console.error(`Error reading --setting-file path for "${key}": ${error.message}`);
          process.exit(2);
        }
        fileEdits.push({ key, rawValue });
      }

      const token = resolveToken(opts);
      const component = await fetchComponent(componentId, token, opts.verbose);
      const variablesByName = new Map((component.variables || []).map(v => [v.name, v]));

      const settings = {};
      const coercionErrors = [];
      for (const { key, rawValue } of [...inlineEdits, ...fileEdits]) {
        const result = coerceSettingValue(key, rawValue, variablesByName.get(key));
        if (result.error) {
          coercionErrors.push(result.error);
          continue;
        }
        settings[key] = { values: { default: result.value } };
      }
      if (coercionErrors.length > 0) {
        for (const error of coercionErrors) console.error(`Error: ${error}`);
        process.exit(2);
      }

      const payload = { settings };

      if (fileEdits.length > 0) {
        const formatForDiff = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        for (const { key } of fileEdits) {
          const variable = variablesByName.get(key);
          const currentValue = variable?.values?.default ?? '';
          console.log(`setting: ${key}\n`);
          printDiff(formatForDiff(currentValue), formatForDiff(settings[key].values.default));
          console.log();
        }
        if (inlineEdits.length > 0) {
          console.log(`Also included from --setting (no diff shown): ${inlineEdits.map(({ key, rawValue }) => `${key}=${rawValue}`).join(', ')}\n`);
        }
      }

      if (opts.dryRun) {
        console.log(`PUT /v1/components/${componentId}/settings`);
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      if (fileEdits.length > 0 && !opts.yes) {
        const ok = await confirm(`Apply ${fileEdits.length === 1 ? 'this change' : 'these changes'} to live component ${componentId}? (y/N) `);
        if (!ok) { console.log('Aborted.'); process.exit(0); }
      }

      const res = await apiFetch(`/v1/components/${componentId}/settings`, token, {
        method: 'PUT',
        body: JSON.stringify(payload),
        verbose: opts.verbose,
        baseUrl: API_BASE,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`Error ${res.status}: ${text.slice(0, 500)}`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(text);
        return;
      }

      const updated = Object.keys(settings);
      console.log(`OK  updated ${updated.length} setting(s) on component ${componentId}: ${updated.join(', ')}`);
      console.log(`Note: if this component is on a LIVE campaign, run \`extole components deploy --publish\` (or republish via my.extole) for the change to take effect in production.`);
    });

  addGlobalOptions(setCmd, {
    output: true,
    examples: [
      'extole components set <component-id> --setting apiKey=test_key_123',
      'extole components set <component-id> --setting apiKey=k1 --setting endpoint=https://example.com',
      'extole components set <component-id> --setting apiKey=k1 --dry-run',
      'extole components set <component-id> --setting enabled=false                    # BOOLEAN setting',
      'extole components set <component-id> --setting order=2                          # INTEGER setting',
      `extole components set <component-id> --setting tags='["a","b"]'                  # list/JSON-typed setting`,
      'extole components set <component-id> --setting-file requestScript=request.js',
      'extole components set <component-id> --setting-file requestScript=request.js --yes',
    ],
  });

  // ── download ───────────────────────────────────────────────────────────────

  const downloadCmd = new Command('download')
    .description('Download a campaign bundle and unpack it locally')
    .argument('<campaign-id>', 'Campaign ID to download')
    .option('--output <dir>', 'Output directory (default: sanitized campaign name)')
    .action(async function (campaignId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      process.stderr.write('Downloading campaign bundle...\n');
      const res = await apiFetch(`/v2/campaigns/${campaignId}.zip`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Error ${res.status}: ${text}`);
        process.exit(1);
      }

      const tmpDir = mkdtempSync(join(tmpdir(), 'extole-download-'));
      try {
        const zipPath = join(tmpDir, 'campaign.zip');
        const arrayBuffer = await res.arrayBuffer();
        writeFileSync(zipPath, Buffer.from(arrayBuffer));

        execSync(`unzip -q "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });

        const entries = readdirSync(tmpDir).filter(entry => entry !== 'campaign.zip');
        if (entries.length !== 1) {
          console.error('Unexpected bundle structure: expected single root directory');
          process.exit(1);
        }
        const bundleRoot = join(tmpDir, entries[0]);

        const campaignData = JSON.parse(readFileSync(join(bundleRoot, 'campaign.json'), 'utf8'));
        const creativeIdToName = buildCreativeNameMap(campaignData);

        const outputDir = opts.output || sanitizeDirName(campaignData.name || campaignId);
        if (existsSync(outputDir)) {
          console.error(`Error: output directory already exists: ${outputDir}`);
          process.exit(1);
        }
        mkdirSync(outputDir, { recursive: true });

        writeFileSync(join(outputDir, 'campaign.json'), JSON.stringify(campaignData, null, 2));

        const bundleComponentsDir = join(bundleRoot, 'components');
        if (existsSync(bundleComponentsDir)) {
          for (const compName of readdirSync(bundleComponentsDir)) {
            const srcCompDir = join(bundleComponentsDir, compName);
            const destCompDir = join(outputDir, 'components', compName);
            mkdirSync(destCompDir, { recursive: true });

            const srcAssetsDir = join(srcCompDir, 'assets');
            if (existsSync(srcAssetsDir)) {
              const destAssetsDir = join(destCompDir, 'assets');
              mkdirSync(destAssetsDir, { recursive: true });
              for (const assetName of readdirSync(srcAssetsDir)) {
                const assetSubDir = join(srcAssetsDir, assetName);
                if (statSync(assetSubDir).isDirectory()) {
                  const files = readdirSync(assetSubDir);
                  if (files.length === 1) {
                    copyFileSync(join(assetSubDir, files[0]), join(destAssetsDir, files[0]));
                  }
                } else {
                  copyFileSync(assetSubDir, join(destAssetsDir, assetName));
                }
              }
            }
          }
        }

        const bundleCreativesDir = join(bundleRoot, 'creatives');
        if (existsSync(bundleCreativesDir)) {
          const nonRootComponent = (campaignData.components || []).find(comp => comp.name !== 'root');
          const destCreativesDir = nonRootComponent
            ? join(outputDir, 'components', nonRootComponent.name, 'creatives')
            : join(outputDir, 'creatives');
          mkdirSync(destCreativesDir, { recursive: true });

          for (const creativeFile of readdirSync(bundleCreativesDir)) {
            const numericId = creativeFile.replace('.zip', '');
            const logicalName = creativeIdToName[numericId];
            const outputName = logicalName ? `${logicalName}-${numericId}` : numericId;
            copyFileSync(join(bundleCreativesDir, creativeFile), join(destCreativesDir, `${outputName}.zip`));
          }
        }

        console.log(`Downloaded to: ${outputDir}`);
        console.log(`Campaign: ${campaignData.name} (${campaignData.state})`);
        const creativeCount = Object.keys(creativeIdToName).length;
        if (creativeCount > 0) console.log(`Creatives: ${creativeCount} (named <component>-<archive-id>.zip — IDs are stable unless the campaign is redeployed fresh)`);
        console.log('\nNote: campaign.json preserved as-is. Use for inspection/diffing — not directly deployable via components deploy.');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

  addGlobalOptions(downloadCmd, {
    examples: [
      'extole components download <campaign-id>',
      'extole components download <campaign-id> --output ./my-campaign',
    ],
  });

  components.addCommand(setCmd);
  components.addCommand(downloadCmd);

  return components;
}

function buildCreativeNameMap(campaignData) {
  const creativeIdToName = {};
  for (const step of campaignData.steps || []) {
    for (const action of step.actions || []) {
      if (!action.creative_archive_id) continue;
      const absoluteName = (action.component_references || [])[0]?.absolute_name;
      if (absoluteName) {
        const logicalName = absoluteName.replace(/^\//, '').replace(/\//g, '-').replace(/_/g, '-');
        creativeIdToName[String(action.creative_archive_id)] = logicalName;
      }
    }
  }
  return creativeIdToName;
}

function sanitizeDirName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function processDir(srcDir, destDir, bundleRoot) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      processDir(srcPath, destPath, bundleRoot);
    } else if (entry === 'component.json') {
      let content = readFileSync(srcPath, 'utf8');
      content = content.replace(/%\{([^}]+)\}%/g, (_, filePath) => {
        const abs = join(bundleRoot, filePath.startsWith('/') ? filePath.slice(1) : filePath);
        try {
          return readFileSync(abs, 'utf8')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\r\n/g, '\\n')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\n')
            .replace(/\t/g, '\\t');
        } catch {
          throw new Error(`Cannot resolve include "${filePath}" in ${srcPath}`);
        }
      });
      writeFileSync(destPath, content);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function listDir(dir, root) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      listDir(p, root);
    } else {
      console.log(`  ${p.slice(root.length + 1)}`);
    }
  }
}

function printResolvedBundle(dir, root) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      printResolvedBundle(p, root);
    } else if (entry === 'component.json') {
      const rel = p.slice(root.length + 1);
      console.log(`# ${rel}`);
      try {
        const parsed = JSON.parse(readFileSync(p, 'utf8'));
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(readFileSync(p, 'utf8'));
      }
      console.log();
    }
  }
}
