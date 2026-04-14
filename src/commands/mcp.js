import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { addGlobalOptions } from '../utils.js';

const CHAT_URL = 'https://chat.extole.com/chat';

export function mcpCommand() {
  const cmd = new Command('mcp')
    .description('Ask a question or run a task using Extole AI')
    .argument('<prompt...>', 'What you want to do or know')
    .action(async (promptParts, opts) => {
      const prompt = promptParts.join(' ');
      const token = resolveToken(opts);

      let res;
      try {
        res = await fetch(CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ prompt }),
        });
      } catch {
        console.error('Error: Extole AI chat server is unavailable');
        process.exit(1);
      }

      if (!res.ok) {
        const text = await res.text();
        console.error(`Error ${res.status}: ${text}`);
        process.exit(1);
      }

      const data = await res.json();
      console.log(data.response);
    });

  addGlobalOptions(cmd, {
    examples: [
      "extole mcp why aren't events firing for customer@example.com",
      'extole mcp list available programs for this client',
      'extole mcp how many programs are live in my account',
    ],
  });

  return cmd;
}
