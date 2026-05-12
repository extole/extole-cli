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
import { findPerson, getPersonSteps } from '../person-api.js';

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

// Scan a person's recent steps for reward-rule-evaluation failures. When a
// person has zero rewards but qualifying events fired, the reason is usually
// visible as `*_reward_rule_evaluated` steps with quality=LOW and a final
// `reward_evaluated` with state=declined. Return one row per failed rule
// (grouped by campaign + the rule's triggering evaluation timestamp).
function scanRuleFailures(steps) {
  if (!Array.isArray(steps)) return [];
  const failures = [];
  for (const s of steps) {
    const name = s.name || '';
    if (s.quality !== 'LOW') continue;
    if (!name.endsWith('_reward_rule_evaluated') && name !== 'reward_evaluated') continue;
    const data = s.data || {};
    const dataValue = (k) => {
      const v = data[k];
      return v && typeof v === 'object' ? v.value : v;
    };
    failures.push({
      name,
      description: dataValue('description') || null,
      state: dataValue('state') || null,
      campaign_id: s.campaign_id || null,
      journey_name: s.journey_name || null,
      event_date: s.event_date || s.created_date || null,
    });
  }
  return failures;
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

const stateGuidance = {
  EARNED: 'Earned but never fulfilled — supplier may have failed to mint, or fulfillment is queued. Check supplier inventory / partner API.',
  FULFILLED: 'Fulfilled (supplier minted the value) but not yet SENT — customer may not have received the email/notification yet.',
  SENT: 'Sent to the customer. If they say they did not receive it, check delivery (spam, wrong email, email-domain DKIM).',
  REDEEMED: 'Redeemed — customer used the reward. Working as intended.',
  CANCELED: 'Canceled (manually or by rule). Operator cancellation appears in history with operator_user_id.',
  REVOKED: 'Revoked after fulfillment (typically fraud / abuse).',
  EXPIRED: 'Expired without redemption (past default_coupon_expiry_date or supplier minimum_coupon_lifetime).',
};

function diagnose(reward, history) {
  // Return a short diagnostic string about this reward's likely status.
  const state = (reward.state || '').toUpperCase();
  const hist = Array.isArray(history) ? history : [];

  // A failure is "still failing" if the transition it attempted (the
  // state_type it tried to reach) was never subsequently reached
  // successfully. Example: ✗ FULFILLED with no later ✓ FULFILLED means the
  // reward is still stuck. ✗ FULFILLED followed by ✓ FULFILLED + ✓ SENT
  // is a resolved retry.
  const failures = hist.filter(h => h.success === false);
  const lastFailure = failures[failures.length - 1];
  const unresolvedFailure = (() => {
    if (!lastFailure) return null;
    const failedStateType = (lastFailure.state_type || '').toUpperCase();
    const resolvedLater = hist.some(h => h.success && (h.state_type || '').toUpperCase() === failedStateType);
    return resolvedLater ? null : lastFailure;
  })();

  if (unresolvedFailure) {
    const msgPart = unresolvedFailure.message ? ` — ${unresolvedFailure.message}` : '';
    // Append the state-specific guidance so the operator gets an action hint
    // (e.g., "check supplier inventory / partner API") rather than just the
    // bare failure name.
    const guidance = stateGuidance[state] ? ` ${stateGuidance[state]}` : '';
    return `FAILED transition: ${unresolvedFailure.state_type}${msgPart}.${guidance}`;
  }

  // All prior failures eventually resolved — note them for context.
  const retryNote = failures.length > 0
    ? ` (note: ${failures.length} earlier failed attempt${failures.length === 1 ? '' : 's'} — eventually resolved)`
    : '';

  if (stateGuidance[state]) return stateGuidance[state] + retryNote;
  return `State: ${state || 'unknown'}`;
}

// Walk one person's reward chain. For JSON consumers, returns the structured
// per-person result. For human output, prints directly and returns null.
async function investigatePerson(email, opts, token, limit) {
  const match = await findPerson(email, token, opts.verbose);
  if (!match) {
    if (opts.json) return { email, person_id: null, error: 'person_not_found' };
    console.log(`Person: ${email}  — not found in this account.`);
    console.log('  → email may not be in this account, or may not match an identity key on a person record.');
    console.log('  → if you expect the customer to exist here, verify the email and the --account context.');
    return null;
  }

  const rewards = await fetchPersonRewards(match.id, token, opts.verbose, limit);
  const list = Array.isArray(rewards) ? rewards : [];

  // When there are zero rewards, scan recent steps for rule-evaluation
  // failures (e.g., risk eval declined) — most common "rewards is empty
  // but should not be" cause.
  let ruleFailures = [];
  if (list.length === 0) {
    const steps = await getPersonSteps(match.id, token, 50, opts.verbose).catch(() => []);
    ruleFailures = scanRuleFailures(steps);
  }

  if (opts.json) {
    if (list.length === 0) {
      return { email, person_id: match.id, rewards: [], rule_failures: ruleFailures };
    }
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
    return { email, person_id: match.id, rewards: enriched };
  }

  // ── Human output ─────────────────────────────────────────────────────────
  console.log(`Person: ${email}  (id: ${match.id})`);
  console.log('');

  if (list.length === 0) {
    console.log('No rewards exist for this person.');
    console.log('');

    if (ruleFailures.length > 0) {
      console.log(`Found ${ruleFailures.length} failed reward-rule evaluation${ruleFailures.length === 1 ? '' : 's'} in recent steps — the reward was evaluated but declined:\n`);
      for (const f of ruleFailures) {
        const when = f.event_date ? formatEventDate(f.event_date) : '';
        const ruleLabel = f.name === 'reward_evaluated'
          ? (f.state ? `reward_evaluated  state=${f.state}` : 'reward_evaluated')
          : f.name.replace(/_reward_rule_evaluated$/, '');
        console.log(`  ✗  ${ruleLabel}`);
        if (f.description) console.log(`        why:       ${f.description}`);
        if (f.journey_name) console.log(`        journey:   ${f.journey_name}`);
        if (f.campaign_id) console.log(`        campaign:  ${f.campaign_id}`);
        if (when) console.log(`        when:      ${when}`);
        console.log('');
      }
      console.log('Next steps:');
      console.log(`  extole person steps --email ${email}            # full step history with rule data`);
      console.log('  If the customer is legitimate, an operator can issue the reward manually.');
      console.log('  If false positives are common on this campaign, review the failing rule\'s threshold.');
      return null;
    }

    console.log('Possible reasons:');
    console.log('  → the qualifying event was never fired or never received by Extole');
    console.log('  → the event fired but no campaign matched (targeting, journey, program scope)');
    console.log('  → the campaign matched but the reward rule\'s eligibility was not met');
    console.log('');
    console.log('Next steps to diagnose:');
    console.log(`  extole person steps --email ${email}            # see what events landed for this person`);
    console.log(`  extole events fire <event> --email ${email} --sandbox --route   # check campaign routing for a representative event`);
    return null;
  }

  console.log(`${list.length} reward${list.length === 1 ? '' : 's'} (most recent first):\n`);

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const rewardId = r.id || r.reward_id;

    const [history, rules] = await Promise.all([
      fetchRewardHistory(rewardId, token, opts.verbose).catch(() => []),
      r.campaign_id ? fetchRewardRules(r.campaign_id, token, opts.verbose).catch(() => []) : Promise.resolve([]),
    ]);
    const rule = pickMatchingRule(rules, r);
    const supplierId = rule?.reward_supplier_id || r.reward_supplier_id;
    const supplier = supplierId
      ? await fetchSupplier(supplierId, token, opts.verbose).catch(() => null)
      : null;

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

    if (rule) {
      const constraints = [];
      if (rule.reward_count_limit) constraints.push(`limit=${rule.reward_count_limit}`);
      if (rule.is_unique_friend_required) constraints.push('unique_friend');
      if (rule.is_email_required) constraints.push('email_required');
      console.log(`      rule:         ${rule.rewardee || '?'} on ${rule.trigger_action_type || '?'}${constraints.length ? `  [${constraints.join(', ')}]` : ''}`);
    }

    if (supplier) {
      console.log(`      supplier:     ${supplier.name || supplier.id}  (${supplier.display_type || '?'}${supplier.face_value != null ? `, ${formatFaceValue(supplier)}` : ''})`);
    }

    console.log(`      diagnosis:    ${diagnose(r, history)}`);
    console.log('');
  }
  return null;
}

