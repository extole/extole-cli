import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, isValidEmail } from '../utils.js';
import { findPerson } from '../person-api.js';

// Extract a share code from either a raw code or a full share URL.
// Examples:
//   "chrisbackfillcw214"                                          -> "chrisbackfillcw214"
//   "https://demo-data-finserv.extole.io/chrisbackfillcw214"      -> "chrisbackfillcw214"
//   "https://demo-data-finserv.extole.io/chrisbackfillcw214?x=1"  -> "chrisbackfillcw214"
function extractCode(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const last = url.pathname.split('/').filter(Boolean).pop();
    return last || '';
  } catch {
    return raw;
  }
}

export function shareLinksCommand() {
  const cmd = new Command('share-links')
    .description('Look up share links by person (list) or by code/URL (lookup)');

  // ── list ────────────────────────────────────────────────────────────────
  const listCmd = new Command('list')
    .description('List share links owned by a person')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--label <label>', 'Filter by label')
    .action(async function () {
      const opts = this.optsWithGlobals();
      if (!isValidEmail(opts.email)) {
        console.error('Error: --email must be a valid email address.');
        process.exit(2);
      }

      const token = resolveToken(opts);
      const match = await findPerson(opts.email, token, opts.verbose);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }

      const all = await apiJson(`/v5/persons/${match.id}/shareables`, token, { verbose: opts.verbose, baseUrl: API_BASE });

      if (!Array.isArray(all) || all.length === 0) {
        console.error(`No share links found for ${opts.email} (person ID: ${match.id})`);
        return;
      }

      const links = opts.label
        ? all.filter(s => s.label === opts.label || s.key === opts.label)
        : all;

      if (links.length === 0) {
        console.error(`No share links found for ${opts.email} with label=${opts.label}`);
        return;
      }

      if (opts.json) {
        printJson(links, opts);
        return;
      }

      const labelW = Math.max(5, ...links.map(s => (s.label || '').length));
      const codeW  = Math.max(4, ...links.map(s => (s.code  || '').length));

      console.log(
        'label'.padEnd(labelW) + '  ' +
        'code'.padEnd(codeW)   + '  ' +
        'link'
      );
      console.log('─'.repeat(labelW) + '  ' + '─'.repeat(codeW) + '  ' + '─'.repeat(40));

      for (const s of links) {
        console.log(
          (s.label || '').padEnd(labelW) + '  ' +
          (s.code  || '').padEnd(codeW)  + '  ' +
          (s.link  || '')
        );
      }
    });

  addGlobalOptions(listCmd, {
    output: true,
    examples: [
      'extole share-links list --email jane@example.com',
      'extole share-links list --email jane@example.com --label credit-cards',
      'extole share-links list --email jane@example.com --json',
    ],
  });

  // ── lookup ──────────────────────────────────────────────────────────────
  const lookupCmd = new Command('lookup')
    .description('Reverse-lookup: given a share code or full share URL, return the owning person')
    .allowExcessArguments(false)
    .argument('<code-or-url>', 'Share code (e.g. "chrisbackfillcw214") or full URL')
    .action(async function (codeOrUrl) {
      const opts = this.optsWithGlobals();
      const code = extractCode(codeOrUrl);
      if (!code) {
        console.error('Error: could not extract a share code from input.');
        process.exit(2);
      }

      const token = resolveToken(opts);
      let shareable;
      try {
        shareable = await apiJson(`/v3/shareables/${encodeURIComponent(code)}`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      } catch (e) {
        if (String(e.message || '').includes('shareable_not_found')) {
          console.error(`No share link found for code "${code}".`);
          process.exit(1);
        }
        throw e;
      }

      // The shareable's person_id is a *profile* record. Follow the identity
      // chain (/v5/persons/{id} returns identity_id + identity_key_value) so
      // the operator sees the email up front and knows which person_id to
      // use for downstream person commands.
      let identity = null;
      if (shareable.person_id) {
        try {
          identity = await apiJson(`/v5/persons/${shareable.person_id}`, token, { verbose: opts.verbose, baseUrl: API_BASE });
        } catch { /* surface what we have */ }
      }

      if (opts.json) {
        printJson({ ...shareable, identity }, opts);
        return;
      }

      console.log(`code:           ${shareable.code || code}`);
      if (shareable.label)            console.log(`label:          ${shareable.label}`);
      if (shareable.link)             console.log(`link:           ${shareable.link}`);
      if (shareable.person_id)        console.log(`profile_id:     ${shareable.person_id}`);
      if (identity?.identity_id)      console.log(`identity_id:    ${identity.identity_id}`);
      if (identity?.identity_key_value) {
        const k = identity.identity_key || 'id';
        console.log(`${k.padEnd(15)} ${identity.identity_key_value}`);
      }
    });

  addGlobalOptions(lookupCmd, {
    output: true,
    examples: [
      'extole share-links lookup chrisbackfillcw214',
      'extole share-links lookup https://demo-data-finserv.extole.io/chrisbackfillcw214',
      'extole share-links lookup chrisbackfillcw214 --json',
    ],
  });

  listCmd._mcpDescription = 'List share links for a person by email. Returns each share link\'s label, code, and full URL. Use --label to filter when a person has links across multiple programs. Use share-links_lookup with a code to go the other direction — from a code to its owner.';
  lookupCmd._mcpDescription = 'Reverse lookup: given a share code or full share URL, return the owning person\'s email, person_id, and program. Use when you have a code from analytics, a webhook payload, or a customer report and need to identify who it belongs to. Accepts the full URL or just the code fragment.';

  cmd.addCommand(listCmd);
  cmd.addCommand(lookupCmd);
  return addGlobalOptions(cmd, { output: true });
}
