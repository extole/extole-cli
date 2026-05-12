import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, SEEN_MAX_SIZE, SEEN_KEEP_SIZE, POLL_INTERVAL_MS, isValidEmail, formatEventTime } from '../utils.js';
import { findPerson, getPersonSteps } from '../person-api.js';

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

      if (!opts.watch) {
        const limit = parseInt(opts.limit, 10);
        if (isNaN(limit) || limit <= 0) {
          console.error('--limit must be a positive integer');
          process.exit(2);
        }
        const steps = await getPersonSteps(personId, token, limit, opts.verbose, { causeEventId: opts.event });
        printJson(steps, opts);
        return;
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
    ],
  });

  person.addCommand(getCmd);
  person.addCommand(stepsCmd);
  return person;
}
