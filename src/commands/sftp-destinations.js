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

const LIST_PAGE_SIZE = 100;

async function fetchAllSftpDestinations(token, params, verbose) {
  const all = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ limit: String(LIST_PAGE_SIZE), offset: String(offset), ...params });
    const page = await apiJson(`/v6/sftp-destinations?${qs}`, token, { verbose, baseUrl: API_BASE });
    all.push(...page);
    if (page.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return all;
}

async function fetchSftpDestination(id, token, verbose) {
  return apiJson(`/v6/sftp-destinations/${id}`, token, { verbose, baseUrl: API_BASE });
}

function formatRow(destination) {
  const id = (destination.id || '').padEnd(22);
  const type = (destination.type || '').padEnd(10);
  const name = destination.name || '';
  console.log(`${id}  ${type}  ${name}`);
}

function printDestination(destination) {
  console.log(`id:       ${destination.id}`);
  console.log(`type:     ${destination.type}`);
  console.log(`name:     ${destination.name || ''}`);
  console.log(`host:     ${destination.host}`);
  console.log(`port:     ${destination.port}`);
  console.log(`username: ${destination.username}`);
  if (destination.dropbox_path) console.log(`dropbox:  ${destination.dropbox_path}`);
  if (destination.type === 'LOCAL') {
    console.log(`key_ids:  ${(destination.key_ids || []).join(', ')}`);
    console.log(`file_processing_enabled: ${destination.file_processing_enabled}`);
  } else {
    console.log(`key_id:   ${destination.key_id || ''}`);
  }
  if (destination.partner_key_id) console.log(`partner_key_id: ${destination.partner_key_id}`);
  if (destination.extole_key_id) console.log(`extole_key_id:  ${destination.extole_key_id}`);
  console.log(`created:  ${destination.created_date}`);
  console.log(`updated:  ${destination.updated_date}`);
}

