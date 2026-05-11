import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';
import { addGlobalOptions } from '../utils.js';
import { sendToAgent } from './mcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');

function loadSkill(name) {
  return readFileSync(join(SKILLS_DIR, `${name}.md`), 'utf8');
}

function buildPrompt(skillBody, task) {
  return `Run the skill below against the target the user named. Follow its workflow and produce output in exactly the shape it specifies.

User request: ${task}

Skill instructions:
---
${skillBody}
---`;
}

export function describeCommand() {
  const describe = new Command('describe')
    .description('AI-driven synthesis: produce marketer-readable summaries by combining MCP-driven data fetches with skill-defined output shapes. Uses the Extole AI agent under the hood (`extole auth mcp-login` required).');

  // ── describe campaign ──────────────────────────────────────────────────

  const campaignCmd = new Command('campaign')
    .description('Produce a marketer-readable description of a campaign — reward amounts, eligibility rules, share limits, fraud/quality rules — read from the live configuration. This command uses your MCP identity for data access; --account is not honored here because the Extole AI agent has its own auth context (whatever client access your MCP user has).')
    .allowExcessArguments(false)
    .argument('<campaign-id>', 'Campaign ID to describe')
    .action(async function (campaignId) {
      let skill;
      try {
        skill = loadSkill('extole-program-description');
      } catch (e) {
        console.error(`Error loading skill: ${e.message}`);
        process.exit(1);
      }

      const task = `Describe campaign ${campaignId}. Read the live configuration via the Extole MCP tools and produce the marketer-readable description in the format the skill specifies.`;
      const prompt = buildPrompt(skill, task);

      process.stderr.write('Asking the Extole AI agent... (this may take 30-60s for multi-step skill workflows)\n\n');

      try {
        const reply = await sendToAgent(prompt);
        console.log(reply);
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
    });

  addGlobalOptions(campaignCmd, {
    examples: [
      'extole describe campaign 6864726382650918622',
      'extole describe campaign <campaign-id>',
    ],
  });

  describe.addCommand(campaignCmd);
  return describe;
}
