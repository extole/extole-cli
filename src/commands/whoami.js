import { Command } from 'commander';
import { resolveToken, AUTH_BASE, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

export function whoamiCommand() {
  return addGlobalOptions(
    new Command('whoami')
      .description('Verify the current token and show client identity and scopes')
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
