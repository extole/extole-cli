import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, SEEN_MAX_SIZE, SEEN_KEEP_SIZE, POLL_INTERVAL_MS, isValidEmail, formatEventTime } from '../utils.js';
import { findPerson, getPersonSteps, getPersonRelationships, getPersonStats } from '../person-api.js';

export function personCommand() {
  const person = new Command('person').description('Look up person profile and step history');

  const getCmd = new Command('get')
    .description('Look up a person by email')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
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
      const [profile, dataEntries] = await Promise.all([
        apiJson(`/v5/persons/${match.id}`, token, { verbose: opts.verbose, baseUrl: API_BASE }),
        apiJson(`/v5/persons/${match.id}/data`, token, { verbose: opts.verbose, baseUrl: API_BASE }).catch(() => ({})),
      ]);
      const data = {};
      for (const [key, entry] of Object.entries(dataEntries)) {
        if (entry?.value != null) data[key] = entry.value;
      }
      printJson({ ...profile, ...(Object.keys(data).length > 0 ? { data } : {}) }, opts);
    });

  addGlobalOptions(getCmd, {
    output: true,
    examples: [
      'extole person get --email jane@example.com',
      'extole person get --email jane@example.com --compact',
    ],
  });

  const stepsCmd = new Command('steps')
    .description('Show step history for a person (use --watch to tail live)')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--limit <n>', 'Number of steps to return (one-shot)', '25')
    .option('--event <event_id>', 'Filter to steps caused by this event ID')
    .option('--watch', 'Poll for new steps until Ctrl+C')
    .option('--duration <seconds>', 'Stop automatically after this many seconds (implies --watch)')
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
      const personId = match.id;

      if (!opts.watch && !opts.duration) {
        const limit = parseInt(opts.limit, 10);
        if (isNaN(limit) || limit <= 0) {
          console.error('--limit must be a positive integer');
          process.exit(2);
        }
        const steps = await getPersonSteps(personId, token, limit, opts.verbose, { causeEventId: opts.event });
        printJson(steps, opts);
        return;
      }

      if (opts.duration) {
        const ms = Math.max(1, Number(opts.duration)) * 1000;
        setTimeout(() => process.exit(0), ms);
      }

      const seen = new Set();
      let errorCount = 0;
      if (!opts.json) console.error(`Watching steps for ${opts.email} — Ctrl+C to stop\n`);

      async function poll() {
        try {
          const steps = await getPersonSteps(personId, token, 50, opts.verbose);
          for (const step of steps.reverse()) {
            if (!seen.has(step.id)) {
              seen.add(step.id);
              if (seen.size > SEEN_MAX_SIZE) {
                const arr = [...seen];
                seen.clear();
                arr.slice(-SEEN_KEEP_SIZE).forEach(id => seen.add(id));
              }
              if (opts.json) {
                printJson(step, opts);
              } else {
                const time = formatEventTime(step.event_date || step.created_date);
                const name = (step.name || '').padEnd(35);
                const program = step.program || '';
                console.log(`${time}  ${name}  ${program}`);
              }
            }
          }
          errorCount = 0;
        } catch (e) {
          console.error(`poll error: ${e.message}`);
          if (++errorCount >= 10) {
            console.error('Too many consecutive poll errors, stopping.');
            process.exit(1);
          }
        }
      }

      async function schedulePoll() {
        await poll();
        setTimeout(schedulePoll, POLL_INTERVAL_MS);
      }
      await schedulePoll();
    });

  addGlobalOptions(stepsCmd, {
    output: true,
    examples: [
      'extole person steps --email jane@example.com',
      'extole person steps --email jane@example.com --event EVENT_ID',
      'extole person steps --email jane@example.com --watch',
      'extole person steps --email jane@example.com --duration 30',
    ],
  });

  const relationshipsCmd = new Command('relationships')
    .description('Show advocate↔friend referral relationships for a person')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
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
      const relationships = await getPersonRelationships(match.id, token, opts.verbose);
      if (opts.json) {
        printJson(relationships, opts);
        return;
      }
      if (!relationships || relationships.length === 0) {
        console.log(`No relationships found for ${opts.email}`);
        return;
      }
      const roleW = 10, programW = 24, personW = 20, channelW = 12;
      console.log(
        'role'.padEnd(roleW) + 'program'.padEnd(programW) +
        'other_person_id'.padEnd(personW) + 'channel'.padEnd(channelW) + 'date'
      );
      console.log('-'.repeat(roleW + programW + personW + channelW + 10));
      for (const r of relationships) {
        const channel = r.data?.channel?.value || r.data?.reason?.value || '';
        const date = (r.created_date || '').slice(0, 10);
        console.log(
          (r.my_role || '').padEnd(roleW) +
          (r.program || '').padEnd(programW) +
          (r.other_person_id || '').padEnd(personW) +
          channel.padEnd(channelW) +
          date
        );
      }
    });

  addGlobalOptions(relationshipsCmd, {
    output: true,
    examples: [
      'extole person relationships --email jane@example.com',
      'extole person relationships --email jane@example.com --json',
    ],
  });

  const statsCmd = new Command('stats')
    .description('Show personal and referral network stats for a person')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
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
      const { stats, networkStats } = await getPersonStats(match.id, token, opts.verbose);
      if (opts.json) {
        printJson({ personal: stats, network: networkStats }, opts);
        return;
      }
      const fmt = (v) => (v != null ? String(v) : '-');
      const labelW = 12, colW = 14;
      const header = ''.padEnd(labelW) + 'aov'.padEnd(colW) + 'ltv'.padEnd(colW) +
        'activities'.padEnd(colW) + 'transactions'.padEnd(colW) + 'conversions';
      console.log(header);
      console.log('-'.repeat(header.length + 4));
      const row = (label, s) =>
        label.padEnd(labelW) +
        fmt(s.aov).padEnd(colW) + fmt(s.ltv).padEnd(colW) +
        fmt(s.activities).padEnd(colW) + fmt(s.transactions).padEnd(colW) +
        fmt(s.conversions);
      console.log(row('personal', stats));
      console.log(row('network', networkStats));
    });

  addGlobalOptions(statsCmd, {
    output: true,
    examples: [
      'extole person stats --email jane@example.com',
      'extole person stats --email jane@example.com --json',
    ],
  });

  person.addCommand(getCmd);
  person.addCommand(stepsCmd);
  person.addCommand(relationshipsCmd);
  person.addCommand(statsCmd);
  return person;
}
