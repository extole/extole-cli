import { Command } from 'commander';
import { createInterface } from 'readline';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

const PASS = '\x1b[32m●\x1b[0m';
const WARN = '\x1b[33m●\x1b[0m';
const FAIL = '\x1b[31m●\x1b[0m';
const SKIP = '\x1b[90m●\x1b[0m';

function dot(status) {
  if (status === 'PASS') return PASS;
  if (status === 'FAIL') return FAIL;
  return SKIP;
}

function emailDomainDot(v) {
  if (v.domain_validation_status === 'FAIL') return FAIL;
  const subStatuses = [
    v.spf?.domain_validation_status,
    v.dmarc?.domain_validation_status,
    v.mx?.domain_validation_status,
    v.a?.domain_validation_status,
    ...(v.dkim || []).map(k => k.domain_validation_status),
  ];
  if (subStatuses.some(s => s === 'FAIL')) return WARN;
  return PASS;
}

function emailDomainLabel(v) {
  if (v.domain_validation_status === 'FAIL') return '  Extole will not send from this domain';
  const subStatuses = [
    v.spf?.domain_validation_status,
    v.dmarc?.domain_validation_status,
    v.mx?.domain_validation_status,
    v.a?.domain_validation_status,
    ...(v.dkim || []).map(k => k.domain_validation_status),
  ];
  if (subStatuses.some(s => s === 'FAIL')) {
    if (v.dmarc?.domain_validation_status === 'PASS') return '  DMARC pass — Extole will send from this domain; flagged issues above should still be resolved';
    return '  Extole will send from this domain, but sub-record failures should be investigated';
  }
  return '';
}

function checkLine(label, check) {
  if (!check) return;
  const labelCol = label.padEnd(8);
  const statusCol = (check.domain_validation_status || '').padEnd(5);
  const reason = check.reason || check.record || '';
  console.log(`    ${dot(check.domain_validation_status)}  ${labelCol}  ${statusCol}  ${reason}`);
}

async function fetchEmailDomains(token, verbose) {
  return apiJson('/v4/email-domains', token, { verbose, baseUrl: API_BASE });
}

async function fetchEmailDomainValidation(id, token, verbose) {
  return apiJson(`/v4/email-domains/${id}/validate`, token, { verbose, baseUrl: API_BASE });
}

async function generateDkimRecords(id, token, verbose) {
  return apiJson(`/v4/email-domains/${id}/generate-dkim-records`, token, {
    method: 'POST',
    verbose,
    baseUrl: API_BASE,
  });
}

async function fetchPrograms(token, verbose) {
  return apiJson('/v2/programs', token, { verbose, baseUrl: API_BASE });
}

async function fetchProgramDomainValidation(programId, token, verbose) {
  return apiJson(`/v2/programs/${programId}/validate`, token, { verbose, baseUrl: API_BASE });
}