export function sftpDestinationsCommand() {
  const cmd = new Command('sftp-destinations')
    .description('Manage SFTP destination connection profiles used for automated report and file delivery')
    .option('--filter-type <type>', 'Filter by type: LOCAL or EXTERNAL')
    .option('--filter-name <name>', 'Filter by name')
    .option('--filter-username <username>', 'Filter by username')
    .option('--filter-host <host>', 'Filter by host')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const params = {};
      if (opts.filterType) params.type = opts.filterType;
      if (opts.filterName) params.name = opts.filterName;
      if (opts.filterUsername) params.username = opts.filterUsername;
      if (opts.filterHost) params.host = opts.filterHost;

      const list = await fetchAllSftpDestinations(token, params, opts.verbose);

      if (opts.json) { printJson(list, opts); return; }
      if (list.length === 0) { console.log('No SFTP destinations found.'); return; }

      console.log(`${'id'.padEnd(22)}  ${'type'.padEnd(10)}  name`);
      console.log(`${'─'.repeat(22)}  ${'─'.repeat(10)}  ${'─'.repeat(30)}`);
      for (const destination of list) formatRow(destination);
    });

  addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole sftp-destinations',
      'extole sftp-destinations --filter-type LOCAL',
      'extole sftp-destinations --filter-name "Reward Fulfillment"',
    ],
  });

  // ── get ────────────────────────────────────────────────────────────────────

  const getCmd = new Command('get')
    .description('Show full configuration for an SFTP destination')
    .argument('<id>', 'SFTP destination ID')
    .action(async function (id) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const destination = await fetchSftpDestination(id, token, opts.verbose);
      if (opts.json) { printJson(destination, opts); return; }
      printDestination(destination);
    });

  addGlobalOptions(getCmd, {
    output: true,
    examples: ['extole sftp-destinations get <id>'],
  });

  cmd.addCommand(getCmd);

  // ── create ─────────────────────────────────────────────────────────────────

  const createCmd = new Command('create')
    .description('Create an SFTP destination connection profile')
    .requiredOption('--type <type>', 'LOCAL (Extole-hosted) or EXTERNAL (a partner-hosted server)')
    .option('--name <name>', 'Display name')
    .option('--key-id <id>', 'For --type EXTERNAL: the client key used to authenticate to the external server (required)')
    .option('--key-ids <ids>', 'For --type LOCAL: comma-separated client key IDs authorized to connect (required)')
    .option('--partner-key-id <id>', 'Client key used to decrypt files from the partner, if the transfer is encrypted')
    .option('--extole-key-id <id>', "Client key used to encrypt files Extole writes to the partner's directory")
    .option('--username <username>', 'For --type EXTERNAL: the username to authenticate with (required)')
    .option('--dropbox-path <path>', 'Path on the external server to drop files into')
    .option('--host <host>', 'For --type EXTERNAL: the server hostname (required)')
    .option('--port <port>', 'For --type EXTERNAL: the server port (default: 22)')
    .option('--file-processing-enabled <bool>', 'For --type LOCAL: whether dropped files are automatically processed (true/false)')
    .option('--dry-run', 'Print the request payload without creating anything')
    .action(async function (opts) {
      const options = this.optsWithGlobals();
      const type = options.type.toUpperCase();
      if (type !== 'LOCAL' && type !== 'EXTERNAL') {
        console.error('Error: --type must be LOCAL or EXTERNAL.');
        process.exit(2);
      }

      const body = { type };
      if (options.name) body.name = options.name;
      if (options.partnerKeyId) body.partner_key_id = options.partnerKeyId;
      if (options.extoleKeyId) body.extole_key_id = options.extoleKeyId;

      if (type === 'LOCAL') {
        if (!options.keyIds) {
          console.error('Error: --key-ids is required for --type LOCAL.');
          process.exit(2);
        }
        body.key_ids = options.keyIds.split(',').map(id => id.trim());
        if (options.username) body.username = options.username;
        if (options.fileProcessingEnabled) body.file_processing_enabled = options.fileProcessingEnabled === 'true';
      } else {
        if (!options.keyId || !options.username || !options.host) {
          console.error('Error: --key-id, --username, and --host are required for --type EXTERNAL.');
          process.exit(2);
        }
        body.key_id = options.keyId;
        body.username = options.username;
        body.host = options.host;
        if (options.dropboxPath) body.dropbox_path = options.dropboxPath;
        if (options.port) body.port = Number(options.port);
      }

      if (options.dryRun) {
        printJson(body, options);
        return;
      }

      const token = resolveToken(options);
      const created = await apiJson('/v6/sftp-destinations', token, {
        method: 'POST',
        body: JSON.stringify(body),
        verbose: options.verbose,
        baseUrl: API_BASE,
      });

      if (options.json) { printJson(created, options); return; }
      printDestination(created);
    });

  addGlobalOptions(createCmd, {
    output: true,
    examples: [
      'extole sftp-destinations create --type LOCAL --key-ids <key-id> --name "Reward Fulfillment"',
      'extole sftp-destinations create --type EXTERNAL --key-id <key-id> --username partner --host sftp.partner.com',
      'extole sftp-destinations create --type LOCAL --key-ids <key-id> --dry-run',
    ],
  });

  cmd.addCommand(createCmd);

  // ── update ─────────────────────────────────────────────────────────────────

  const updateCmd = new Command('update')
    .description("Update an SFTP destination. Only the fields you pass are changed; the destination's existing type is read automatically.")
    .argument('<id>', 'SFTP destination ID')
    .option('--name <name>', 'Display name')
    .option('--key-id <id>', 'For an EXTERNAL destination: the client key used to authenticate')
    .option('--key-ids <ids>', 'For a LOCAL destination: comma-separated client key IDs authorized to connect')
    .option('--partner-key-id <id>', 'Client key used to decrypt files from the partner')
    .option('--extole-key-id <id>', "Client key used to encrypt files Extole writes to the partner's directory")
    .option('--username <username>', 'For an EXTERNAL destination: the username to authenticate with')
    .option('--dropbox-path <path>', 'Path on the external server to drop files into')
    .option('--host <host>', 'For an EXTERNAL destination: the server hostname')
    .option('--port <port>', 'For an EXTERNAL destination: the server port')
    .option('--file-processing-enabled <bool>', 'For a LOCAL destination: whether dropped files are automatically processed (true/false)')
    .option('--dry-run', 'Print the request payload without updating anything')
    .action(async function (id) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const existing = await fetchSftpDestination(id, token, options.verbose);

      const body = { type: existing.type };
      if (options.name) body.name = options.name;
      if (options.partnerKeyId) body.partner_key_id = options.partnerKeyId;
      if (options.extoleKeyId) body.extole_key_id = options.extoleKeyId;

      if (existing.type === 'LOCAL') {
        if (options.keyId || options.username || options.host || options.port || options.dropboxPath) {
          console.error('Error: --key-id, --username, --host, --port, and --dropbox-path only apply to an EXTERNAL destination.');
          process.exit(2);
        }
        if (options.keyIds) body.key_ids = options.keyIds.split(',').map(keyId => keyId.trim());
        if (options.fileProcessingEnabled) body.file_processing_enabled = options.fileProcessingEnabled === 'true';
      } else {
        if (options.keyIds || options.fileProcessingEnabled) {
          console.error('Error: --key-ids and --file-processing-enabled only apply to a LOCAL destination.');
          process.exit(2);
        }
        if (options.keyId) body.key_id = options.keyId;
        if (options.username) body.username = options.username;
        if (options.host) body.host = options.host;
        if (options.port) body.port = Number(options.port);
        if (options.dropboxPath) body.dropbox_path = options.dropboxPath;
      }

      if (options.dryRun) {
        printJson(body, options);
        return;
      }

      const updated = await apiJson(`/v6/sftp-destinations/${id}`, token, {
        method: 'PUT',
        body: JSON.stringify(body),
        verbose: options.verbose,
        baseUrl: API_BASE,
      });

      if (options.json) { printJson(updated, options); return; }
      printDestination(updated);
    });

  addGlobalOptions(updateCmd, {
    output: true,
    examples: [
      'extole sftp-destinations update <id> --name "New Name"',
      'extole sftp-destinations update <id> --key-ids <key-id-1>,<key-id-2>',
    ],
  });

  cmd.addCommand(updateCmd);

  // ── delete ─────────────────────────────────────────────────────────────────

  const deleteCmd = new Command('delete')
    .description('Delete an SFTP destination')
    .argument('<id>', 'SFTP destination ID')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async function (id) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);

      if (!options.yes) {
        const ok = await confirm(`Delete SFTP destination ${id}? (y/N) `);
        if (!ok) { console.log('Aborted.'); return; }
      }

      const deleted = await apiJson(`/v6/sftp-destinations/${id}`, token, {
        method: 'DELETE',
        verbose: options.verbose,
        baseUrl: API_BASE,
      });

      if (options.json) { printJson(deleted, options); return; }
      console.log(`deleted: ${deleted.id}`);
    });

  addGlobalOptions(deleteCmd, {
    output: true,
    examples: ['extole sftp-destinations delete <id> --yes'],
  });

  cmd.addCommand(deleteCmd);

  // ── validate ───────────────────────────────────────────────────────────────

  const validateCmd = new Command('validate')
    .description('Test connectivity for an SFTP destination without persisting any changes. EXTERNAL destinations only.')
    .argument('<id>', 'SFTP destination ID')
    .action(async function (id) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const result = await apiJson(`/v6/sftp-destinations/${id}/validate`, token, {
        method: 'POST',
        verbose: options.verbose,
        baseUrl: API_BASE,
      });
      if (options.json) { printJson(result, options); return; }
      console.log(`status: ${result.status}`);
      if (result.reason) console.log(`reason: ${result.reason}`);
    });

  addGlobalOptions(validateCmd, {
    output: true,
    examples: ['extole sftp-destinations validate <id>'],
  });

  cmd.addCommand(validateCmd);

  // ── sync ───────────────────────────────────────────────────────────────────

  const syncCmd = new Command('sync')
    .description('Trigger an immediate sync with the external server')
    .argument('<id>', 'SFTP destination ID')
    .action(async function (id) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const result = await apiJson(`/v6/sftp-destinations/${id}/sync`, token, {
        method: 'POST',
        verbose: options.verbose,
        baseUrl: API_BASE,
      });
      if (options.json) { printJson(result, options); return; }
      printDestination(result);
    });

  addGlobalOptions(syncCmd, {
    output: true,
    examples: ['extole sftp-destinations sync <id>'],
  });

  cmd.addCommand(syncCmd);

  // ── entries ────────────────────────────────────────────────────────────────

  const entriesCmd = new Command('entries')
    .description("List files and directories under a path in an SFTP destination's home. Auto-paginates.")
    .argument('<id>', 'SFTP destination ID')
    .option('--path <path>', 'Path relative to the destination root (default: root)')
    .option('--entry-type <type>', 'Filter to ALL (default), DIRECTORY, or FILE')
    .action(async function (id) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);

      const entries = [];
      let offsetToken;
      for (;;) {
        const params = { limit: '1000' };
        if (options.path) params.path = options.path;
        if (options.entryType) params.type = options.entryType;
        if (offsetToken) params.offset_token = offsetToken;
        const page = await apiJson(`/v6/sftp-destinations/${id}/entries?${new URLSearchParams(params)}`, token, { verbose: options.verbose, baseUrl: API_BASE });
        entries.push(...page.entries);
        offsetToken = page.offset_token;
        if (!offsetToken) break;
      }

      if (options.json) { printJson(entries, options); return; }
      if (entries.length === 0) { console.log('No entries found.'); return; }

      for (const entry of entries) {
        const size = entry.size != null ? `  ${entry.size}b` : '';
        console.log(`${entry.type.padEnd(10)}  ${entry.path}${size}`);
      }
    });

  addGlobalOptions(entriesCmd, {
    output: true,
    examples: [
      'extole sftp-destinations entries <id>',
      'extole sftp-destinations entries <id> --path dropbox',
      'extole sftp-destinations entries <id> --entry-type FILE',
    ],
  });

  cmd.addCommand(entriesCmd);

  return cmd;
}
