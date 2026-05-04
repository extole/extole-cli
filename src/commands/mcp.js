import { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import { addGlobalOptions, fetchWithTimeout } from '../utils.js';

const AGENT_URL = 'https://agent.extole.com';
const IDP_TOKEN_URL = 'https://idp.extole.com/oauth2/token';
const MCP_CLIENT_ID = 'extole-cli';

async function resolveMcpToken() {
  const config = loadConfig();
  const mcp = config._mcp;

  if (!mcp?.token) {
    console.error("Error: MCP not authenticated. Run 'extole auth mcp-login' first.");
    process.exit(1);
  }

  // Token still valid
  if (!mcp.expiresAt || Date.now() < mcp.expiresAt - 30_000) {
    return mcp.token;
  }

  // Try refresh
  if (!mcp.refreshToken) {
    console.error("Error: MCP token expired. Run 'extole auth mcp-login' to re-authenticate.");
    process.exit(1);
  }

  const res = await fetchWithTimeout(IDP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: MCP_CLIENT_ID,
      refresh_token: mcp.refreshToken,
    }),
  });

  if (!res.ok) {
    console.error("Error: MCP token expired and refresh failed. Run 'extole auth mcp-login' to re-authenticate.");
    process.exit(1);
  }

  const tokenData = await res.json();
  config._mcp.token = tokenData.access_token;
  if (tokenData.expires_in) {
    config._mcp.expiresAt = Date.now() + tokenData.expires_in * 1000;
  }
  if (tokenData.refresh_token) {
    config._mcp.refreshToken = tokenData.refresh_token;
  }
  saveConfig(config);

  return config._mcp.token;
}

export function mcpCommand() {
  const cmd = new Command('mcp')
    .description('Ask a question or run a task using Extole AI')
    .argument('<prompt...>', 'What you want to do or know')
    .action(async (promptParts) => {
      const prompt = promptParts.join(' ');
      const token = await resolveMcpToken();

      let res;
      try {
        res = await fetchWithTimeout(`${AGENT_URL}/conversation:send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ userPrompt: prompt }),
        }, 120_000);
      } catch {
        console.error('Error: Extole AI agent server is unavailable');
        process.exit(1);
      }

      if (!res.ok) {
        const text = await res.text();
        console.error(`Error ${res.status}: ${text}`);
        process.exit(1);
      }

      const data = await res.json();
      const assistantMsg = [...(data.messages ?? [])].reverse().find(m => m.type === 'assistant');
      const reply = assistantMsg?.text ?? data.response ?? JSON.stringify(data);
      console.log(reply);
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
