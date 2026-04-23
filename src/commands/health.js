import { Command } from 'commander';
import { resolveToken, PERSON_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

const PASS = '\x1b[32m●\x1b[0m';
const FAIL = '\x1b[31m●\x1b[0m';
const SKIP = '\x1b[90m●\x1b[0m';

function dot(status) {
  if (status === 'PASS') return PASS;
  if (status === 'FAIL') return FAIL;
  return SKIP;
}

function checkLine(label, check) {
  if (!check) return;
  const labelCol = label.padEnd(8);
  const statusCol = (check.domain_validation_status || '').padEnd(5);
  const reason = check.reason || check.record || '';
  console.log(`    ${dot(check.domain_validation_status)}  ${labelCol}  ${statusCol}  ${reason}`);
}

async function fetchEmailDomains(token, verbose) {
  return apiJson('/v4/email-domains', token, { verbose, baseUrl: PERSON_BASE });
}

async function fetchEmailDomainValidation(id, token, verbose) {
  return apiJson(`/v4/email-domains/${id}/validate`, token, { verbose, baseUrl: PERSON_BASE });
}

async function fetchPrograms(token, verbose) {
  return apiJson('/v2/programs', token, { verbose, baseUrl: PERSON_BASE });
}

async function fetchProgramDomainValidation(programId, token, verbose) {
  return apiJson(`/v2/programs/${programId}/validate`, token, { verbose, baseUrl: PERSON_BASE });
}

export function healthCommand() {
  const healthCmd = new Command('health')
    .description('Check domain and email deliverability health for the account. Validates email domains (SPF, DMARC, DKIM, MX, A) and program domains (CNAME/A). All checks are read-only — nothing is created.')
    .option('--domain <domain>', 'Filter to a specific email domain (substring match)')
    .option('--program <id>', 'Validate a specific program domain by program ID')
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
        if (!opts.json) console.log('\n  email domains\n');

        for (const d of filtered) {
          const v = await fetchEmailDomainValidation(d.id, token, opts.verbose);
          results.email_domains.push({ domain: d.domain, validation: v });

          if (!opts.json) {
            const overall = dot(v.domain_validation_status);
            console.log(`  ${overall}  ${d.domain}`);
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

            if (v.domain_validation_status === 'FAIL') anyFail = true;
            console.log();
          }
        }
      } else if (!opts.json && !opts.program) {
        console.log('\n  email domains\n  (none configured)\n');
      }

      // ── Program domains ──────────────────────────────────────────────────
      let programs = [];
      if (opts.program) {
        programs = [{ program_id: opts.program, name: opts.program, domain: null }];
      } else {
        const progData = await fetchPrograms(token, opts.verbose);
        programs = Array.isArray(progData) ? progData : (progData.programs || []);
      }

      const programsWithDomains = programs.filter(p => p.domain || opts.program);

      if (programsWithDomains.length > 0) {
        if (!opts.json) console.log('  program domains\n');

        for (const p of programsWithDomains) {
          const id = p.program_id || p.id;
          const v = await fetchProgramDomainValidation(id, token, opts.verbose);
          results.program_domains.push({ program_id: id, name: p.name, validation: v });

          if (!opts.json) {
            const status = v.domain_validation_status;
            const domain = v.program_domain || p.domain || id;
            const resolved = v.canonical_name ? ` → ${v.canonical_name}` : '';
            console.log(`  ${dot(status)}  ${domain}${resolved}`);
            if (v.reason) console.log(`        ${v.reason}`);
            if (status === 'FAIL') anyFail = true;
          }
        }
        if (!opts.json) console.log();
      }

      if (opts.json) { printJson(results, opts); return; }
      if (anyFail) process.exit(1);
    });

  addGlobalOptions(healthCmd, {
    output: true,
    examples: [
      'extole health',
      'extole health --domain example.com',
      'extole health --program <program-id>',
      'extole health --json',
    ],
  });

  return healthCmd;
}
