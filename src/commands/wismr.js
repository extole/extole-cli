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
import { findPerson, findPersonById, getPersonSteps } from '../person-api.js';

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

async function resolveCampaignNames(campaignIds, token, verbose) {
  const unique = [...new Set(campaignIds.filter(Boolean))];
  const entries = await Promise.all(unique.map(async (id) => {
    try {
      const c = await apiJson(`/v2/campaigns/${id}/built`, token, { verbose, baseUrl: API_BASE });
      return [id, c?.name || null];
    } catch { return [id, null]; }
  }));
  return new Map(entries);
}

function fmtCampaign(id, names) {
  if (!id) return '';
  const n = names?.get(id);
  return n ? `${id}  (${n})` : id;
}

// Pull cross-person references off each reward. Each Extole reward carries
// data.other_person_id when it was minted as part of a related-party journey
// (advocate ↔ friend, employee ↔ referred customer). Combined with the
// rewardee_role, this lets us reconstruct who-referred-whom when multiple
// related emails are passed to wismr in one call.
function extractReferences(rewardList) {
  if (!Array.isArray(rewardList)) return [];
  const refs = [];
  for (const r of rewardList) {
    const data = r.data || {};
    const unwrap = (v) => (v && typeof v === 'object' && 'value' in v) ? v.value : v;
    const other = unwrap(data.other_person_id);
    if (!other) continue;
    refs.push({
      rewardee_role: unwrap(data.rewardee_role) || null,
      other_person_id: String(other),
      journey_name: r.journey_name || null,
      campaign_id: r.campaign_id || null,
    });
  }
  return refs;
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

// Scan for non-rule-eval LOW-quality steps. Rule-eval failures are handled
// by scanRuleFailures; this catches the case where the qualifying event itself
// was marked LOW (quality rule, dedupe, bot detection) and therefore never
// reached reward-rule evaluation. The operator reads the step names and
// recognizes which are their account's qualifying events.
function scanLowQualitySteps(steps) {
  if (!Array.isArray(steps)) return [];
  const rows = [];
  for (const s of steps) {
    const name = s.name || '';
    if (s.quality !== 'LOW') continue;
    if (name.endsWith('_reward_rule_evaluated') || name === 'reward_evaluated') continue;
    const data = s.data || {};
    const unwrap = (v) => (v && typeof v === 'object' && 'value' in v) ? v.value : v;
    rows.push({
      name,
      campaign_id: s.campaign_id || null,
      journey_name: s.journey_name || null,
      event_date: s.event_date || s.created_date || null,
      action_id: unwrap(data.legacy_action_id) || null,
    });
  }
  return rows;
}

// Fetch the per-rule quality decisions for an action. Returns an array of
// { rule_name, message } for any rule that scored LOW. The /v0/actions/detail
// endpoint is the legacy surface that Event History UI also reads — it carries
// the actual per-rule quality_score and the rule's explanation message.
async function fetchActionDeclineReasons(actionId, token, verbose) {
  try {
    const d = await apiJson(`/v0/actions/detail/${actionId}.json`, token, { verbose, baseUrl: API_BASE });
    const item = (d?.data && d.data[0]) || d;
    if (!item) return [];
    const lows = [];
    for (const u of (item.review_updates || [])) {
      for (const t of (u.trigger_results || [])) {
        if (String(t.quality_score || '').toUpperCase() !== 'LOW') continue;
        lows.push({
          rule_name: t.name || t.rule_name || null,
          message: t.message || null,
        });
      }
    }
    return lows;
  } catch { return []; }
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

// Walk one person's reward chain. Always returns a summary
// { email, person_id, references } so the caller can detect cross-person
// relationships across multi-email queries. In JSON mode the summary also
// carries the full enriched per-reward data. In human mode side effects are
// printed inline.
async function investigatePerson(email, opts, token, limit) {
  const match = await findPerson(email, token, opts.verbose);
  if (!match) {
    if (opts.json) return { email, person_id: null, error: 'person_not_found', references: [], other_person_emails: [] };
    console.log(`Person: ${email}  — not found in this account.`);
    console.log('  → email may not be in this account, or may not match an identity key on a person record.');
    console.log('  → if you expect the customer to exist here, verify the email and the --account context.');
    return { email, person_id: null, references: [], other_person_emails: [] };
  }

  const rewards = await fetchPersonRewards(match.id, token, opts.verbose, limit);
  const list = Array.isArray(rewards) ? rewards : [];
  const references = extractReferences(list);

  // Always scan recent steps for rule-evaluation declines. With zero rewards,
  // surface all of them (the most common "rewards is empty but should not be"
  // cause). With rewards present, surface only declines newer than the most
  // recent reward — those are customer-impacting events not yet reflected in
  // any reward record (older declines that eventually issued are noise).
  const steps = await getPersonSteps(match.id, token, 50, opts.verbose).catch(() => []);
  const allFailures = scanRuleFailures(steps);
  const mostRecentRewardMs = list.reduce((max, r) => {
    const t = Date.parse(r.created_date || r.created_at || '');
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  const ruleFailures = list.length === 0
    ? allFailures
    : allFailures.filter(f => {
        const t = Date.parse(f.event_date || '');
        return Number.isFinite(t) && t > mostRecentRewardMs;
      });
  // Only surface raw LOW-quality steps as a fallback when nothing else
  // explains the missing reward (zero rewards AND zero rule-eval failures).
  const lowQualitySteps = (list.length === 0 && ruleFailures.length === 0)
    ? scanLowQualitySteps(steps)
    : [];

  // For LOW-quality steps, fetch per-rule decisions in parallel (dedup'd by
  // action_id) so we can show *which* quality rule rejected each event.
  if (lowQualitySteps.length > 0) {
    const uniqueActionIds = [...new Set(lowQualitySteps.map(s => s.action_id).filter(Boolean))];
    const reasonsByAction = new Map();
    await Promise.all(uniqueActionIds.map(async (aid) => {
      reasonsByAction.set(aid, await fetchActionDeclineReasons(aid, token, opts.verbose));
    }));
    for (const s of lowQualitySteps) {
      s.decline_reasons = s.action_id ? (reasonsByAction.get(s.action_id) || []) : [];
    }
  }

  // Resolve campaign IDs → display names once, share across all render paths.
  const campaignIds = [
    ...list.map(r => r.campaign_id),
    ...ruleFailures.map(f => f.campaign_id),
    ...lowQualitySteps.map(s => s.campaign_id),
  ];

  // Resolve other_person_id → profile + rewards for inline display and anomaly detection.
  const otherPersonIds = [...new Set(list.map(r => {
    const v = r.data?.other_person_id;
    return v && typeof v === 'object' ? v.value : v;
  }).filter(Boolean))];
  const otherPersonMap = new Map();   // id → profile
  const otherRewardsMap = new Map();  // id → rewards[]
  await Promise.all(otherPersonIds.map(async (id) => {
    const [p, rewards] = await Promise.all([
      findPersonById(id, token, opts.verbose),
      fetchPersonRewards(id, token, opts.verbose, 25).catch(() => []),
    ]);
    if (p) otherPersonMap.set(String(id), p);
    otherRewardsMap.set(String(id), Array.isArray(rewards) ? rewards : []);
  }));

  const getProfileEmail = (p) =>
    p?.partner_user_id || p?.email ||
    (p?.identities || []).find(i => i.type === 'EMAIL')?.value || null;
  const otherPersonEmails = [...otherPersonMap.values()].map(getProfileEmail).filter(e => e && isValidEmail(e));

  const campaignNames = await resolveCampaignNames(campaignIds, token, opts.verbose);

  if (opts.json) {
    if (list.length === 0) {
      return { email, person_id: match.id, rewards: [], rule_failures: ruleFailures, low_quality_steps: lowQualitySteps, references, other_person_emails: otherPersonEmails };
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
      const rawOid = r.data?.other_person_id;
      const oid = rawOid && typeof rawOid === 'object' ? rawOid.value : rawOid;
      const otherPerson = oid ? otherPersonMap.get(String(oid)) : null;
      return { reward: r, history, rule, supplier, diagnosis: diagnose(r, history), other_person: otherPerson || null };
    }));
    return { email, person_id: match.id, rewards: enriched, rule_failures: ruleFailures, references, other_person_emails: otherPersonEmails };
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
        if (f.campaign_id) console.log(`        campaign:  ${fmtCampaign(f.campaign_id, campaignNames)}`);
        if (when) console.log(`        when:      ${when}`);
        console.log('');
      }
      console.log('Next steps:');
      console.log(`  extole person steps --email ${email}            # full step history with rule data`);
      console.log('  If the customer is legitimate, an operator can issue the reward manually.');
      console.log('  If false positives are common on this campaign, review the failing rule\'s threshold.');
      return { email, person_id: match.id, references };
    }

    if (lowQualitySteps.length > 0) {
      console.log(`Recent LOW-quality event${lowQualitySteps.length === 1 ? '' : 's'} (${lowQualitySteps.length}):\n`);
      for (const s of lowQualitySteps) {
        const when = s.event_date ? formatEventDate(s.event_date) : '';
        console.log(`  ⚠  ${s.name}`);
        if (Array.isArray(s.decline_reasons) && s.decline_reasons.length > 0) {
          for (const d of s.decline_reasons) {
            const ruleLine = d.message ? `${d.rule_name} — ${d.message}` : d.rule_name;
            console.log(`        rule:      ✗ ${ruleLine}`);
          }
        }
        if (s.journey_name) console.log(`        journey:   ${s.journey_name}`);
        if (s.campaign_id) console.log(`        campaign:  ${fmtCampaign(s.campaign_id, campaignNames)}`);
        if (when) console.log(`        when:      ${when}`);
        console.log('');
      }
      console.log('Next steps:');
      console.log(`  extole person steps --email ${email}            # full step history`);
      return { email, person_id: match.id, references };
    }

    console.log('Possible reasons:');
    console.log('  → the qualifying event was never fired or never received by Extole');
    console.log('  → the event fired but no campaign matched (targeting, journey, program scope)');
    console.log('  → the campaign matched but the reward rule\'s eligibility was not met');
    console.log('');
    console.log('Next steps to diagnose:');
    console.log(`  extole person steps --email ${email}            # see what events landed for this person`);
    console.log(`  extole events fire <event> --email ${email} --sandbox --route   # check campaign routing for a representative event`);
    return { email, person_id: match.id, references };
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
    const rawOtherId = r.data?.other_person_id;
    const otherId = rawOtherId && typeof rawOtherId === 'object' ? rawOtherId.value : rawOtherId;
    if (otherId) {
      const otherPerson = otherPersonMap.get(String(otherId));
      const rawRole = r.data?.rewardee_role;
      const myRole = (rawRole && typeof rawRole === 'object' ? rawRole.value : rawRole) || null;
      const otherRole = myRole ? (ADVOCATE_SIDE_ROLES.has(myRole.toLowerCase()) ? 'friend' : 'advocate') : 'other person';
      const otherEmail = otherPerson?.partner_user_id || otherPerson?.email ||
        (otherPerson?.identities || []).find(i => i.type === 'EMAIL')?.value || null;
      const otherName = [otherPerson?.first_name, otherPerson?.last_name].filter(Boolean).join(' ') || null;
      const otherLabel = [otherEmail, otherName ? `(${otherName})` : null].filter(Boolean).join(' ') || otherId;
      console.log(`      ${otherRole}:      ${otherLabel}`);

      // Anomaly detection: find the other party's reward for this same referral
      // and flag if face values differ.
      if (r.face_value != null) {
        const otherRewards = otherRewardsMap.get(String(otherId)) || [];
        const unwrapV = v => v && typeof v === 'object' ? v.value : v;
        const counterpart = otherRewards.find(or => {
          if (or.campaign_id !== r.campaign_id) return false;
          const orOtherId = unwrapV(or.data?.other_person_id);
          return String(orOtherId) === String(match.id);
        });
        if (counterpart && counterpart.face_value != null) {
          if (counterpart.face_value !== r.face_value) {
            const myFmt = `$${r.face_value}`;
            const theirFmt = `$${counterpart.face_value}`;
            console.log(`      ⚠ this person received ${myFmt}, ${otherRole} received ${theirFmt} — reward amounts differ`);
          }
        }
      }
    }
    if (r.campaign_id) console.log(`      campaign:     ${fmtCampaign(r.campaign_id, campaignNames)}`);

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

  if (ruleFailures.length > 0) {
    console.log(`Recent reward-rule decline${ruleFailures.length === 1 ? '' : 's'} (${ruleFailures.length}):\n`);
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
    console.log('');
  }

  return { email, person_id: match.id, references, other_person_emails: otherPersonEmails };
}

// Given the per-person summaries collected from a multi-email wismr run,
// detect confirmed cross-person relationships and merge bidirectional edges
// into a single pair entry. An edge from A→B exists when A's reward
// references B via data.other_person_id AND B was also in the query (so we
// know who B is by email).
const ADVOCATE_SIDE_ROLES = new Set(['advocate', 'employee', 'referrer', 'sender', 'tech', 'technician']);

function detectRelationships(summaries) {
  const byId = new Map();
  for (const s of summaries) {
    if (s && s.person_id) byId.set(String(s.person_id), s);
  }
  const edges = [];
  for (const s of summaries) {
    if (!s || !s.references) continue;
    for (const ref of s.references) {
      const other = byId.get(String(ref.other_person_id));
      if (!other) continue;
      edges.push({
        from_email: s.email,
        from_role: ref.rewardee_role,
        to_email: other.email,
        journey_name: ref.journey_name,
        campaign_id: ref.campaign_id,
      });
    }
  }

  // Merge bidirectional edges. When A→B and B→A both exist, the pair is a
  // confirmed two-sided relationship — present it once with both roles
  // ordered advocate-side first.
  const merged = [];
  const seen = new Set();
  for (const e of edges) {
    const key = [e.from_email, e.to_email].sort().join('|');
    if (seen.has(key)) continue;
    const reverse = edges.find(o => o !== e && o.from_email === e.to_email && o.to_email === e.from_email);
    const isAdvocateSide = (role) => ADVOCATE_SIDE_ROLES.has(String(role || '').toLowerCase());
    let left = e, right = reverse;
    if (reverse && !isAdvocateSide(e.from_role) && isAdvocateSide(reverse.from_role)) {
      left = reverse;
      right = e;
    }
    merged.push({
      person_a: left.from_email,
      role_a: left.from_role,
      journey_a: left.journey_name,
      person_b: right ? right.from_email : left.to_email,
      role_b: right ? right.from_role : null,
      journey_b: right ? right.journey_name : null,
      campaign_id: left.campaign_id || (right && right.campaign_id) || null,
      bidirectional: !!reverse,
    });
    seen.add(key);
  }
  return merged;
}

export function wismrCommand() {
  const cmd = new Command('wismr')
    .description('"Where Is My Reward" — the canonical reward-issuance diagnostic. Walks a person\'s reward chain (person → rewards → state history → campaign rule → supplier) and surfaces the likely cause + next step. When a reward references a referral counterpart (other_person_id), automatically follows and investigates that person too. Accepts one email or a comma-separated list.')
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

      const summaries = [];
      if (opts.json) {
        for (const email of emails) {
          summaries.push(await investigatePerson(email, opts, token, limit));
        }
        const investigated = new Set(emails.map(e => e.toLowerCase()));
        for (const s of [...summaries]) {
          for (const e of (s.other_person_emails || [])) {
            if (!investigated.has(e.toLowerCase())) {
              investigated.add(e.toLowerCase());
              summaries.push(await investigatePerson(e, opts, token, limit));
            }
          }
        }
        const relationships = summaries.length > 1 ? detectRelationships(summaries) : [];
        printJson(summaries.length > 1 ? { results: summaries, relationships } : summaries[0], opts);
        return;
      }

      for (let i = 0; i < emails.length; i++) {
        if (i > 0) {
          console.log('═'.repeat(72));
          console.log('');
        }
        summaries.push(await investigatePerson(emails[i], opts, token, limit));
      }

      // Auto-follow referral counterparts resolved from other_person_id
      const investigated = new Set(emails.map(e => e.toLowerCase()));
      for (const s of [...summaries]) {
        for (const e of (s.other_person_emails || [])) {
          if (!investigated.has(e.toLowerCase())) {
            investigated.add(e.toLowerCase());
            console.log('═'.repeat(72));
            console.log('');
            console.log(`↳ Auto-following referral counterpart: ${e}`);
            console.log('');
            summaries.push(await investigatePerson(e, opts, token, limit));
          }
        }
      }

      // Detected relationships footer (multi-email only)
      if (summaries.length > 1) {
        const pairs = detectRelationships(summaries);
        if (pairs.length > 0) {
          console.log('═'.repeat(72));
          console.log('');
          console.log(`Detected relationships (${pairs.length}):\n`);
          for (const p of pairs) {
            const aRole = p.role_a ? ` (${p.role_a})` : '';
            const bRole = p.role_b ? ` (${p.role_b})` : '';
            const arrow = p.bidirectional ? '↔' : '→';
            console.log(`  ${p.person_a}${aRole}  ${arrow}  ${p.person_b}${bRole}`);
            if (p.campaign_id) console.log(`      campaign:  ${p.campaign_id}`);
            if (p.journey_a) console.log(`      journey:   ${p.journey_a}${p.journey_b && p.journey_b !== p.journey_a ? `  /  ${p.journey_b}` : ''}`);
          }
          console.log('');
        }
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