export function wismrCommand() {
  const cmd = new Command('wismr')
    .description('"Where Is My Reward" — the canonical reward-issuance diagnostic. Walks a person\'s reward chain (person → rewards → state history → campaign rule → supplier) and surfaces the likely cause + next step. Accepts one email or a comma-separated list (e.g., to investigate an advocate + friend pair).')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Customer email address (or comma-separated list)')
    .option('--limit <n>', 'Number of recent rewards to walk per person (default 5)', '5')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const emails = String(opts.email).split(',').map(e => e.trim()).filter(Boolean);
      if (emails.length === 0) {
        console.error('Error: --email must contain at least one email address.');
        process.exit(2);
      }
      const invalid = emails.filter(e => !isValidEmail(e));
      if (invalid.length > 0) {
        console.error(`Error: invalid email${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}`);
        process.exit(2);
      }

      const token = resolveToken(opts);
      const limit = Math.max(1, parseInt(opts.limit, 10) || 5);

      if (opts.json) {
        const results = [];
        for (const email of emails) {
          results.push(await investigatePerson(email, opts, token, limit));
        }
        printJson(results, opts);
        return;
      }

      for (let i = 0; i < emails.length; i++) {
        if (i > 0) {
          console.log('═'.repeat(72));
          console.log('');
        }
        await investigatePerson(emails[i], opts, token, limit);
      }
    });

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole wismr --email jane@example.com',
      'extole wismr --email jane@example.com --limit 3',
      'extole wismr --email jane@example.com --json',
      'extole wismr --email advocate@example.com,friend@example.com   # walk a related pair',
    ],
  });
}
