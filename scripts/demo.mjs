import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeterministicStateMachine, TRACK_CODE, BOUNTY_ID, runScenario } from '../src/engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const machine = new DeterministicStateMachine();
const snap = machine.runAllTryItSteps();
const scenario = runScenario();

const lines = [
  `=== ${TRACK_CODE} (${BOUNTY_ID}) DETERMINISTIC DEMO TRANSCRIPT ===`,
  `Chain Integrity Verified: ${snap.chainVerified}`,
  `Final State Merkle Head:  ${snap.headHash}`,
  `Credential Hash:          ${scenario.credentialHash}`,
  '',
];

for (const ev of snap.events) {
  lines.push(`[STEP ${ev.index + 1}] ${ev.step}`);
  lines.push(`  Summary: ${ev.payload.summary}`);
  lines.push(`  Metrics: ${JSON.stringify(ev.payload.metrics)}`);
  lines.push(`  Hash:    ${ev.hash}`);
  lines.push('');
}

// On-chain evidence, when the testnet deploy has been run (see
// scripts/deploy-testnet.mjs). Figures above are computed off-chain by the
// model; the tx hashes below are the same flow executed on NEAR testnet.
const evidencePath = path.join(rootDir, 'docs', 'testnet-evidence.json');
if (fs.existsSync(evidencePath)) {
  const ev = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  lines.push('=== ON-CHAIN EVIDENCE (NEAR testnet) ===');
  lines.push(`Contract: ${ev.contract_account}`);
  lines.push(`Token #${ev.token_id} owner after transfer: ${ev.final_state.owner_id}`);
  lines.push(`Credential hash: ${ev.credential_hash}`);
  lines.push(`Deploy:   ${ev.flow.deploy.tx}`);
  lines.push(`Mint:     ${ev.flow.mint.tx}`);
  lines.push(`Fund:     ${ev.flow.fund.tx} (${ev.flow.fund.deposit_near} NEAR -> ${ev.flow.fund.treasury_near} treasury / ${ev.flow.fund.royalty_pool_near} royalty pool)`);
  lines.push(`Royalties:${ev.flow.distribute_royalties.tx} (${ev.flow.distribute_royalties.creator_near} creator / ${ev.flow.distribute_royalties.coauthor_near} co-author)`);
  lines.push(`Credential (owner): ${ev.flow.present_credential.tx} (ok=true)`);
  lines.push(`Transfer: ${ev.flow.transfer.tx} (to ${ev.buyer_account})`);
  lines.push(`Stale credential: ${ev.flow.stale_credential_refused.tx} (REFUSED: signer_not_current_owner)`);
  lines.push(`Credential (buyer): ${ev.flow.buyer_credential.tx} (ok=true)`);
  lines.push(`Final treasury on-chain: ${ev.verified_figures.treasury_near} NEAR`);
  lines.push(`Final royalty balances on-chain: creator ${ev.verified_figures.creator_balance_near} NEAR, co-author ${ev.verified_figures.coauthor_balance_near} NEAR`);
  lines.push(`Explorer: ${ev.contract_explorer}`);
  lines.push('');
}

const transcript = lines.join('\n');
fs.writeFileSync(path.join(rootDir, 'docs', 'demo-transcript.txt'), transcript, 'utf8');
fs.writeFileSync(path.join(rootDir, 'docs', 'demo-trace.json'), JSON.stringify(snap, null, 2) + '\n', 'utf8');
process.stdout.write(transcript);
