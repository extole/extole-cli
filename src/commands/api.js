import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { resolveToken, API_BASE, AUTH_BASE } from '../config.js';
import { apiFetch } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, fetchWithTimeout } from '../utils.js';

const SPEC_URLS = {
  management: 'https://raw.githubusercontent.com/extole/extole-specification/main/openapi/management.json',
  integration: 'https://raw.githubusercontent.com/extole/extole-specification/main/openapi/integration-server-to-extole.json',
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadSpec(name) {
  const cacheDir = join(homedir(), '.extole');
  const cachePath = join(cacheDir, `spec-cache-${name}.json`);
  const metaPath = join(cacheDir, `spec-cache-${name}.meta`);

  if (existsSync(cachePath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (Date.now() - meta.fetched < CACHE_TTL_MS) {
        return JSON.parse(readFileSync(cachePath, 'utf8'));
      }
    } catch { /* fall through to fetch */ }
  }

  const res = await fetchWithTimeout(SPEC_URLS[name]);
  if (!res.ok) throw new Error(`Failed to fetch ${name} spec: ${res.status}`);
  const text = await res.text();

  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, text);
  writeFileSync(metaPath, JSON.stringify({ fetched: Date.now() }));

  return JSON.parse(text);
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'to', 'for', 'in', 'of', 'by', 'with', 'and', 'or']);

function searchSpec(spec, specName, term) {
  const searchWords = term.toLowerCase().split(/\s+/).filter(word => word && !STOP_WORDS.has(word));
  const results = [];

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const searchText = [path, operation.summary || '', operation.description || '', ...(operation.tags || [])].join(' ').toLowerCase();
      if (searchWords.every(word => searchText.includes(word))) {
        results.push({ method: method.toUpperCase(), path, summary: operation.summary || '', tags: operation.tags || [], description: operation.description || '', spec: specName, operation });
      }
    }
  }

  return results;
}

function printSearchResults(results, { json, detail } = {}) {
  if (json) {
    printJson(results.map(({ method, path, summary, tags, description }) =>
      ({ method, path, summary, tags, description })));
    return;
  }

  if (results.length === 0) {
    console.log('No matching endpoints found.');
    return;
  }

  if (detail && results.length === 1) {
    const match = results[0];
    console.log(`${match.method} ${match.path}  [${match.tags.join(', ')}]`);
    if (match.summary) console.log(`  ${match.summary}`);
    if (match.description && match.description !== match.summary) {
      console.log();
      for (const line of match.description.split('\n')) console.log(`  ${line}`);
    }

    const requestBodySchema = match.operation.requestBody?.content?.['application/json']?.schema;
    if (requestBodySchema) {
      const schemas = match._schemas || {};
      const properties = requestBodySchema.properties || (requestBodySchema.$ref ? (schemas[requestBodySchema.$ref.split('/').pop()] || {}).properties : null);
      if (properties && Object.keys(properties).length) {
        console.log('\nRequest body:');
        for (const [fieldName, fieldDef] of Object.entries(properties)) {
          const fieldType = fieldDef.type || (fieldDef.$ref ? fieldDef.$ref.split('/').pop() : '');
          const fieldDesc = fieldDef.description ? `  — ${fieldDef.description}` : '';
          console.log(`  ${fieldName} (${fieldType})${fieldDesc}`);
        }
      }
    }

    const queryParams = (match.operation.parameters || []).filter(param => param.in !== 'path');
    if (queryParams.length) {
      console.log('\nQuery parameters:');
      for (const param of queryParams) {
        const required = param.required ? ' (required)' : '';
        console.log(`  --${param.name}${required}`);
      }
    }

    console.log(`\nextole api ${match.path}`);
    return;
  }

  const methodColWidth = 7;
  const pathColWidth = Math.min(60, Math.max(...results.map(result => result.path.length)));

  for (const result of results) {
    const methodCol = result.method.padEnd(methodColWidth);
    const pathCol = result.path.padEnd(pathColWidth);
    console.log(`${methodCol} ${pathCol} ${result.summary}`);
  }
  console.log(`\n${results.length} result${results.length === 1 ? '' : 's'}`);
}

export function apiCommand() {
  const search = new Command('search')
    .description('Search Extole API endpoints by keyword')
    .argument('<term>', 'Search term matched against path, summary, description, and tags')
    .option('--spec <name>', 'Limit to one spec: management or integration')
    .option('--detail', 'Show full description and fields (most useful with a single result)')
    .action(async function (term) {
      const { spec: specFilter, detail } = this.opts();
      const opts = this.optsWithGlobals();

      const names = specFilter ? [specFilter] : ['management', 'integration'];
      const unknown = names.filter(n => !SPEC_URLS[n]);
      if (unknown.length) {
        console.error(`Unknown spec "${unknown[0]}". Valid options: management, integration`);
        process.exit(1);
      }

      process.stderr.write('Loading specs...\n');
      const specs = await Promise.all(names.map(n => loadSpec(n).then(s => ({ name: n, spec: s }))));

      const results = specs.flatMap(({ name, spec }) => {
        const matches = searchSpec(spec, name, term);
        matches.forEach(m => { m._schemas = spec.components?.schemas || {}; });
        return matches;
      });

      printSearchResults(results, { json: opts.json, detail });
    });

  addGlobalOptions(search, {
    output: true,
    examples: [
      'extole api search batch',
      'extole api search person data',
      'extole api search reward --spec integration',
      'extole api search webhook --detail',
    ],
  });

  const cmd = new Command('api')
    .description('Make an authenticated API call to any Extole endpoint')
    .argument('<path>', 'API path (e.g. /v2/campaigns/123/controllers)')
    .allowExcessArguments(false)
    .option('--method <method>', 'HTTP method', 'GET')
    .option('--body <json>', 'Request body as JSON string (for POST/PUT/PATCH)')
    .option('--auth-base', 'Use auth base URL (api.extole.com) instead of api.extole.io')
    .enablePositionalOptions()
    .action(async function (path) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const baseUrl = opts.authBase ? AUTH_BASE : API_BASE;
      const method = opts.method.toUpperCase();

      const fetchOpts = { method, verbose: opts.verbose, baseUrl };
      if (opts.body) fetchOpts.body = opts.body;

      const res = await apiFetch(path, token, fetchOpts);
      const text = await res.text();

      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }

      if (!res.ok) {
        console.error(`Error ${res.status}: ${typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : parsed}`);
        process.exit(1);
      }

      printJson(parsed, opts);
    });

  addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole api /v2/campaigns/123/controllers',
      'extole api /v6/webhooks/built',
      'extole api /v2/campaigns/123/publish --method POST --body \'{}\'',
      'extole api /v4/tokens --auth-base',
    ],
  });

  cmd._mcpDescription = 'ESCAPE HATCH — make an authenticated GET (default) or POST/PUT/PATCH request to any Extole endpoint. Use only when no purpose-built tool exists for what you need. Prefer specific tools (person_get, rewards, webhooks, etc.) over this — they have better error handling, structured output, and safer defaults. Do not use this to fire consumer events (use events_fire), manage webhooks (use webhooks_*), or run reports (use reports_run). Valid uses: accessing endpoints not yet covered by other tools, one-off admin calls the user explicitly requests.';

  cmd.addCommand(search);

  return cmd;
}
