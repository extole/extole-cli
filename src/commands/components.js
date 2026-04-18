import { Command } from 'commander';
import { resolveToken, PERSON_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

async function fetchAllComponents(token, params, verbose) {
  const qs = new URLSearchParams({ limit: '500', ...params });
  return apiJson(`/v1/components?${qs}`, token, { verbose, baseUrl: PERSON_BASE });
}

async function fetchComponent(id, token, verbose) {
  return apiJson(`/v1/components/${id}`, token, { verbose, baseUrl: PERSON_BASE });
}

async function fetchComponentTree(id, token, verbose) {
  return apiJson(`/v1/components/${id}/tree`, token, { verbose, baseUrl: PERSON_BASE });
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

function renderTreeNode(node, prefix) {
  for (const [key, val] of Object.entries(node)) {
    if (key === '.' || typeof val !== 'object' || val === null) continue;
    const dot = val['.'] || {};
    const type = (dot.types || [])[0] || '?';
    const name = dot.display_name || dot.name || key;
    const id = dot.id ? `  ${dot.id}` : '';
    console.log(`${prefix}${name}  (${type})${id}`);
    const children = Object.fromEntries(
      Object.entries(val).filter(([k, v]) => k !== '.' && typeof v === 'object' && v !== null)
    );
    if (Object.keys(children).length > 0) renderTreeNode(children, prefix + '  ');
  }
}

export function componentsCommand() {
  const components = new Command('components')
    .description('Browse and inspect Extole components')
    .option('--program <id>', 'Filter by program (campaign) ID')
    .option('--type <type>', 'Filter by component type (matches parent types and subtypes)')
    .option('--name <substr>', 'Filter by name substring (case-insensitive)')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const params = {};
      if (opts.program) params.campaign_id = opts.program;

      let list = await fetchAllComponents(token, params, opts.verbose);

      if (opts.type) list = list.filter(c => matchesType(c, opts.type));
      if (opts.name) {
        const q = opts.name.toLowerCase();
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
      'extole components --type reward-supplier',
      'extole components --name "gift card"',
    ],
  });

  // ── get ────────────────────────────────────────────────────────────────────

  const getCmd = new Command('get')
    .description('Show full configuration for a component')
    .argument('<component-id>', 'Component ID')
    .option('--tree', 'Show downstream subtree')
    .option('--sockets', 'Show socket references to other components')
    .action(async (componentId, opts) => {
      const token = resolveToken(opts);

      if (opts.tree) {
        const tree = await fetchComponentTree(componentId, token, opts.verbose);
        if (opts.json) { printJson(tree, opts); return; }
        const rootVal = Object.values(tree)[0] || {};
        const dot = rootVal['.'] || {};
        const name = dot.display_name || dot.name || componentId;
        const type = (dot.types || [])[0] || '?';
        console.log(`${name}  (${type})  ${componentId}`);
        renderTreeNode(rootVal, '  ');
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
    .action(async (opts) => {
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

  return components;
}
