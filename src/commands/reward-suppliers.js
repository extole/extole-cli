import { readFileSync } from 'fs';
import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, formatEventDate, collect } from '../utils.js';

export const VALID_FACE_VALUE_TYPES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'BRL', 'JPY', 'CNY', 'INR',
  'NZD', 'MXN', 'KRW', 'TWD', 'TRY', 'HKD', 'PERCENT_OFF', 'POINTS', 'MONTH'];
export const VALID_CUSTOM_REWARD_TYPES = ['ACCOUNT_CREDIT', 'LOYALTY_POINTS'];

async function fetchSuppliers(token, verbose) {
  // /built returns resolved values for any javascript@buildtime: expressions
  // in name/face_value/etc. — without this, components-bundle suppliers show
  // raw expression strings instead of usable values.
  return apiJson('/v6/reward-suppliers/built', token, { verbose, baseUrl: API_BASE });
}

async function fetchSupplier(id, token, verbose) {
  return apiJson(`/v6/reward-suppliers/${id}/built`, token, { verbose, baseUrl: API_BASE });
}

async function fetchCoupons(id, token, verbose) {
  return apiJson(`/v2/reward-suppliers/manual-coupons/${id}/coupons`, token, { verbose, baseUrl: API_BASE });
}

function formatFaceValue(s) {
  const v = s.face_value;
  if (v == null) return '';
  const t = s.face_value_type || '';
  if (t === 'PERCENT_OFF') return `${v}% off`;
  if (t === 'USD') return `$${v}`;
  if (t === 'POINTS') return `${v} points`;
  return `${v} ${t}`.trim();
}

