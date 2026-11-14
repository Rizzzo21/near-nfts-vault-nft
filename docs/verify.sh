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
# This check uses the Node.js standard library only, so the whole verification
# path stays dependency-free (no python3, no npm install needed).
if [ -f docs/testnet-evidence.json ]; then
node --input-type=module -e "
import fs from 'node:fs';
const ev = JSON.parse(fs.readFileSync('docs/testnet-evidence.json', 'utf8'));
const required = ['contract_account', 'credential_hash', 'flow', 'final_state'];
for (const k of required) {
  if (!(k in ev)) {
    console.error('evidence missing field: ' + k);
    process.exit(1);
  }
}
const steps = ['deploy', 'mint', 'fund', 'distribute_royalties', 'present_credential',
               'transfer', 'stale_credential_refused', 'buyer_credential'];
for (const step of steps) {
  const tx = (ev.flow[step] || {}).tx;
  if (!tx || tx.length < 43) {
    console.error('evidence missing tx hash for: ' + step);
    process.exit(1);
  }
}
if (ev.final_state.treasury_yocto !== '900000000000000000000000') {
  console.error('evidence final_state treasury mismatch');
  process.exit(1);
}
if (ev.final_state.royalty_pool_yocto !== '0') {
  console.error('evidence final_state royalty pool not drained');
  process.exit(1);
}
console.log('evidence file OK');
"
else
  echo "no on-chain evidence file (deploy not run yet)"
fi
echo "ALL CHECKS PASSED"
