// extole wismr — Where Is My Reward
//
// Composite diagnostic for the canonical Extole support workflow: a customer
// reports they should have received a reward and didn't. The command walks the
// full chain — person → rewards → state history → campaign rule → reward
// supplier — and surfaces the most likely cause + next step.
//
// Like `events fire --route` is to event-routing diagnostics, this is to
// reward-issuance diagnostics. Composite of:
//   findPerson + /v5/persons/{id}/rewards
//   + /v2/rewards/{id}/history
//   + /v2/campaigns/{id}/incentive/reward-rules
//   + /v6/reward-suppliers/{id}/built

import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, isValidEmail, formatEventDate } from '../utils.js';
import { findPerson } from '../person-api.js';

async function fetchPersonRewards(personId, token, verbose, limit = 25) {
  const qs = new URLSearchParams({ limit: String(limit) });
  return apiJson(`/v5/persons/${personId}/rewards?${qs}`, token, { verbose, baseUrl: API_BASE });
}

async function fetchRewardHistory(rewardId, token, verbose) {
  return apiJson(`/v2/rewards/${rewardId}/history`, token, { verbose, baseUrl: API_BASE });
}

async function fetchRewardRules(campaignId, token, verbose) {
  return apiJson(`/v2/campaigns/${campaignId}/incentive/reward-rules`, token, { verbose, baseUrl: API_BASE });
}

async function fetchSupplier(supplierId, token, verbose) {
  return apiJson(`/v6/reward-suppliers/${supplierId}/built`, token, { verbose, baseUrl: API_BASE });
}

function formatFaceValue(s) {
  if (!s || s.face_value == null) return '';
  const t = s.face_value_type || '';
  if (t === 'PERCENT_OFF') return `${s.face_value}% off`;
  if (t === 'USD') return `$${s.face_value}`;
  if (t === 'POINTS') return `${s.face_value} points`;
  return `${s.face_value} ${t}`.trim();
}

// Pick the reward-rule that most plausibly fired this reward: match rewardee
// role and trigger action type if both available, fall back to first.
function pickMatchingRule(rules, reward) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const roleRaw = reward.data?.rewardee_role;
  const rewardeeRole = typeof roleRaw === 'string' ? roleRaw : (roleRaw?.value || null);
  const supplierId = reward.reward_supplier_id;
  const exact = rules.find(r =>
    (supplierId ? r.reward_supplier_id === supplierId : true) &&
    (rewardeeRole ? String(r.rewardee || '').toUpperCase() === rewardeeRole.toUpperCase() : true)
  );
  if (exact) return exact;
  if (supplierId) {
    const bySupplier = rules.find(r => r.reward_supplier_id === supplierId);
    if (bySupplier) return bySupplier;
  }
  return rules[0];
}

function diagnose(reward, history) {
  // Return a short diagnostic string about this reward's likely status.
  const state = (reward.state || '').toUpperCase();
  const hist = Array.isArray(history) ? history : [];

  // Only call out failure if we did NOT eventually succeed in reaching the
  // current state. A reward that failed FULFILLED three times before
  // succeeding (e.g., low reward balance, then resolved) is currently fine.
  const succeededToCurrent = hist.some(h => h.success && (h.state_type || '').toUpperCase() === state);
  const lastFailed = hist.slice().reverse().find(h => h.success === false);
  if (lastFailed && !succeededToCurrent) {
    return `FAILED transition: ${lastFailed.state_type}${lastFailed.message ? ` — ${lastFailed.message}` : ''}`;
  }

  // Note prior failures that were eventually resolved — operator context.
  const retryNote = lastFailed && succeededToCurrent
    ? ` (note: ${hist.filter(h => h.success === false).length} earlier failed attempt${hist.filter(h => h.success === false).length === 1 ? '' : 's'} — eventually resolved)`
    : '';

  if (state === 'EARNED') {
    return 'Earned but never fulfilled — supplier may have failed to mint, or fulfillment is queued. Check supplier inventory / partner API.' + retryNote;
  }
  if (state === 'FULFILLED') {
    return 'Fulfilled (supplier minted the value) but not yet SENT — customer may not have received the email/notification yet.' + retryNote;
  }
  if (state === 'SENT') {
    return 'Sent to the customer. If they say they did not receive it, check delivery (spam, wrong email, email-domain DKIM).' + retryNote;
  }
  if (state === 'REDEEMED') {
    return 'Redeemed — customer used the reward. Working as intended.' + retryNote;
  }
  if (state === 'CANCELED') {
    return 'Canceled (manually or by rule). Operator cancellation appears in history with operator_user_id.';
  }
  if (state === 'REVOKED') {
    return 'Revoked after fulfillment (typically fraud / abuse).';
  }
  if (state === 'EXPIRED') {
    return 'Expired without redemption (past default_coupon_expiry_date or supplier minimum_coupon_lifetime).';
  }
  return `State: ${state || 'unknown'}`;
}

