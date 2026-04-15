import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { addGlobalOptions } from '../utils.js';

const CHAT_URL = 'https://chat.extole.com/chat';

function resolveMcpToken() {
  const config = loadConfig();
  const mcp = config._mcp;
  if (!mcp?.token) {
    console.error("Error: MCP not authenticated. Run 'extole auth mcp-login' first.");
    process.exit(1);
  }
  if (mcp.expiresAt && Date.now() > mcp.expiresAt) {
    console.error("Error: MCP token expired. Run 'extole auth mcp-login' to refresh.");
    process.exit(1);
  }
  return mcp.token;
}

export function mcpCommand() {
  const cmd = new Command('mcp')
    .description('Ask a question or run a task using Extole AI')
    .argument('<prompt...>', 'What you want to do or know')
    .action(async (promptParts) => {
      const prompt = promptParts.join(' ');
      const token = resolveMcpToken();

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
