import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, formatEventDate } from '../utils.js';

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
    .description('Inspect configured reward suppliers — manual-coupon batches, Tango, PayPal payouts, BHN, custom suppliers. Use it to see what reward types exist on the account, their face values, and (for manual-coupon suppliers) how many codes are left.')
    .allowExcessArguments(false)
    .option('--filter <substr>', 'Case-insensitive substring match on supplier name or type')
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

  cmd._mcpDescription = 'START HERE for reward supplier investigations. Lists all reward suppliers — manual coupon batches, Tango/BHN gift cards, PayPal payouts, custom suppliers. Returns supplier_id, type, name, face value, and enabled status. Next steps: reward-suppliers_get for full config of one supplier, reward-suppliers_coupons to check coupon inventory. Note: rewards_suppliers and rewards_suppliers_get are aliases excluded from MCP — always use the reward-suppliers namespace.';
  getCmd._mcpDescription = 'Get full configuration for a reward supplier by supplier_id. Returns face value, auto-fulfillment settings, expiry, tags, limits, and type-specific config (Tango UTID, PayPal account, etc.). Use when you need to understand how a supplier is configured or to verify it is set up correctly.';
  couponsCmd._mcpDescription = 'For MANUAL_COUPON suppliers: show inventory count and a sample of available codes. Use to check if a supplier is running low before a campaign launch. Use --list to dump all codes (paged). Returns count, warn_limit, and sample codes. Refuses non-MANUAL_COUPON suppliers with a clear error.';

  cmd.addCommand(couponsCmd);

  return cmd;
}