export function wismrCommand() {
  const cmd = new Command('wismr')
    .description('"Where Is My Reward" — the canonical reward-issuance diagnostic. Walks a person\'s reward chain (person → rewards → state history → campaign rule → supplier) and surfaces the likely cause + next step.')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Customer email address')
    .option('--limit <n>', 'Number of recent rewards to walk (default 5)', '5')
    .action(async function () {
      const opts = this.optsWithGlobals();
      if (!isValidEmail(opts.email)) {
        console.error('Error: --email must be a valid email address.');
        process.exit(2);
      }
      const token = resolveToken(opts);

      // ── 1. Find the person ───────────────────────────────────────────────
      const match = await findPerson(opts.email, token, opts.verbose);
      if (!match) {
        console.error(`No person found for ${opts.email}.`);
        console.error('  → email may not be in this account, or may not match an identity key on a person record.');
        console.error('  → if you expect the customer to exist here, verify the email and the --account context.');
        process.exit(1);
      }

      // ── 2. Fetch rewards ─────────────────────────────────────────────────
      const limit = Math.max(1, parseInt(opts.limit, 10) || 5);
      const rewards = await fetchPersonRewards(match.id, token, opts.verbose, limit);
      const list = Array.isArray(rewards) ? rewards : [];

      if (opts.json) {
        // For JSON consumers, return the structured data we walked
        const enriched = await Promise.all(list.map(async r => {
          const [history, rules] = await Promise.all([
            fetchRewardHistory(r.id || r.reward_id, token, opts.verbose).catch(() => []),
            r.campaign_id ? fetchRewardRules(r.campaign_id, token, opts.verbose).catch(() => []) : Promise.resolve([]),
          ]);
          const rule = pickMatchingRule(rules, r);
          const supplier = (rule?.reward_supplier_id || r.reward_supplier_id)
            ? await fetchSupplier(rule?.reward_supplier_id || r.reward_supplier_id, token, opts.verbose).catch(() => null)
            : null;
          return { reward: r, history, rule, supplier, diagnosis: diagnose(r, history) };
        }));
        printJson({ person_id: match.id, email: opts.email, rewards: enriched }, opts);
        return;
      }

      // ── Human output ────────────────────────────────────────────────────
      console.log(`Person: ${opts.email}  (id: ${match.id})`);
      console.log('');

      if (list.length === 0) {
        console.log('No rewards exist for this person.');
        console.log('');
        console.log('Possible reasons:');
        console.log('  → the qualifying event was never fired or never received by Extole');
        console.log('  → the event fired but no campaign matched (targeting, journey, program scope)');
        console.log('  → the campaign matched but the reward rule\'s eligibility was not met');
        console.log('');
        console.log('Next steps to diagnose:');
        console.log(`  extole person steps --email ${opts.email}            # see what events landed for this person`);
        console.log(`  extole events fire <event> --email ${opts.email} --sandbox --route   # check campaign routing for a representative event`);
        return;
      }

      console.log(`${list.length} reward${list.length === 1 ? '' : 's'} (most recent first):\n`);

      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const rewardId = r.id || r.reward_id;

        // Fetch chain data in parallel for this reward
        const [history, rules] = await Promise.all([
          fetchRewardHistory(rewardId, token, opts.verbose).catch(() => []),
          r.campaign_id ? fetchRewardRules(r.campaign_id, token, opts.verbose).catch(() => []) : Promise.resolve([]),
        ]);
        const rule = pickMatchingRule(rules, r);
        const supplierId = rule?.reward_supplier_id || r.reward_supplier_id;
        const supplier = supplierId
          ? await fetchSupplier(supplierId, token, opts.verbose).catch(() => null)
          : null;

        // Header
        const stateUpper = (r.state || '').toUpperCase();
        const stateLabel = stateUpper.padEnd(10);
        const face = r.face_value != null
          ? `${r.face_value} ${r.face_value_type || ''}`.trim()
          : (supplier ? formatFaceValue(supplier) : '');
        const createdDate = r.created_date || r.created_at;
        console.log(`  [${i + 1}] ${stateLabel}  ${face.padEnd(14)}  ${r.journey_name || ''}  ${createdDate ? formatEventDate(createdDate) : ''}`);
        console.log(`      reward_id:    ${rewardId}`);
        if (r.partner_reward_id) console.log(`      coupon:       ${r.partner_reward_id}`);
        if (r.campaign_id) console.log(`      campaign:     ${r.campaign_id}`);

        // State history timeline
        if (Array.isArray(history) && history.length) {
          console.log('      history:');
          const sorted = history.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          for (const h of sorted) {
            const ok = h.success ? '✓' : '✗';
            const when = formatEventDate(h.created_at);
            const msg = h.message ? `  — ${h.message}` : '';
            const op = h.operator_user_id ? `  by user ${h.operator_user_id}` : '';
            console.log(`        ${ok}  ${(h.state_type || '').padEnd(10)}  ${when}${op}${msg}`);
          }
        }

        // Rule context
        if (rule) {
          const constraints = [];
          if (rule.reward_count_limit) constraints.push(`limit=${rule.reward_count_limit}`);
          if (rule.is_unique_friend_required) constraints.push('unique_friend');
          if (rule.is_email_required) constraints.push('email_required');
          console.log(`      rule:         ${rule.rewardee || '?'} on ${rule.trigger_action_type || '?'}${constraints.length ? `  [${constraints.join(', ')}]` : ''}`);
        }

        // Supplier context
        if (supplier) {
          console.log(`      supplier:     ${supplier.name || supplier.id}  (${supplier.display_type || '?'}${supplier.face_value != null ? `, ${formatFaceValue(supplier)}` : ''})`);
        }

        // Diagnosis
        console.log(`      diagnosis:    ${diagnose(r, history)}`);
        console.log('');
      }
    });

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole wismr --email jane@example.com',
      'extole wismr --email jane@example.com --limit 3',
      'extole wismr --email jane@example.com --json',
    ],
  });
}