export function healthCommand() {
  const healthCmd = new Command('health')
    .description('Check domain and email deliverability health for the account. Validates email domains (SPF, DMARC, DKIM, MX, A) and program domains (CNAME/A). All checks are read-only — nothing is created.')
    .option('--domain <domain>', 'Filter to a specific email domain (substring match)')
    .enablePositionalOptions()
    .action(async (opts) => {
      const token = resolveToken(opts);
      const results = { email_domains: [], program_domains: [] };
      let anyFail = false;

      // ── Email domains ────────────────────────────────────────────────────
      const emailDomains = await fetchEmailDomains(token, opts.verbose);
      const domainList = Array.isArray(emailDomains) ? emailDomains : (emailDomains.email_domains || []);

      const filtered = opts.domain
        ? domainList.filter(d => (d.domain || '').toLowerCase().includes(opts.domain.toLowerCase()))
        : domainList;

      if (filtered.length > 0) {
        if (!opts.json) console.log('\n\x1b[1mEmail Domains\x1b[0m\n');

        const emailValidations = await Promise.all(
          filtered.map(d => fetchEmailDomainValidation(d.id, token, opts.verbose))
        );

        for (let i = 0; i < filtered.length; i++) {
          const d = filtered[i];
          const v = emailValidations[i];
          if (v.domain_validation_status === 'FAIL') anyFail = true;
          results.email_domains.push({ domain: d.domain, validation: v });

          if (!opts.json) {
            const overall = dot(v.domain_validation_status);
            const label = emailDomainLabel(v);
            console.log(`  ${overall}  ${d.domain}${label}`);
            checkLine('SPF',   v.spf);
            checkLine('DMARC', v.dmarc);

            if (v.dkim?.length) {
              const passing = v.dkim.filter(k => k.domain_validation_status === 'PASS').length;
              const total = v.dkim.length;
              const dkimStatus = passing === total ? 'PASS' : 'FAIL';
              const dkimReasons = v.dkim.filter(k => k.reason).map(k => k.reason).join('; ');
              console.log(`    ${dot(dkimStatus)}  ${'DKIM'.padEnd(8)}  ${dkimStatus.padEnd(5)}  ${passing}/${total} records passing${dkimReasons ? ' — ' + dkimReasons : ''}`);
            }

            checkLine('MX',    v.mx);
            checkLine('A',     v.a);

            if (v.sendgrid) checkLine('SendGrid', v.sendgrid);
            console.log();
          }
        }
      } else if (!opts.json) {
        console.log('\n\x1b[1mEmail Domains\x1b[0m\n  (none configured)\n');
      }

      // ── Program domains ──────────────────────────────────────────────────
      const progData = await fetchPrograms(token, opts.verbose);
      const programs = Array.isArray(progData) ? progData : (progData.programs || []);
      const programsWithDomains = programs.filter(p => p.domain);

      if (programsWithDomains.length > 0) {
        if (!opts.json) console.log('\x1b[1mProgram Domains\x1b[0m\n');

        const programValidations = await Promise.all(
          programsWithDomains.map(p => fetchProgramDomainValidation(p.program_id || p.id, token, opts.verbose))
        );

        for (let i = 0; i < programsWithDomains.length; i++) {
          const p = programsWithDomains[i];
          const id = p.program_id || p.id;
          const v = programValidations[i];
          if (v.domain_validation_status === 'FAIL') anyFail = true;
          results.program_domains.push({ program_id: id, name: p.name, validation: v });

          if (!opts.json) {
            const status = v.domain_validation_status;
            const domain = v.program_domain || p.domain || id;
            const resolved = v.canonical_name ? ` → ${v.canonical_name}` : status === 'FAIL' ? ' → (not resolving)' : '';
            console.log(`  ${dot(status)}  ${domain}${resolved}`);
            if (v.reason) console.log(`        ${v.reason}`);
          }
        }
      }

      if (opts.json) { printJson({ status: anyFail ? 'FAIL' : 'PASS', ...results }, opts); return; }
      if (anyFail) process.exit(1);
    });

  healthCmd.addHelpText('after', '\nExit Codes:\n  0  all checks pass\n  1  one or more checks failed\n  2  bad input or authentication error');

  addGlobalOptions(healthCmd, {
    output: true,
    examples: [
      'extole health',
      'extole health --domain example.com',
      'extole health --json',
    ],
  });

  // ── health provision-dkim ────────────────────────────────────────────────
  // Provisions DKIM for an email domain via SendGrid. Backend uses get-or-
  // create semantics: the FIRST call on a never-provisioned domain mints
  // new DKIM keys; subsequent calls return existing ones. Existing DKIM
  // status is visible via `extole health` — this command is the writer.

  const dkimCmd = new Command('provision-dkim')
    .description('Provision (mint via SendGrid) or fetch DKIM CNAME records for an email domain. First call on a fresh domain mints new keys; subsequent calls return existing. Use `extole health` to see current DKIM status without writing.')
    .argument('<domain>', 'Email domain (substring match) or email-domain ID')
    .option('--confirm', 'Skip the interactive confirmation prompt (required in non-interactive contexts)')
    .action(async function (domainArg) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      // Resolve the argument to an email domain ID
      const domainList = await fetchEmailDomains(token, opts.verbose);
      const all = Array.isArray(domainList) ? domainList : (domainList.email_domains || []);
      let target = all.find(d => d.id === domainArg);
      if (!target) {
        const matches = all.filter(d => (d.domain || '').toLowerCase().includes(domainArg.toLowerCase()));
        if (matches.length === 0) {
          console.error(`No email domain matched "${domainArg}".`);
          process.exit(1);
        }
        if (matches.length > 1) {
          console.error(`Multiple email domains match "${domainArg}":`);
          for (const m of matches) console.error(`  ${m.id}  ${m.domain}`);
          console.error('Use a more specific substring or pass the email-domain ID.');
          process.exit(2);
        }
        target = matches[0];
      }

      if (!opts.confirm) {
        if (!process.stdin.isTTY) {
          console.error('Aborted: --confirm required in non-interactive contexts (no TTY for prompt).');
          process.exit(1);
        }
        console.log(`About to provision DKIM for ${target.domain} (${target.id}).`);
        console.log(`  - if DKIM is already provisioned → returns existing records (no-op on SendGrid)`);
        console.log(`  - if not yet provisioned → mints new DKIM keys via SendGrid (one-time write)`);
        const answer = await new Promise(res => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question('\nProceed? [y/N] ', ans => { rl.close(); res(ans.trim().toLowerCase()); });
        });
        if (answer !== 'y' && answer !== 'yes') {
          console.log('Cancelled.');
          return;
        }
      }

      const result = await generateDkimRecords(target.id, token, opts.verbose);
      const records = (result && result.records) || [];

      if (opts.json) {
        printJson({ email_domain_id: target.id, domain: target.domain, records }, opts);
        return;
      }

      if (records.length === 0) {
        console.log(`No DKIM records returned for ${target.domain} (${target.id}).`);
        return;
      }

      console.log(`DKIM CNAME records for ${target.domain} (${target.id}):\n`);
      const aliasW = Math.max(20, ...records.map(r => (r.alias || '').length));
      console.log(`${'name (alias)'.padEnd(aliasW)}  value (canonical_name)`);
      console.log(`${'─'.repeat(aliasW)}  ${'─'.repeat(50)}`);
      for (const r of records) {
        console.log(`${(r.alias || '').padEnd(aliasW)}  ${r.canonical_name || ''}`);
      }
      console.log(`\nAdd these as CNAME records in your DNS provider, then re-run \`extole health --domain ${target.domain}\` to verify.`);
    });

  addGlobalOptions(dkimCmd, {
    output: true,
    examples: [
      'extole health provision-dkim example.com             # interactive; prompts before calling',
      'extole health provision-dkim example.com --confirm   # non-interactive; calls without prompting',
      'extole health provision-dkim example.com --confirm --json',
    ],
  });

  healthCmd.addCommand(dkimCmd);

  return healthCmd;
}
