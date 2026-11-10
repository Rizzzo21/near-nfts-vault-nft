#!/usr/bin/env bash
set -euo pipefail
node --test test/engine.test.mjs
out1="$(node scripts/demo.mjs)"
out2="$(node scripts/demo.mjs)"
if [ "$out1" != "$out2" ]; then
  echo "Determinism check failed"
  exit 1
fi
# On-chain evidence file, when the testnet deploy has been run, must parse
# and carry the required fields. Absent on a fresh clone: not an error.
if [ -f docs/testnet-evidence.json ]; then
python3 - << 'PYEOF'
import json, sys
with open('docs/testnet-evidence.json') as f:
    ev = json.load(f)
required = ['contract_account', 'credential_hash', 'flow', 'final_state']
for k in required:
    if k not in ev:
        print(f"evidence missing field: {k}")
        sys.exit(1)
for step in ['deploy', 'mint', 'fund', 'distribute_royalties', 'present_credential', 'transfer', 'stale_credential_refused', 'buyer_credential']:
    tx = ev['flow'].get(step, {}).get('tx')
    if not tx or len(tx) < 43:
        print(f"evidence missing tx hash for: {step}")
        sys.exit(1)
if ev['final_state'].get('treasury_yocto') != '900000000000000000000000':
    print("evidence final_state treasury mismatch")
    sys.exit(1)
if ev['final_state'].get('royalty_pool_yocto') != '0':
    print("evidence final_state royalty pool not drained")
    sys.exit(1)
print("evidence file OK")
PYEOF
else
  echo "no on-chain evidence file (deploy not run yet)"
fi
echo "ALL CHECKS PASSED"
