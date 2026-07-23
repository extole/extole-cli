#!/usr/bin/env node

import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { authCommand } from '../src/commands/auth.js';
import { chatCommand } from '../src/commands/chat.js';
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
import { whoamiCommand } from '../src/commands/whoami.js';
import { feedbackCommand } from '../src/commands/feedback.js';
import { zonesCommand } from '../src/commands/zones.js';
import { shareLinksCommand } from '../src/commands/share-links.js';
import { campaignsCommand } from '../src/commands/campaigns.js';
import { audiencesCommand } from '../src/commands/audiences.js';
import { notificationsCommand } from '../src/commands/notifications.js';
import { rewardSuppliersCommand } from '../src/commands/reward-suppliers.js';
import { apiCommand } from '../src/commands/api.js';
import { schemaCommand } from '../src/commands/schema.js';
import { setRequestTimeoutMs } from '../src/api.js';

const { version } = pkg;

process.on('unhandledRejection', (err) => {
  console.error(`Error: ${err?.message || err}`);
  process.exit(1);
});

const program = new Command();

program
  .name('extole')
  .description('Extole developer CLI')
  .version(version)
  .enablePositionalOptions()
;

program.hook('preAction', (_thisCommand, actionCommand) => {
  const timeout = actionCommand.optsWithGlobals().timeout;
  if (timeout === undefined) return;
  const seconds = Number(timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.error('Error: --timeout must be a positive number of seconds');
    process.exit(2);
  }
  setRequestTimeoutMs(seconds * 1000);
});

program.addCommand(authCommand().helpGroup('Account:'));
program.addCommand(pingCommand().helpGroup('Account:'));
program.addCommand(whoamiCommand().helpGroup('Account:'));

program.addCommand(personCommand().helpGroup('People:'));
program.addCommand(shareLinksCommand().helpGroup('People:'));

program.addCommand(rewardsCommand().helpGroup('Rewards:'));
program.addCommand(rewardSuppliersCommand().helpGroup('Rewards:'));

program.addCommand(programsCommand().helpGroup('Programs & Campaigns:'));
program.addCommand(campaignsCommand().helpGroup('Programs & Campaigns:'));
program.addCommand(audiencesCommand().helpGroup('Programs & Campaigns:'));
program.addCommand(componentsCommand().helpGroup('Programs & Campaigns:'));
program.addCommand(zonesCommand().helpGroup('Programs & Campaigns:'));

program.addCommand(eventsCommand().helpGroup('Events & Integrations:'));
program.addCommand(streamCommand().helpGroup('Events & Integrations:'));
program.addCommand(webhooksCommand().helpGroup('Events & Integrations:'));
program.addCommand(notificationsCommand().helpGroup('Events & Integrations:'));

program.addCommand(reportsCommand().helpGroup('Reports & Health:'));
program.addCommand(healthCommand().helpGroup('Reports & Health:'));

program.addCommand(chatCommand().helpGroup('AI Assistant:'));
program.addCommand(feedbackCommand().helpGroup('AI Assistant:'));

program.addCommand(apiCommand().helpGroup('Developer Tools:'));

// schema introspects program, so registered after all other commands
program.addCommand(schemaCommand(program).helpGroup('Developer Tools:'));

program.parse();
