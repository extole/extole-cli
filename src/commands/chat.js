import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { addGlobalOptions, fetchWithTimeout } from '../utils.js';

const AGENT_URL = 'https://agent.extole.com';
const AGENT_NAME = 'extole_assistant_cli';
const APP_TYPE = 'extole-cli';

export async function sendToAgent(prompt, token) {
  let response;
  try {
    response = await fetchWithTimeout(`${AGENT_URL}/conversations:agent?app_type=${APP_TYPE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-extole-app-type': APP_TYPE,
      },
      body: JSON.stringify({ agentName: AGENT_NAME, userPrompt: prompt, surface: APP_TYPE }),
    }, 120_000);
  } catch {
    throw new Error('Extole AI agent server is unavailable');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Agent error ${response.status}: ${text}`);
  }
  const data = await response.json();
  const assistantMessage = [...(data.messages ?? [])].reverse().find(message => message.type === 'assistant');
  return assistantMessage?.text ?? data.response ?? JSON.stringify(data);
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
        const reply = await sendToAgent(prompt, token);
        console.log(reply);
      } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    });

  command._mcpDescription = 'Ask the Extole AI agent a question about this account or the Extole platform. The agent has live access to Extole API tools and returns structured responses with IDs you can use in follow-up CLI calls. Use for open-ended questions, summarizing account state, or when you need the agent to chain multiple lookups together. Excluded from serve mode to avoid circular agent loops.';

  addGlobalOptions(command, {
    examples: [
      "extole chat why aren't events firing for customer@example.com",
      'extole chat list available programs for this client',
      'extole chat how many programs are live in my account',
    ],
  });

  return command;
}
