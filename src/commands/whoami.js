import { Command } from 'commander';
import { resolveToken, AUTH_BASE, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

export function whoamiCommand() {
  const cmd = new Command('whoami')
    .description('Verify the current token and show client identity and scopes');
  cmd._mcpDescription = 'Verify the stored token and return full client identity — client_name, client_id, scopes (CLIENT_ADMIN/USER_SUPPORT/CLIENT_SUPERUSER), token type, and days until expiry. Use this (not ping) when you need the client_id or scopes for context, or when a 401/403 error requires diagnosing whether it is a scope issue vs an expired token. ping is faster but returns nothing useful beyond pass/fail.';
  return addGlobalOptions(
    cmd
      .allowExcessArguments(false)
      .action(async function () {
        const options = this.optsWithGlobals();
        const token = resolveToken(options);

        const tokenInfo = await apiJson('/v4/tokens', token, { baseUrl: AUTH_BASE });

        let clientName = null;
        try {
          const clientInfo = await apiJson(`/v4/clients/${tokenInfo.client_id}`, token, { baseUrl: API_BASE });
          clientName = clientInfo?.short_name || clientInfo?.name || null;
        } catch { /* non-fatal */ }

        if (options.json) {
          printJson({ ...tokenInfo, client_name: clientName }, options);
          return;
        }

        if (clientName) console.log(`client:   ${clientName}`);
        console.log(`client_id: ${tokenInfo.client_id}`);
        console.log(`scopes:   ${(tokenInfo.scopes || []).join(', ')}`);
        console.log(`type:     ${tokenInfo.type}`);
        const expiresInDays = tokenInfo.expires_in ? Math.floor(tokenInfo.expires_in / 86400) : null;
        if (expiresInDays !== null) console.log(`expires:  ${expiresInDays} days`);
      }),
    {
      output: true,
      examples: [
        'extole whoami',
        'extole whoami --account acme',
        'extole whoami --json',
      ],
    }
  );
}
