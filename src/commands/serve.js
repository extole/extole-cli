import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { Command } from 'commander';
import { buildTools, toMcpTool } from '../schema.js';

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
  return new Command('serve')
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
}
