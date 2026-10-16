import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson } from '../api.js';
import { addGlobalOptions, sleep } from '../utils.js';

const AGENT_URL = 'https://agent.extole.com';
const AGENT_NAME = 'extole_assistant_cli';
const APP_TYPE = 'extole-cli';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 90; // 90 × 2s = 3 minutes
const MAX_POLL_ERRORS = 5;

export async function sendToAgent(prompt, token, verbose) {
  const created = await apiJson('/v1/conversations:agent', token, {
    method: 'POST',
    body: JSON.stringify({ agentName: AGENT_NAME, userPrompt: prompt, surface: APP_TYPE }),
    verbose,
    baseUrl: AGENT_URL,
  });

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  let pollAttempts = 0;
  let pollErrors = 0;

  for (;;) {
    if (++pollAttempts > POLL_MAX_ATTEMPTS) {
      process.stderr.write('\r\x1b[K');
      throw new Error(`Agent did not respond after ${POLL_MAX_ATTEMPTS} attempts.`);
    }
    await sleep(POLL_INTERVAL_MS);

    let messages;
    try {
      messages = await apiJson(`/v1/conversations/${created.conversationId}/messages`, token, { verbose, baseUrl: AGENT_URL });
      pollErrors = 0;
    } catch (e) {
      if (++pollErrors >= MAX_POLL_ERRORS) {
        process.stderr.write('\r\x1b[K');
        throw new Error(`Too many poll errors: ${e.message}`);
      }
      process.stderr.write(`\r  poll error (${pollErrors}/${MAX_POLL_ERRORS}): ${e.message}    `);
      continue;
    }

    const assistantMessage = [...messages].reverse().find(message => message.type === 'assistant');
    if (assistantMessage) {
      process.stderr.write('\r\x1b[K');
      return assistantMessage.text;
    }

    const errorMessage = [...messages].reverse().find(message => message.type === 'error');
    if (errorMessage) {
      process.stderr.write('\r\x1b[K');
      throw new Error(errorMessage.text || 'Agent reported an error');
    }

    const lastMessage = messages[messages.length - 1];
    process.stderr.write(`\r${frames[frame++ % frames.length]}  ${lastMessage?.type || 'waiting'}    `);
  }
}

export function chatCommand() {
  const command = new Command('chat')
    .description('Ask a question or run a task using Extole AI')
    .argument('<prompt...>', 'What you want to do or know')
    .action(async function (promptParts) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const prompt = promptParts.join(' ');
      try {
        const reply = await sendToAgent(prompt, token, options.verbose);
        console.log(reply);
      } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    });

  addGlobalOptions(command, {
    examples: [
      "extole chat why aren't events firing for customer@example.com",
      'extole chat list available programs for this client',
      'extole chat how many programs are live in my account',
    ],
  });

  return command;
}
