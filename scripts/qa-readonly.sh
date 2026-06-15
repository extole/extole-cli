#!/usr/bin/env bash
# Read-only README command QA runner. Logs pass/fail to stdout.
set -uo pipefail
export PATH="$HOME/.npm-global/bin:${PATH:-}"

run() {
  local name="$1"
  shift
  local out rc
  out=$(nix develop -c sh -c "export PATH=\$HOME/.npm-global/bin:\$PATH; $*" 2>&1) || true
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "PASS|$name|exit=$rc"
  else
    echo "FAIL|$name|exit=$rc|${out//$'\n'/ }"
  fi
}

# Account
run ping 'extole ping'
run whoami 'extole whoami'
run auth_status 'extole auth status'
run auth_list 'extole auth list'

# Discover fixtures from live account
PROGRAMS=$(nix develop -c sh -c 'export PATH=$HOME/.npm-global/bin:$PATH; extole programs --json' 2>/dev/null || echo '[]')
CAMPAIGN_ID=$(echo "$PROGRAMS" | python3 -c "
import json,sys
try:
  data=json.load(sys.stdin)
  if isinstance(data, list) and data:
    print(data[0].get('campaign_id',''))
except: pass
" 2>/dev/null || true)
WEBHOOK_ID=$(nix develop -c sh -c 'export PATH=$HOME/.npm-global/bin:$PATH; extole webhooks --json' 2>/dev/null | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  items=d if isinstance(d,list) else d.get('webhooks',d.get('items',[]))
  if items: print(items[0].get('webhook_id', items[0].get('id','')))
except: pass
" 2>/dev/null || true)
SUPPLIER_ID=$(nix develop -c sh -c 'export PATH=$HOME/.npm-global/bin:$PATH; extole reward-suppliers --json' 2>/dev/null | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  items=d if isinstance(d,list) else d.get('reward_suppliers',[])
  if items: print(items[0].get('reward_supplier_id', items[0].get('id','')))
except: pass
" 2>/dev/null || true)
COMPONENT_ID=$(nix develop -c sh -c 'export PATH=$HOME/.npm-global/bin:$PATH; extole components --json' 2>/dev/null | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  items=d if isinstance(d,list) else d.get('components',[])
  if items: print(items[0].get('component_id', items[0].get('id','')))
except: pass
" 2>/dev/null || true)
AUDIENCE=$(nix develop -c sh -c 'export PATH=$HOME/.npm-global/bin:$PATH; extole audiences list --json' 2>/dev/null | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  items=d if isinstance(d,list) else d.get('audiences',[])
  if items: print(items[0].get('name', items[0].get('audience_id','')))
except: pass
" 2>/dev/null || true)
ZONE=$(nix develop -c sh -c 'export PATH=$HOME/.npm-global/bin:$PATH; extole zones --json' 2>/dev/null | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  items=d if isinstance(d,list) else (d if isinstance(d,list) else [])
  if isinstance(d,list) and d: print(d[0] if isinstance(d[0],str) else d[0].get('name',''))
  elif isinstance(d,dict):
    z=d.get('zones',[])
    if z: print(z[0] if isinstance(z[0],str) else z[0].get('name',''))
except: pass
" 2>/dev/null || true)
REPORT_TYPE=$(nix develop -c sh -c 'export PATH=$HOME/.npm-global/bin:$PATH; extole reports recommended --json' 2>/dev/null | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  items=d if isinstance(d,list) else d.get('reports',d.get('recommended',[]))
  if items:
    t=items[0]
    print(t.get('name', t.get('report_type','')))
except: pass
" 2>/dev/null || true)

# Person / share-links (demo-data-finserv examples from README — may fail on qa account)
run person_get 'extole person get --email jane@example.com'
run share_links_lookup 'extole share-links lookup chrisbackfillcw214'

# Programs
run programs 'extole programs'
run programs_all 'extole programs --all'

# Campaigns (if fixture found)
if [ -n "${CAMPAIGN_ID:-}" ]; then
  run campaigns_qr "extole campaigns quality-rules $CAMPAIGN_ID"
  run campaigns_maxmind "extole campaigns maxmind $CAMPAIGN_ID"
  run campaigns_rr "extole campaigns reward-rules $CAMPAIGN_ID"
else
  echo "SKIP|campaigns_*|no campaign_id on account"
fi

# Audiences
run audiences_list 'extole audiences list'
if [ -n "${AUDIENCE:-}" ]; then
  run audiences_get "extole audiences get '$AUDIENCE'"
  run audiences_members "extole audiences members '$AUDIENCE' --limit 5"
  run audiences_history "extole audiences history '$AUDIENCE'"
fi

# Components
run components_list 'extole components --limit 5'
run components_types 'extole components types'
if [ -n "${COMPONENT_ID:-}" ]; then
  run components_get "extole components get $COMPONENT_ID"
fi
if [ -n "${CAMPAIGN_ID:-}" ]; then
  run components_download "extole components download $CAMPAIGN_ID --output /tmp/extole-qa-download"
fi

# Zones
run zones_list 'extole zones'
run zones_core 'extole zones core'
if [ -n "${ZONE:-}" ]; then
  run zones_tag "extole zones tag '$ZONE'"
fi

# Events
run events_listen 'extole events listen --tail 3 --duration 10'

# Webhooks
run webhooks_list 'extole webhooks'
if [ -n "${WEBHOOK_ID:-}" ]; then
  run webhooks_get "extole webhooks get $WEBHOOK_ID"
  run webhooks_dispatches "extole webhooks dispatches $WEBHOOK_ID --limit 5"
  run webhooks_dispatch_results "extole webhooks dispatch-results $WEBHOOK_ID --limit 5"
fi

# Notifications
run notifications 'extole notifications --limit 5'

# Reports
run reports_recommended 'extole reports recommended'
run reports_types 'extole reports types --filter summary'
if [ -n "${REPORT_TYPE:-}" ]; then
  run reports_describe "extole reports describe --type $REPORT_TYPE"
fi

# Health
run health 'extole health'

# Chat
run chat 'extole chat "what is a share link?"'

# API
run api_search 'extole api search person'
run api_path 'extole api /v6/webhooks/built'

# Schema
run schema 'extole schema'

# Rewards / reward-suppliers
run rewards_list 'extole rewards --email jane@example.com'
run rewards_state_summary 'extole rewards state-summary'
run reward_suppliers_list 'extole reward-suppliers'
if [ -n "${SUPPLIER_ID:-}" ]; then
  run reward_suppliers_get "extole reward-suppliers get $SUPPLIER_ID"
fi

# Stream alias
run stream 'extole stream --tail 2 --duration 8'

echo "FIXTURES|campaign=$CAMPAIGN_ID|webhook=$WEBHOOK_ID|supplier=$SUPPLIER_ID|component=$COMPONENT_ID|audience=$AUDIENCE|zone=$ZONE|report_type=$REPORT_TYPE"