export function rewardSuppliersCommand() {
  const cmd = new Command('reward-suppliers')
    .description('Inspect and manage reward suppliers (BHN, coupons, custom, Tango) including face values')
    .allowExcessArguments(false)
    .option('--filter <substr>', 'Case-insensitive substring match on supplier name or type')
    .enablePositionalOptions()
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const data = await fetchSuppliers(token, opts.verbose);
      let list = Array.isArray(data) ? data : [];

      if (opts.filter) {
        const needle = opts.filter.toLowerCase();
        list = list.filter(s => {
          const hay = [s.name, s.display_name, s.display_type, s.face_value_type].filter(Boolean).join(' ').toLowerCase();
          return hay.includes(needle);
        });
      }

      if (opts.json) {
        printJson(list, opts);
        return;
      }
      if (list.length === 0) {
        console.log(opts.filter
          ? `No reward suppliers match "${opts.filter}".`
          : 'No reward suppliers configured.');
        return;
      }

      const rows = list.map(s => ({
        id: s.id || '',
        type: s.display_type || '',
        name: s.name || s.display_name || '',
        face: formatFaceValue(s),
        enabled: s.enabled === false ? 'off' : 'on',
      }));

      const idW = Math.max('id'.length, ...rows.map(r => r.id.length));
      const typeW = Math.max('type'.length, ...rows.map(r => r.type.length));
      const nameW = Math.max('name'.length, ...rows.map(r => r.name.length));
      const faceW = Math.max('face_value'.length, ...rows.map(r => r.face.length));

      console.log(`${'id'.padEnd(idW)}  ${'type'.padEnd(typeW)}  ${'name'.padEnd(nameW)}  ${'face_value'.padEnd(faceW)}  enabled`);
      console.log(`${'─'.repeat(idW)}  ${'─'.repeat(typeW)}  ${'─'.repeat(nameW)}  ${'─'.repeat(faceW)}  ─────`);
      for (const r of rows) {
        console.log(`${r.id.padEnd(idW)}  ${r.type.padEnd(typeW)}  ${r.name.padEnd(nameW)}  ${r.face.padEnd(faceW)}  ${r.enabled}`);
      }
    });

  addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole reward-suppliers',
      'extole reward-suppliers --filter manual',
      'extole reward-suppliers --json',
    ],
  });

  // ── get ────────────────────────────────────────────────────────────────

  const getCmd = new Command('get')
    .argument('<supplier-id>', 'Reward supplier ID')
    .description('Show full configuration for a reward supplier — face value, partner key type, limits, expiry, tags.')
    .allowExcessArguments(false)
    .action(async function (supplierId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const s = await fetchSupplier(supplierId, token, opts.verbose);

      if (opts.json) {
        printJson(s, opts);
        return;
      }

      const field = (label, value) => value != null && value !== ''
        ? console.log(`${label.padEnd(22)}${value}`)
        : null;

      field('id',                     s.id);
      field('name',                   s.name);
      field('display_name',           s.display_name);
      field('type',                   s.display_type);
      field('face_value',             formatFaceValue(s));
      field('face_value_algorithm',   s.face_value_algorithm_type);
      field('partner_key_type',       s.partner_reward_key_type);
      field('enabled',                s.enabled === false ? 'off' : 'on');
      field('limit_per_hour',         s.limit_per_hour);
      field('limit_per_day',          s.limit_per_day);
      field('coupon_warn_limit',      s.coupon_count_warn_limit);
      field('min_coupon_lifetime',    s.minimum_coupon_lifetime);
      field('default_coupon_expiry',  s.default_coupon_expiry_date ? formatEventDate(s.default_coupon_expiry_date) : null);
      field('cash_back_percentage',   s.cash_back_percentage);
      field('created',                s.created_date ? formatEventDate(s.created_date) : null);
      field('updated',                s.updated_date ? formatEventDate(s.updated_date) : null);
      if (Array.isArray(s.tags) && s.tags.length) field('tags', s.tags.join(', '));
    });

  addGlobalOptions(getCmd, {
    output: true,
    examples: [
      'extole reward-suppliers get <supplier-id>',
      'extole reward-suppliers get <supplier-id> --json',
    ],
  });

  cmd.addCommand(getCmd);

  // ── coupons (manual-coupon suppliers only) ─────────────────────────────

  const couponsCmd = new Command('coupons')
    .argument('<supplier-id>', 'Manual-coupon reward supplier ID')
    .description('Show coupon inventory for a manual-coupon supplier — count and a small preview. Useful for capacity planning before a marketing push, or confirming depletion when an alert fires. Use --list to dump all codes.')
    .allowExcessArguments(false)
    .option('--list', 'Print all coupon codes and expirations (default: just count + small preview)')
    .option('--limit <n>', 'With --list, cap the number of rows printed', '50')
    .action(async function (supplierId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      // Pre-check that the supplier is a manual-coupon type so we don't 4xx silently
      let supplier;
      try { supplier = await fetchSupplier(supplierId, token, opts.verbose); } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      if (supplier && supplier.display_type !== 'MANUAL_COUPON') {
        console.error(`Supplier ${supplierId} is type "${supplier.display_type}", not MANUAL_COUPON.`);
        console.error('Coupon inventory only applies to manual-coupon suppliers; other types mint codes on demand or use external partner APIs.');
        process.exit(2);
      }

      const data = await fetchCoupons(supplierId, token, opts.verbose);
      const coupons = data?.uploaded_coupons || [];

      if (opts.json) {
        printJson(data, opts);
        return;
      }

      const total = coupons.length;
      const warnLimit = supplier?.coupon_count_warn_limit;
      const warn = warnLimit != null && total <= warnLimit;

      console.log(`Supplier:  ${supplierId}  ${supplier.name || ''}`);
      console.log(`Inventory: ${total} coupon${total === 1 ? '' : 's'}${warnLimit != null ? `  (warn-limit: ${warnLimit})` : ''}${warn ? '  ⚠  at or below warn limit' : ''}`);

      if (total === 0) return;

      if (opts.list) {
        const limit = Math.max(1, parseInt(opts.limit, 10) || 50);
        const slice = coupons.slice(0, limit);
        console.log();
        const codeW = Math.max('code'.length, ...slice.map(c => (c.coupon_code || '').length));
        console.log(`${'code'.padEnd(codeW)}  expires_at`);
        console.log(`${'─'.repeat(codeW)}  ${'─'.repeat(20)}`);
        for (const c of slice) {
          const expires = c.expires_at ? formatEventDate(c.expires_at) : '';
          console.log(`${(c.coupon_code || '').padEnd(codeW)}  ${expires}`);
        }
        if (coupons.length > limit) {
          console.log(`\n${slice.length} of ${coupons.length} shown (--limit ${limit}).`);
        }
      } else {
        // Default: small preview so the user can confirm they're looking at the right supplier
        console.log();
        console.log('Sample (first 3):');
        for (const c of coupons.slice(0, 3)) {
          const expires = c.expires_at ? formatEventDate(c.expires_at) : '';
          console.log(`  ${c.coupon_code}${expires ? `  (expires ${expires})` : ''}`);
        }
        console.log(`\nUse --list to print all codes.`);
      }
    });

  addGlobalOptions(couponsCmd, {
    output: true,
    examples: [
      'extole reward-suppliers coupons <supplier-id>            # count + preview',
      'extole reward-suppliers coupons <supplier-id> --list',
      'extole reward-suppliers coupons <supplier-id> --json',
    ],
  });

  // ── create ─────────────────────────────────────────────────────────────

  const createCmd = new Command('create')
    .description('Create a reward supplier. Supports typed flags for MANUAL_COUPON and CUSTOM_REWARD; use --body for TANGO_V2 or SALESFORCE_COUPON.')
    .allowExcessArguments(false)
    .option('--type <type>', 'Supplier type: MANUAL_COUPON, CUSTOM_REWARD, TANGO_V2, SALESFORCE_COUPON')
    .option('--name <name>', 'Supplier name')
    .option('--face-value <amount>', 'Face value amount (e.g. 25, 10.50)')
    .option('--face-value-type <type>', `Face value currency/unit: ${VALID_FACE_VALUE_TYPES.join(', ')}`)
    .option('--custom-reward-type <type>', `For CUSTOM_REWARD: ${VALID_CUSTOM_REWARD_TYPES.join(' or ')}`)
    .option('--auto-fulfillment', 'For CUSTOM_REWARD: enable auto-fulfillment')
    .option('--reward-email-auto-send', 'For CUSTOM_REWARD: enable reward email auto-send')
    .option('--warn-limit <n>', 'For MANUAL_COUPON: warn when inventory falls to this count')
    .option('--tag <tag>', 'Tag (repeatable)', collect, [])
    .option('--description <text>', 'Optional description')
    .option('--body <json>', 'Full request body as JSON — overrides all typed flags (use for TANGO_V2, SALESFORCE_COUPON)')
    .option('--dry-run', 'Print request body without creating')
    .action(async function () {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);

      let body;
      if (options.body) {
        try {
          body = JSON.parse(options.body);
        } catch (error) {
          console.error(`Error: --body must be valid JSON: ${error.message}`);
          process.exit(2);
        }
      } else {
        if (!options.type) {
          console.error('Error: --type is required. Use MANUAL_COUPON, CUSTOM_REWARD, TANGO_V2, or SALESFORCE_COUPON. For Tango/Salesforce use --body for full control.');
          process.exit(2);
        }
        if (!options.name) { console.error('Error: --name is required.'); process.exit(2); }
        if (!options.faceValueType) { console.error('Error: --face-value-type is required.'); process.exit(2); }
        if (!VALID_FACE_VALUE_TYPES.includes(options.faceValueType.toUpperCase())) {
          console.error(`Error: --face-value-type must be one of: ${VALID_FACE_VALUE_TYPES.join(', ')}`);
          process.exit(2);
        }

        const supplierType = options.type.toUpperCase();
        body = {
          reward_supplier_type: supplierType,
          name: options.name,
          face_value_type: options.faceValueType.toUpperCase(),
        };
        if (options.faceValue != null) body.face_value = parseFloat(options.faceValue);
        if (options.description) body.description = options.description;
        if (options.tag?.length) body.tags = options.tag;

        if (supplierType === 'CUSTOM_REWARD') {
          if (!options.customRewardType) {
            console.error(`Error: --custom-reward-type is required for CUSTOM_REWARD (${VALID_CUSTOM_REWARD_TYPES.join(' or ')})`);
            process.exit(2);
          }
          if (!VALID_CUSTOM_REWARD_TYPES.includes(options.customRewardType.toUpperCase())) {
            console.error(`Error: --custom-reward-type must be one of: ${VALID_CUSTOM_REWARD_TYPES.join(', ')}`);
            process.exit(2);
          }
          body.type = options.customRewardType.toUpperCase();
          if (options.autoFulfillment) body.auto_fulfillment_enabled = true;
          if (options.rewardEmailAutoSend) body.reward_email_auto_send_enabled = true;
        }

        if (supplierType === 'MANUAL_COUPON') {
          if (options.warnLimit != null) body.coupon_count_warn_limit = parseInt(options.warnLimit, 10);
        }
      }

      if (options.dryRun) {
        console.log(JSON.stringify(body, null, 2));
        return;
      }

      const response = await apiFetch('/v6/reward-suppliers', token, {
        method: 'POST',
        body: JSON.stringify(body),
        verbose: options.verbose,
        baseUrl: API_BASE,
      });
      const text = await response.text();
      if (!response.ok) {
        console.error(`Error ${response.status}: ${text.slice(0, 300)}`);
        process.exit(1);
      }
      const supplier = JSON.parse(text);
      if (options.json) { printJson(supplier, options); return; }
      console.log(`created: ${supplier.id}`);
      console.log(`name:    ${supplier.name}`);
      console.log(`type:    ${supplier.reward_supplier_type}`);
      console.log(`face:    ${formatFaceValue(supplier)}`);
    });

  addGlobalOptions(createCmd, {
    output: true,
    examples: [
      'extole reward-suppliers create --type MANUAL_COUPON --name "Test Coupons" --face-value 25 --face-value-type USD --warn-limit 10 --dry-run',
      'extole reward-suppliers create --type MANUAL_COUPON --name "Test Coupons" --face-value 25 --face-value-type USD --warn-limit 10',
      'extole reward-suppliers create --type CUSTOM_REWARD --name "Statement Credit" --face-value 50 --face-value-type USD --custom-reward-type ACCOUNT_CREDIT',
      "extole reward-suppliers create --body '{\"reward_supplier_type\":\"TANGO_V2\",\"name\":\"Gift Card\",\"face_value_type\":\"USD\",\"face_value\":25,\"account_id\":\"...\",\"utid\":\"...\"}'",
    ],
  });

  // ── upload-coupons ──────────────────────────────────────────────────────

  const uploadCouponsCmd = new Command('upload-coupons')
    .argument('<supplier-id>', 'Manual-coupon reward supplier ID')
    .description('Upload coupon codes to a MANUAL_COUPON reward supplier.')
    .allowExcessArguments(false)
    .option('--file <path>', 'Path to a file with one coupon code per line (CSV or TXT)')
    .option('--codes <codes>', 'Comma-separated coupon codes (for small test batches)')
    .option('--dry-run', 'Print the codes that would be uploaded without sending')
    .action(async function (supplierId) {
      const options = this.optsWithGlobals();
      const token = resolveToken(options);

      if (!options.file && !options.codes) {
        console.error('Error: --file or --codes is required.');
        process.exit(2);
      }
      if (options.file && options.codes) {
        console.error('Error: --file and --codes are mutually exclusive.');
        process.exit(2);
      }

      let codes;
      if (options.file) {
        try {
          codes = readFileSync(options.file, 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        } catch (error) {
          console.error(`Error reading --file: ${error.message}`);
          process.exit(2);
        }
      } else {
        codes = options.codes.split(',').map(code => code.trim()).filter(Boolean);
      }

      if (codes.length === 0) {
        console.error('Error: no coupon codes found.');
        process.exit(2);
      }

      if (options.dryRun) {
        console.log(`Would upload ${codes.length} codes to supplier ${supplierId}:`);
        for (const code of codes.slice(0, 10)) console.log(`  ${code}`);
        if (codes.length > 10) console.log(`  ... and ${codes.length - 10} more`);
        return;
      }

      const response = await apiFetch(`/v2/reward-suppliers/manual-coupons/${supplierId}/coupons`, token, {
        method: 'POST',
        body: JSON.stringify({ coupons: codes }),
        verbose: options.verbose,
        baseUrl: API_BASE,
      });
      const text = await response.text();
      if (!response.ok) {
        console.error(`Error ${response.status}: ${text.slice(0, 300)}`);
        process.exit(1);
      }
      const result = JSON.parse(text);
      if (options.json) { printJson(result, options); return; }
      console.log(`uploaded: ${codes.length} codes to supplier ${supplierId}`);
      if (result.uploaded_count != null) console.log(`accepted: ${result.uploaded_count}`);
      if (result.duplicate_count != null) console.log(`duplicates: ${result.duplicate_count}`);
    });

  addGlobalOptions(uploadCouponsCmd, {
    output: true,
    examples: [
      'extole reward-suppliers upload-coupons <supplier-id> --codes CODE1,CODE2,CODE3',
      'extole reward-suppliers upload-coupons <supplier-id> --file ./coupons.txt',
      'extole reward-suppliers upload-coupons <supplier-id> --file ./coupons.txt --dry-run',
    ],
  });

  cmd.addCommand(createCmd);
  cmd.addCommand(uploadCouponsCmd);
  cmd.addCommand(couponsCmd);

  return cmd;
}
