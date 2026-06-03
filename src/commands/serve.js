import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn, execSync } from 'child_process';
import { homedir } from 'os';
import { Command } from 'commander';
import { buildTools, toMcpTool } from '../schema.js';

const MCP_SERVER_NAME = 'extole-cli';

function resolveExtoleBin() {
  try {
    const p = execSync('which extole', { encoding: 'utf8' }).trim();
    if (p) return { command: p, args: ['serve'] };
  } catch {}
  return { command: process.execPath, args: [process.argv[1], 'serve'] };
}

const CLIENTS = [
  {
    name: 'Claude Desktop',
    configPath: () => {
      if (process.platform === 'win32')
        return join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json');
      return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    },
    mcpKey: 'mcpServers',
  },
  {
    name: 'Claude Code',
    configPath: () => join(homedir(), '.claude', 'settings.json'),
    mcpKey: 'mcpServers',
  },
];

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '../../bin/extole.js');
const CALL_TIMEOUT_MS = 60_000;

// camelCase → --kebab-case
function toFlag(key) {
  return '--' + key.replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`);
}

function buildCliArgs(tool, args) {
  const cliArgs = [...tool._cmdPath];

  // Positional args first, in declaration order
  for (const posName of tool._positional) {
    const val = args[posName];
    if (val == null) continue;
    if (Array.isArray(val)) cliArgs.push(...val.map(String));
    else cliArgs.push(String(val));
  }

  // Named options
  for (const [key, val] of Object.entries(args)) {
    if (tool._positional.includes(key)) continue;
    if (val == null || val === false) continue;
    const flag = toFlag(key);
    if (val === true) {
      cliArgs.push(flag);
    } else if (Array.isArray(val)) {
      for (const item of val) cliArgs.push(flag, String(item));
    } else {
      cliArgs.push(flag, String(val));
    }
  }

  if (tool._hasJson) cliArgs.push('--json');
  return cliArgs;
}

function callTool(toolMap, name, args) {
  return new Promise((resolve, reject) => {
    const tool = toolMap.get(name);
    if (!tool) return reject(new Error(`Unknown tool: ${name}`));

    const cliArgs = buildCliArgs(tool, args ?? {});
    process.stderr.write(`[serve] → node ${BIN} ${cliArgs.join(' ')}\n`);

    const proc = spawn(process.execPath, [BIN, ...cliArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Tool call timed out after ${CALL_TIMEOUT_MS / 1000}s`));
    }, CALL_TIMEOUT_MS);

    proc.on('close', code => {
      clearTimeout(timer);
      const text = stdout.trim() || stderr.trim() || `(exit ${code})`;
      if (code !== 0) {
        resolve({ content: [{ type: 'text', text: stderr.trim() || text }], isError: true });
      } else {
        resolve({ content: [{ type: 'text', text }], isError: false });
      }
    });
  });
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

export function serveCommand(program) {
  const serve = new Command('serve')
    .description('Start an MCP stdio server — connect Claude Desktop or ChatGPT Desktop to your Extole account')
    .allowExcessArguments(false)
    .addHelpText('after', `
Add to Claude Desktop (~/.claude/claude_desktop_config.json):
  {
    "mcpServers": {
      "extole": {
        "command": "extole",
        "args": ["serve"]
      }
    }
  }

Examples:
  extole serve`)
    .action(async function () {
      const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

      const allTools = buildTools(program);
      const serveTools = allTools.filter(t => !t._excluded);
      const toolMap = new Map(serveTools.map(t => [t.name, t]));

      process.stderr.write(`[serve] extole MCP server v${version} — ${serveTools.length} tools ready\n`);

      async function dispatch(method, params) {
        switch (method) {
          case 'initialize':
            return {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'extole-cli', version },
            };
          case 'tools/list':
            return { tools: serveTools.map(toMcpTool) };
          case 'tools/call': {
            const { name, arguments: args } = params ?? {};
            return callTool(toolMap, name, args);
          }
          default: {
            const err = new Error(`Method not found: ${method}`);
            err.code = -32601;
            throw err;
          }
        }
      }

      async function handleMessage(msg) {
        // Notifications have no id — don't respond
        if (msg.id == null) return;
        try {
          const result = await dispatch(msg.method, msg.params ?? {});
          send({ jsonrpc: '2.0', id: msg.id, result });
        } catch (e) {
          send({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: e.code ?? -32603, message: e.message },
          });
        }
      }

      process.stdin.setEncoding('utf8');
      let buf = '';
      process.stdin.on('data', chunk => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let msg;
          try { msg = JSON.parse(trimmed); } catch { continue; }
          handleMessage(msg);
        }
      });

      // Don't force-exit on stdin close — let pending tool calls finish first.
      // Node exits naturally once stdin is closed and the event loop drains.
    });

  const bin = resolveExtoleBin();
  const entry = { command: bin.command, args: bin.args };

  serve
    .command('setup')
    .description('Register extole-cli as an MCP server in Claude Desktop, Claude Code, and other detected AI clients')
    .allowExcessArguments(false)
    .addHelpText('after', `\nExamples:\n  extole serve setup`)
    .action(() => {
      let anyFound = false;
      for (const client of CLIENTS) {
        const path = client.configPath();
        if (!existsSync(path) && client.name !== 'Claude Code') continue;
        anyFound = true;
        const config = readJson(path) ?? {};
        config[client.mcpKey] = config[client.mcpKey] ?? {};
        const existing = config[client.mcpKey][MCP_SERVER_NAME];
        config[client.mcpKey][MCP_SERVER_NAME] = entry;
        writeJson(path, config);
        if (existing) {
          console.log(`${client.name}: updated  (${path})`);
        } else {
          console.log(`${client.name}: added    (${path})`);
        }
      }
      if (!anyFound) {
        console.log('No supported AI clients detected. Supported: Claude Desktop, Claude Code.');
      } else {
        console.log('\nRestart your AI client(s) to activate extole-cli.');
      }
    });

  serve
    .command('remove')
    .description('Remove extole-cli MCP server registration from Claude Desktop, Claude Code, and other detected AI clients')
    .allowExcessArguments(false)
    .addHelpText('after', `\nExamples:\n  extole serve remove`)
    .action(() => {
      let anyRemoved = false;
      for (const client of CLIENTS) {
        const path = client.configPath();
        const config = readJson(path);
        if (!config) continue;
        if (!config[client.mcpKey]?.[MCP_SERVER_NAME]) continue;
        delete config[client.mcpKey][MCP_SERVER_NAME];
        writeJson(path, config);
        console.log(`${client.name}: removed  (${path})`);
        anyRemoved = true;
      }
      if (!anyRemoved) {
        console.log(`extole-cli not found in any AI client configs.`);
      }
    });

  const setupCmd = serve.commands.find(c => c.name() === 'setup');
  const removeCmd = serve.commands.find(c => c.name() === 'remove');

  if (setupCmd) setupCmd._mcpDescription = 'META-TOOL: Registers extole-cli as an MCP server in Claude Desktop and Claude Code config files. DO NOT call this autonomously — only call if the user explicitly asks to set up or reconfigure their Claude MCP integration. Calling this unexpectedly will modify the user\'s AI client configuration files.';
  if (removeCmd) removeCmd._mcpDescription = 'META-TOOL: Removes extole-cli MCP server registration from Claude Desktop and Claude Code config files. DO NOT call this autonomously — only call if the user explicitly asks to remove or uninstall the extole-cli MCP integration. This will disable extole-cli as a tool source for the user\'s AI clients.';

  return serve;
}
