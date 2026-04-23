#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

process.on('unhandledRejection', (err) => {
  console.error(`Error: ${err?.message || err}`);
  process.exit(1);
});
import { authCommand } from '../src/commands/auth.js';
import { mcpCommand } from '../src/commands/mcp.js';
import { pingCommand } from '../src/commands/ping.js';
import { eventsCommand } from '../src/commands/events.js';
import { reportsCommand } from '../src/commands/reports.js';
import { personCommand } from '../src/commands/person.js';
import { streamCommand } from '../src/commands/stream.js';
import { rewardsCommand } from '../src/commands/rewards.js';
import { programsCommand } from '../src/commands/programs.js';
import { componentsCommand } from '../src/commands/components.js';
import { webhooksCommand } from '../src/commands/webhooks.js';
import { healthCommand } from '../src/commands/health.js';

const program = new Command();

program
  .name('extole')
  .description('Extole developer CLI')
  .version(version)
  .enablePositionalOptions()
;

program.addCommand(authCommand());
program.addCommand(pingCommand());
program.addCommand(streamCommand());
program.addCommand(eventsCommand());
program.addCommand(personCommand());
program.addCommand(rewardsCommand());
program.addCommand(programsCommand());
program.addCommand(componentsCommand());
program.addCommand(webhooksCommand());
program.addCommand(healthCommand());
program.addCommand(reportsCommand());
program.addCommand(mcpCommand());

program.parse();
