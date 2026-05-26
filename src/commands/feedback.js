import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import { exec } from 'child_process';
import { Command } from 'commander';
import { getMcpToken, saveMcpToken, getDefaultAccount, IDP_BASE, MCP_CLIENT_ID } from '../config.js';
import { addGlobalOptions } from '../utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

const MCP_BASE = 'https://mcp.extole.com';
const MCP_TOOLSET_URL = `${MCP_BASE}/toolsets/extole/mcp`;

async function acquireMcpToken() {
  const existing = await getMcpToken();
  if (existing) return existing;

  // No token — trigger browser PKCE flow
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  let resolveCode, rejectCode;
  const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/oauth/callback') { res.writeHead(404); res.end(); return; }
    const error = url.searchParams.get('error');
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Login failed: ${error}`);
      rejectCode(new Error(error));
      return;
    }
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Login failed: state mismatch');
      rejectCode(new Error('state mismatch'));
      return;
    }
    const code = url.searchParams.get('code');
    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><p>Login successful — you may close this tab.</p></body></html>');
      resolveCode(code);
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;

  const authUrl = new URL(`${IDP_BASE}/oauth2/authorize`);
  authUrl.searchParams.set('client_id', MCP_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  console.error('Opening browser to complete login before sending feedback…');
  console.error(`If the browser does not open, visit:\n${authUrl.toString()}\n`);

  const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${openCmd} "${authUrl.toString()}"`);

  const timeout = setTimeout(() => {
    server.close();
    rejectCode(new Error('Login timed out after 2 minutes'));
  }, 120_000);

  let code;
  try {
    code = await codePromise;
  } finally {
    clearTimeout(timeout);
    server.close();
  }

  const tokenRes = await fetch(`${IDP_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: MCP_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`);
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('No access_token in IDP response');
  saveMcpToken(tokenData);
  console.error('Login successful. Sending feedback…\n');
  return tokenData.access_token;
}

async function sendFeedbackViaMcp(feedbackText, contextText, token) {
  const sseRes = await fetch(MCP_TOOLSET_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
  if (!sseRes.ok) {
    throw new Error(`MCP connection failed (${sseRes.status})`);
  }

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  const pending = [];

  async function readEvent() {
    while (pending.length === 0) {
      const { done, value } = await reader.read();
      if (done) return null;
      sseBuffer += decoder.decode(value, { stream: true });
      const blocks = sseBuffer.split('\n\n');
      sseBuffer = blocks.pop();
      for (const block of blocks) {
        if (!block.trim()) continue;
        const ev = {};
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev.type = line.slice(6).trim();
          else if (line.startsWith('data:')) ev.data = line.slice(5).trim();
        }
        if (ev.data !== undefined) pending.push(ev);
      }
    }
    return pending.shift();
  }

  let sessionUrl;

  async function post(body) {
    const res = await fetch(sessionUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await res.text();
    if (!res.ok) throw new Error(`MCP request failed (${res.status})`);
  }

  const endpointEvent = await readEvent();
  if (!endpointEvent || endpointEvent.type !== 'endpoint') {
    throw new Error('No session endpoint from MCP server');
  }
  sessionUrl = new URL(endpointEvent.data, MCP_BASE).toString();

  await post({
    jsonrpc: '2.0', method: 'initialize', id: '1',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'extole-cli', version } },
  });
  await readEvent();
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

  await post({
    jsonrpc: '2.0', method: 'tools/call', id: '2',
    params: {
      name: 'extole_issue_create',
      arguments: { issueDescription: feedbackText, additionalContextFromConversation: contextText },
    },
  });

  const resultEvent = await readEvent();
  reader.cancel();

  if (!resultEvent) throw new Error('No response from MCP server');
  const msg = JSON.parse(resultEvent.data);
  if (msg.error) throw new Error(msg.error.message || 'Tool call failed');
  return msg.result;
}

export function feedbackCommand() {
  return addGlobalOptions(
    new Command('feedback')
      .description('Send feedback or report a bug to the Extole CLI team (creates a Jira ticket)')
      .argument('<message...>', 'Your feedback or bug description')
      .action(async function (messageParts) {
        const opts = this.optsWithGlobals();
        const message = messageParts.join(' ');
        const account = opts.account || getDefaultAccount() || '(unknown)';
        const context = `account: ${account}  cli v${version}  ${process.platform}`;

        let token;
        try {
          token = await acquireMcpToken();
        } catch (e) {
          console.error(`Error: login failed — ${e.message}`);
          process.exit(1);
        }

        console.error('Sending feedback…');
        let result;
        try {
          result = await sendFeedbackViaMcp(message, context, token);
        } catch (e) {
          console.error(`Error: could not send feedback — ${e.message}`);
          process.exit(1);
        }

        const content = result?.content;
        const text = Array.isArray(content) ? content.map(c => c.text || '').join('') : '';
        let ticketInfo = '';
        try {
          const parsed = JSON.parse(text);
          if (parsed.ticketNumber) ticketInfo = `  ${parsed.ticketNumber}`;
          if (parsed.createdTicketLink) ticketInfo += `  ${parsed.createdTicketLink}`;
        } catch { /* not JSON */ }

        console.log(`Feedback sent. Thanks!${ticketInfo}`);
      }),
    {
      examples: [
        'extole feedback the --filter-state flag should mention it is REWARD-only in the help text',
        'extole feedback auth login flow was confusing, needed to read the README',
      ],
    }
  );
}
