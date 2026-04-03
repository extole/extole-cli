#!/usr/bin/env node

import { Command } from 'commander';
import { authCommand } from '../src/commands/auth.js';
import { pingCommand } from '../src/commands/ping.js';
import { eventsCommand } from '../src/commands/events.js';
import { reportsCommand } from '../src/commands/reports.js';
import { personCommand } from '../src/commands/person.js';
import { streamCommand } from '../src/commands/stream.js';
import { rewardsCommand } from '../src/commands/rewards.js';

const program = new Command();

program
  .name('extole')
  .description('Extole developer CLI')
  .version('0.1.0')
;

program.addCommand(authCommand());
program.addCommand(pingCommand());
program.addCommand(eventsCommand());
program.addCommand(reportsCommand());
program.addCommand(personCommand());
program.addCommand(rewardsCommand());
program.addCommand(streamCommand());

program.parse();
