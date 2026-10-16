import { readFileSync } from 'fs';
import { Command } from 'commander';
import { createInterface } from 'readline';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase() === 'y'); });
  });
}

function formatRow(key) {
  const id = (key.id || '').padEnd(25);
  const type = (key.type || '').padEnd(10);
  const algorithm = (key.algorithm || '').padEnd(18);
  console.log(`${id}  ${type}  ${algorithm}  ${key.name || ''}`);
}

export function keysCommand() {
  const cmd = new Command('keys')
    .description('Manage Security Center client keys — credentials and cryptographic material used by integrations, campaign components, SFTP transfer, and webhooks')
    .option('--tag <tag>', 'Filter to keys carrying this tag (repeatable)', (value, previous) => previous.concat([value]), [])
    .option('--built', 'Show the fully resolved runtime form instead of the raw stored form')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const params = new URLSearchParams();
      for (const tag of opts.tag) params.append('tags', tag);
      const path = opts.built ? '/v2/settings/security/keys/built' : '/v2/settings/security/keys';
      const list = await apiJson(`${path}${params.toString() ? '?' + params : ''}`, token, { verbose: opts.verbose, baseUrl: API_BASE });

      if (opts.json) { printJson(list, opts); return; }
      if (list.length === 0) { console.log('No client keys found.'); return; }

      console.log(`${'id'.padEnd(25)}  ${'type'.padEnd(10)}  ${'algorithm'.padEnd(18)}  name`);
      console.log(`${'─'.repeat(25)}  ${'─'.repeat(10)}  ${'─'.repeat(18)}  ${'─'.repeat(20)}`);
      for (const key of list) formatRow(key);
    });

  addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole keys',
      'extole keys --tag internal:shopify',
      'extole keys --built',
    ],
  });

  // ── create ─────────────────────────────────────────────────────────────────

  const createCmd = new Command('create')
    .description('Create a client key from a JSON request body read from a file or stdin. Never accepts the body as an inline flag, since it carries the key material itself.')
    .requiredOption('--body-file <path>', 'Path to a JSON file with the create request body, or "-" to read from stdin')
    .option('--dry-run', 'Print the parsed request body without creating anything')
    .action(async function (opts) {
      const options = this.optsWithGlobals();
      let text;
      try {
        text = options.bodyFile === '-' ? readFileSync(0, 'utf8') : readFileSync(options.bodyFile, 'utf8');
      } catch (e) {
        console.error(`Error reading ${options.bodyFile}: ${e.message}`);
        process.exit(2);
      }

      let body;
      try { body = JSON.parse(text); } catch (e) {
        console.error(`Error: ${options.bodyFile} is not valid JSON: ${e.message}`);
        process.exit(2);
      }

      if (options.dryRun) {
        printJson(body, options);
        return;
      }

      const token = resolveToken(options);
      const created = await apiJson('/v2/settings/security/keys', token, {
        method: 'POST',
        body: JSON.stringify(body),
        verbose: options.verbose,
        baseUrl: API_BASE,
      });

      if (options.json) { printJson(created, options); return; }
      console.log(`created: ${created.id}  (${created.type}, ${created.algorithm})  ${created.name || ''}`);
    });

  addGlobalOptions(createCmd, {
    output: true,
    examples: [
      'extole keys create --body-file key.json',
      'cat key.json | extole keys create --body-file -',
      'extole keys create --body-file key.json --dry-run',
    ],
  });

  cmd.addCommand(createCmd);

  // ── archive / unarchive / delete ──────────────────────────────────────────

  const archiveCmd = new Command('archive')
    .description('Archive a client key. Retained and restorable with unarchive. Fails if the key is still referenced by a campaign component or other platform resource.')
    .argument('<id>', 'Client key ID')
    .action(async function (id) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const archived = await apiJson(`/v2/settings/security/keys/${id}`, token, { method: 'DELETE', verbose: options.verbose, baseUrl: API_BASE });
      if (options.json) { printJson(archived, options); return; }
      console.log(`archived: ${archived.id}`);
    });

  addGlobalOptions(archiveCmd, { output: true, examples: ['extole keys archive <id>'] });
  cmd.addCommand(archiveCmd);

  const unarchiveCmd = new Command('unarchive')
    .description('Restore a previously archived client key. Fails if another active key already uses the same name.')
    .argument('<id>', 'Client key ID')
    .action(async function (id) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const restored = await apiJson(`/v2/settings/security/keys/${id}/unarchive`, token, { method: 'POST', verbose: options.verbose, baseUrl: API_BASE });
      if (options.json) { printJson(restored, options); return; }
      console.log(`unarchived: ${restored.id}`);
    });

  addGlobalOptions(unarchiveCmd, { output: true, examples: ['extole keys unarchive <id>'] });
  cmd.addCommand(unarchiveCmd);

  const deleteCmd = new Command('delete')
    .description('Permanently delete a client key. Fails if the key is still referenced by a campaign component or other platform resource.')
    .argument('<id>', 'Client key ID')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async function (id) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);

      if (!options.yes) {
        const ok = await confirm(`Permanently delete client key ${id}? This cannot be undone. (y/N) `);
        if (!ok) { console.log('Aborted.'); return; }
      }

      const deleted = await apiJson(`/v2/settings/security/keys/${id}/delete`, token, { method: 'POST', verbose: options.verbose, baseUrl: API_BASE });
      if (options.json) { printJson(deleted, options); return; }
      console.log(`deleted: ${deleted.id}`);
    });

  addGlobalOptions(deleteCmd, { output: true, examples: ['extole keys delete <id> --yes'] });
  cmd.addCommand(deleteCmd);

  return cmd;
}
