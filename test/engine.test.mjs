import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  DeterministicStateMachine,
  STEPS_SPEC,
  sha256Hex,
  SCENARIO,
  computeFundSplit,
  computeRoyaltySplit,
  computeRoyaltyPayout,
  computeCredentialHash,
  verifyCredential,
  runScenario,
} from '../src/engine.mjs';

test('deterministic state machine executes all 3 try-it steps identically across runs', () => {
  const m1 = new DeterministicStateMachine().runAllTryItSteps();
  const m2 = new DeterministicStateMachine().runAllTryItSteps();
  assert.equal(m1.eventCount, 3);
  assert.equal(m1.chainVerified, true);
  assert.equal(m1.headHash, m2.headHash);
  assert.deepEqual(m1.events, m2.events);
});

test('tampering with any event payload invalidates hash chain verification', () => {
  const m = new DeterministicStateMachine();
  m.runAllTryItSteps();
  assert.equal(m.verifyChain(), true);
  m.events[1].payload = { summary: 'tampered', metrics: {} };
  assert.equal(m.verifyChain(), false);
});

test('rejects empty step names', () => {
  const m = new DeterministicStateMachine();
  assert.throws(() => m.applyStep('', {}), /stepName must be a non-empty string/);
});

test('each try-it step produces non-empty metrics and valid 64-hex SHA-256 digest', () => {
  const snap = new DeterministicStateMachine().runAllTryItSteps();
  for (let i = 0; i < STEPS_SPEC.length; i++) {
    assert.equal(snap.events[i].step, STEPS_SPEC[i].step);
    assert.match(snap.events[i].hash, /^[0-9a-f]{64}$/);
    assert.ok(Object.keys(snap.events[i].payload.metrics).length > 0);
  }
});

test('fund split is computed: 2,000 USDC gross -> 1,800 treasury + 200 royalty pool', () => {
  const f = computeFundSplit(2000);
  assert.equal(f.treasuryUsdc, 1800);
  assert.equal(f.royaltyPoolUsdc, 200);
  assert.equal(f.treasuryUsdc + f.royaltyPoolUsdc, f.grossUsdc);
});

test('fund split is computed from the input, not pasted (wrong-rate control)', () => {
  const f = computeFundSplit(2000, 8000);
  assert.equal(f.treasuryUsdc, 1600);
  assert.equal(f.royaltyPoolUsdc, 400);
  const g = computeFundSplit(500);
  assert.equal(g.treasuryUsdc, 450);
  assert.equal(g.royaltyPoolUsdc, 50);
});

test('royalty split is computed: 200 pool -> 140 creator + 60 co-author', () => {
  const r = computeRoyaltySplit(200);
  assert.equal(r.creatorUsdc, 140);
  assert.equal(r.coauthorUsdc, 60);
  assert.equal(r.creatorUsdc + r.coauthorUsdc, r.poolUsdc);
});

test('NEP-199 payout: 1,000 USDC sale -> 100 royalty -> 70 creator / 30 co-author', () => {
  const p = computeRoyaltyPayout(1000);
  assert.equal(p.royaltyUsdc, 100);
  assert.equal(p.creatorUsdc, 70);
  assert.equal(p.coauthorUsdc, 30);
});

test('credential hash matches an independently computed sha256 of the canonical preimage', () => {
  const expected = crypto
    .createHash('sha256')
    .update(`${SCENARIO.tokenId}:${SCENARIO.credentialScope}:${SCENARIO.owner}`)
    .digest('hex');
  assert.equal(computeCredentialHash(SCENARIO.tokenId, SCENARIO.credentialScope, SCENARIO.owner), expected);
  assert.match(expected, /^[0-9a-f]{64}$/);
  // A different owner or scope changes the hash.
  assert.notEqual(
    computeCredentialHash(SCENARIO.tokenId, SCENARIO.credentialScope, SCENARIO.buyer),
    expected,
  );
});

test('credential verification: owner ok, stale owner refused, wrong hash refused', () => {
  const hash = computeCredentialHash(SCENARIO.tokenId, SCENARIO.credentialScope, SCENARIO.owner);
  const ok = verifyCredential(SCENARIO.tokenId, SCENARIO.credentialScope, SCENARIO.owner, SCENARIO.owner, hash);
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, 'ok');
  const stale = verifyCredential(SCENARIO.tokenId, SCENARIO.credentialScope, SCENARIO.owner, SCENARIO.buyer, null);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'signer_not_current_owner');
  const wrongHash = verifyCredential(SCENARIO.tokenId, SCENARIO.credentialScope, SCENARIO.owner, SCENARIO.owner, '0'.repeat(64));
  assert.equal(wrongHash.ok, false);
  assert.equal(wrongHash.reason, 'credential_not_presented');
});

test('scenario figures are the ones the README quotes', () => {
  const sc = runScenario();
  assert.equal(sc.treasuryUsdc, 1800);
  assert.equal(sc.royaltyPoolUsdc, 200);
  assert.equal(sc.creatorPayoutUsdc, 140);
  assert.equal(sc.coauthorPayoutUsdc, 60);
  assert.equal(sc.ownerVerified, true);
  assert.equal(sc.staleOwnerVerified, false);
  assert.equal(sc.staleReason, 'signer_not_current_owner');
  assert.equal(sc.buyerVerifiedAfterTransfer, true);
  assert.equal(sc.credentialHash, sha256Hex(`${sc.tokenId}:${sc.credentialScope}:${sc.owner}`));
});
