import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { pipeline } from 'node:stream/promises';
import { apiJson, apiFetch } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, SEEN_MAX_SIZE, SEEN_KEEP_SIZE, POLL_INTERVAL_MS, isValidEmail, formatEventTime } from '../utils.js';
import { findPerson, findPersonById, getPersonSteps, getPersonRelationships, getPersonStats } from '../person-api.js';
import { formatReward, VALID_REWARD_STATES } from './rewards.js';
import { pollUntilDone } from './reports.js';

export function personCommand() {
  const person = new Command('person').description('Look up person profile and step history');

  const getCmd = new Command('get')
    .description('Look up a person by email or person ID')
    .allowExcessArguments(false)
    .option('--email <email>', 'Email address to look up')
    .option('--id <person_id>', 'Person ID to look up')
    .action(async function () {
      const opts = this.optsWithGlobals();
      if (!opts.email && !opts.id) {
        console.error('Error: --email or --id is required.');
        process.exit(2);
      }
      if (opts.email && !isValidEmail(opts.email)) {
        console.error('Error: --email must be a valid email address.');
        process.exit(2);
      }
      const token = resolveToken(opts);
      let personId;
      if (opts.id) {
        personId = opts.id;
      } else {
        const match = await findPerson(opts.email, token, opts.verbose);
        if (!match) {
          console.error(`No person found for ${opts.email}`);
          process.exit(1);
        }
        personId = match.id;
      }
      const [profile, dataEntries] = await Promise.all([
        apiJson(`/v5/persons/${personId}`, token, { verbose: opts.verbose, baseUrl: API_BASE }),
        apiJson(`/v5/persons/${personId}/data`, token, { verbose: opts.verbose, baseUrl: API_BASE }).catch(() => ({})),
      ]);
      if (!profile || profile.http_status_code >= 400) {
        console.error(`No person found for id ${personId}`);
        process.exit(1);
      }
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
      'extole person get --id 7336046528487947354',
      'extole person get --email jane@example.com --compact',
    ],
  });

  const stepsCmd = new Command('steps')
    .description('Show step history for a person (use --listen to tail live)')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--limit <n>', 'Number of steps to return (one-shot)', '25')
    .option('--event <event_id>', 'Filter to steps caused by this event ID')
    .option('--listen', 'Poll for new steps until Ctrl+C')
    .option('--duration <seconds>', 'Stop automatically after this many seconds (implies --listen)')
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

      if (!opts.listen && !opts.duration) {
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
        const durationMs = Math.max(1, Number(opts.duration)) * 1000;
        setTimeout(() => process.exit(0), durationMs);
      }

      const seen = new Set();
      let errorCount = 0;
      if (!opts.json) console.error(`Listening for steps for ${opts.email} — Ctrl+C to stop\n`);

      async function poll() {
        try {
          const steps = await getPersonSteps(personId, token, 50, opts.verbose, { causeEventId: opts.event });
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
        } catch (error) {
          console.error(`poll error: ${error.message}`);
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
      'extole person steps --email jane@example.com --listen',
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
      const roleColumnWidth = 10, programColumnWidth = 24, personColumnWidth = 20, channelColumnWidth = 12;
      console.log(
        'role'.padEnd(roleColumnWidth) + 'program'.padEnd(programColumnWidth) +
        'other_person_id'.padEnd(personColumnWidth) + 'channel'.padEnd(channelColumnWidth) + 'date'
      );
      console.log('-'.repeat(roleColumnWidth + programColumnWidth + personColumnWidth + channelColumnWidth + 10));
      for (const relationship of relationships) {
        const channel = relationship.data?.channel?.value || relationship.data?.reason?.value || '';
        const date = (relationship.created_date || '').slice(0, 10);
        console.log(
          (relationship.my_role || '').padEnd(roleColumnWidth) +
          (relationship.program || '').padEnd(programColumnWidth) +
          (relationship.other_person_id || '').padEnd(personColumnWidth) +
          channel.padEnd(channelColumnWidth) +
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
      const formatValue = (value) => (value != null ? String(value) : '-');
      const labelColumnWidth = 12, valueColumnWidth = 14;
      const header = ''.padEnd(labelColumnWidth) + 'aov'.padEnd(valueColumnWidth) + 'ltv'.padEnd(valueColumnWidth) +
        'activities'.padEnd(valueColumnWidth) + 'transactions'.padEnd(valueColumnWidth) + 'conversions';
      console.log(header);
      console.log('-'.repeat(header.length + 4));
      const row = (label, statsRow) =>
        label.padEnd(labelColumnWidth) +
        formatValue(statsRow.aov).padEnd(valueColumnWidth) + formatValue(statsRow.ltv).padEnd(valueColumnWidth) +
        formatValue(statsRow.activities).padEnd(valueColumnWidth) + formatValue(statsRow.transactions).padEnd(valueColumnWidth) +
        formatValue(statsRow.conversions);
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

  const rewardsCmd = new Command('rewards')
    .description('Show rewards for a person')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--status <state>', 'Filter by state (EARNED, FULFILLED, SENT, REDEEMED, CANCELED, FAILED, EXPIRED)')
    .option('--limit <n>', 'Max rewards to return', '25')
    .action(async function () {
      const options = this.optsWithGlobals();
      if (!isValidEmail(options.email)) {
        console.error('Error: --email must be a valid email address.');
        process.exit(2);
      }
      const token = resolveToken(options);
      const limit = parseInt(options.limit, 10);
      if (isNaN(limit) || limit <= 0) {
        console.error('--limit must be a positive integer');
        process.exit(2);
      }
      const match = await findPerson(options.email, token, options.verbose);
      if (!match) {
        console.error(`No person found for ${options.email}`);
        process.exit(1);
      }
      if (options.status && !VALID_REWARD_STATES.has(options.status.toUpperCase())) {
        console.error(`Error: --status must be one of: ${[...VALID_REWARD_STATES].join(', ')}`);
        process.exit(2);
      }
      const params = new URLSearchParams({ limit: String(limit) });
      if (options.status) params.set('state', options.status.toUpperCase());
      const rewards = await apiJson(`/v5/persons/${match.id}/rewards?${params}`, token, { verbose: options.verbose, baseUrl: API_BASE });
      if (!Array.isArray(rewards) || rewards.length === 0) {
        const suffix = options.status ? ` with state=${options.status.toUpperCase()}` : '';
        console.error(`No rewards found for ${options.email}${suffix}`);
        return;
      }
      if (options.json) { printJson(rewards, options); return; }
      const col = { state: 12, value: 18, journey: 16, date: 12 };
      console.log('state'.padEnd(col.state) + 'face_value'.padEnd(col.value) + 'journey'.padEnd(col.journey) + 'created_at'.padEnd(col.date) + 'reward_id');
      console.log('─'.repeat(col.state + col.value + col.journey + col.date + 24));
      for (const reward of rewards) formatReward(reward);
    });

  addGlobalOptions(rewardsCmd, {
    output: true,
    examples: [
      'extole person rewards --email jane@example.com',
      'extole person rewards --email jane@example.com --status EARNED',
      'extole person rewards --email jane@example.com --json',
    ],
  });

  const reportCmd = new Command('report')
    .description('Profile events report for a person (uses PROFILE report ALL_TIME; takes ~30-90s)')
    .allowExcessArguments(false)
    .option('--email <email>', 'Email address to look up')
    .option('--id <person_id>', 'Person ID (skips email lookup)')
    .action(async function () {
      const options = this.optsWithGlobals();
      if (!options.email && !options.id) {
        console.error('Error: --email or --id is required.');
        process.exit(2);
      }
      const token = resolveToken(options);

      let personId = options.id;
      if (!personId) {
        if (!isValidEmail(options.email)) {
          console.error('Error: --email must be a valid email address.');
          process.exit(2);
        }
        const match = await findPerson(options.email, token, options.verbose);
        if (!match) {
          console.error(`No person found for ${options.email}`);
          process.exit(1);
        }
        personId = match.id;
      }

      process.stderr.write('Running full profile report (takes ~30-90s)...\n');

      const createResponse = await apiFetch('/v4/reports', token, {
        method: 'POST',
        body: JSON.stringify({
          report_type: 'PROFILE',
          parameters: { profile_ids: personId, time_range: 'ALL_TIME' },
          formats: ['JSONL'],
        }),
        verbose: options.verbose,
      });
      const createText = await createResponse.text();
      if (!createResponse.ok) {
        console.error(`Failed to create report: ${createText.slice(0, 300)}`);
        process.exit(1);
      }
      const reportId = JSON.parse(createText).report_id;

      const status = await pollUntilDone(reportId, token, options.verbose);
      if (status !== 'DONE') {
        console.error(`Report ended with status: ${status}`);
        process.exit(1);
      }

      const downloadResponse = await apiFetch(`/v4/reports/${reportId}/download`, token, {
        verbose: options.verbose,
        headers: { Accept: '*/*' },
      });
      if (!downloadResponse.ok) {
        console.error(`Download failed: ${downloadResponse.status}`);
        process.exit(1);
      }
      await pipeline(downloadResponse.body, process.stdout);
    });

  addGlobalOptions(reportCmd, {
    output: true,
    examples: [
      'extole person report --email jane@example.com',
      'extole person report --id <person_id>',
      'extole person report --email jane@example.com --json',
    ],
  });

  getCmd._mcpDescription = 'Look up a person\'s profile by email or person_id. Returns identity fields, journey memberships, and custom data. The returned id (person_id) is the key that feeds into person_steps, person_rewards, person_relationships, person_stats, and person_report. Start here for any person-centric investigation.';
  stepsCmd._mcpDescription = 'Show the step history for a person — campaign steps, reward steps, and processing steps triggered by their events. Use --event <event_id> to filter to steps caused by a specific fired event (links events to campaign outcomes). Use --listen to tail live steps in real time.';
  rewardsCmd._mcpDescription = 'List rewards for a person by email. Returns reward_id, state (EARNED/FULFILLED/SENT/REDEEMED/CANCELED/FAILED), face value, journey, and created date. Use reward_id with rewards_get for full detail or rewards_history to debug a stuck reward.';
  relationshipsCmd._mcpDescription = 'Show advocate↔friend referral relationships for a person. Returns each referral link — their role (ADVOCATE or FRIEND), the program, the other_person_id, channel (SHARE_LINK, ADVOCATE_CODE), and creation date. Use other_person_id with person_get to investigate the counterpart.';
  statsCmd._mcpDescription = 'Show personal and referral network stats for a person. Returns two rows: the person\'s own AOV/LTV/activities/transactions/conversions, and the same aggregated across everyone they\'ve referred. The network row shows the total value this advocate\'s referrals have driven.';
  reportCmd._mcpDescription = 'SLOW (~30-90 seconds): Run the PROFILE report for a person over their full lifetime. Warn the user before calling. Returns complete lifetime stats — total rewards, conversion counts, referral network value, and transaction history. Use when person_stats is insufficient and you need the full transaction breakdown. person_stats covers most support use cases and is much faster.';

  person.addCommand(getCmd);
  person.addCommand(stepsCmd);
  person.addCommand(rewardsCmd);
  person.addCommand(relationshipsCmd);
  person.addCommand(statsCmd);
  person.addCommand(reportCmd);
  return person;
}
