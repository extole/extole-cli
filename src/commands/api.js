import { Command } from 'commander';
import { resolveToken, API_BASE, AUTH_BASE } from '../config.js';
import { apiFetch } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

export function apiCommand() {
  const cmd = new Command('api')
    .description('Make an authenticated API call to any Extole endpoint')
    .argument('<path>', 'API path (e.g. /v2/campaigns/123/controllers)')
    .allowExcessArguments(false)
    .option('--method <method>', 'HTTP method', 'GET')
    .option('--body <json>', 'Request body as JSON string (for POST/PUT/PATCH)')
    .option('--auth-base', 'Use auth base URL (api.extole.com) instead of api.extole.io')
    .action(async function (path) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const baseUrl = opts.authBase ? AUTH_BASE : API_BASE;
      const method = opts.method.toUpperCase();

      const fetchOpts = { method, verbose: opts.verbose, baseUrl };
      if (opts.body) {
        fetchOpts.body = opts.body;
      }

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

  return cmd;
}
