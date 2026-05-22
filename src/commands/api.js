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

  return cmd;
}
