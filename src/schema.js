// CLI introspection — builds MCP tool list from Commander program tree.
// Used by `extole schema` (output) and `extole serve` (routing).

// Tools excluded from serve mode: interactive, circular, or internal-only.
export const SERVE_EXCLUDED = new Set([
  'chat',              // circular (calls Extole AI agent)
  'feedback',          // circular (calls Extole AI agent via chat)
  'schema',            // internal plumbing for serve
  'serve',             // would spawn a second MCP server
  'stream',            // duplicate of events_listen — use events_listen as the canonical MCP surface
  'rewards_suppliers', // duplicate of reward-suppliers — use reward-suppliers namespace instead
  'rewards_suppliers_get', // duplicate of reward-suppliers_get
]);

// Tools that mutate state — marked destructive so MCP clients can prompt appropriately.
// Everything else is read-only (GET operations) and auto-approved by supporting clients.
export const DESTRUCTIVE_TOOLS = new Set([
  'auth_login', 'auth_logout', 'auth_default',
  'events_fire',
  'webhooks_create', 'webhooks_delete', 'webhooks_attach', 'webhooks_trace',
  'components_create', 'components_delete', 'components_deploy', 'components_set',
  'reward-suppliers_create', 'reward-suppliers_upload-coupons',
  'health_provision-dkim',
  'reports_run',
  'zones_call',
  'audiences_history',  // can trigger pushes
]);

const GLOBAL_PROPERTIES = {
  account: { type: 'string', description: 'Saved account name (or set EXTOLE_ACCOUNT)' },
  token:   { type: 'string', description: 'Override token for this call (or set EXTOLE_TOKEN)' },
};

function optionToSchema(opt) {
  if (opt.negate) return null;
  const name = opt.attributeName?.() ?? null;
  if (!name) return null;
  if (['verbose', 'json', 'compact'].includes(name)) return null;

  const isRepeatable = Array.isArray(opt.defaultValue);
  const hasArg = opt.flags.includes('<') || opt.flags.includes('[');

  const prop = { description: opt.description || '' };

  if (opt.argChoices?.length) {
    prop.type = 'string';
    prop.enum = opt.argChoices;
  } else if (isRepeatable) {
    prop.type = 'array';
    prop.items = { type: 'string' };
  } else if (hasArg) {
    prop.type = 'string';
  } else {
    prop.type = 'boolean';
  }

  const dv = opt.defaultValue;
  if (dv !== undefined && dv !== false && dv !== null && !Array.isArray(dv) && name !== 'account') {
    prop.default = dv;
  }

  return [name, prop, opt.mandatory ?? false];
}

function buildToolEntry(cmd, name, path) {
  const properties = { ...GLOBAL_PROPERTIES };
  const required = [];
  const positional = [];
  const hasJson = (cmd.options ?? []).some(o => o.long === '--json');

  for (const arg of cmd.registeredArguments ?? cmd._args ?? []) {
    const argName = arg.name();
    const prop = { description: arg.description || '' };
    if (arg.variadic) {
      prop.type = 'array';
      prop.items = { type: 'string' };
    } else {
      prop.type = 'string';
    }
    if (arg.argChoices?.length) prop.enum = arg.argChoices;
    properties[argName] = prop;
    positional.push(argName);
    if (arg.required) required.push(argName);
  }

  for (const opt of cmd.options ?? []) {
    const result = optionToSchema(opt);
    if (!result) continue;
    const [propName, prop, mandatory] = result;
    properties[propName] = prop;
    if (mandatory) required.push(propName);
  }

  return {
    name,
    description: cmd._mcpDescription ? `[extole-cli] ${cmd._mcpDescription}` : (cmd.description() || ''),
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
    },
    _cmdPath:    path,
    _positional: positional,
    _hasJson:    hasJson,
    _excluded:   SERVE_EXCLUDED.has(name),
  };
}

function collectTools(cmd, prefix, cmdPath) {
  const tools = [];
  const name = prefix ? `${prefix}_${cmd.name()}` : cmd.name();
  const path = [...cmdPath, cmd.name()];
  const subCmds = cmd.commands ?? [];

  // Emit a tool for this command if it has its own action handler
  if (cmd._actionHandler) {
    tools.push(buildToolEntry(cmd, name, path));
  }

  // Recurse into subcommands
  for (const sub of subCmds) {
    tools.push(...collectTools(sub, name, path));
  }

  return tools;
}

export function buildTools(program) {
  const tools = [];
  for (const cmd of program.commands) {
    tools.push(...collectTools(cmd, '', []));
  }
  return tools;
}

// Strip internal metadata fields for MCP wire format.
// Adds MCP annotations so clients like Claude Desktop can auto-approve read-only tools.
export function toMcpTool({ name, description, inputSchema }) {
  const destructive = DESTRUCTIVE_TOOLS.has(name);
  return {
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: !destructive,
      destructiveHint: destructive,
      idempotentHint: !destructive,
    },
  };
}
