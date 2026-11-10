import crypto from 'node:crypto';

export const TRACK_CODE = "VAULT-NFT";
export const BOUNTY_ID = "bnty_0420";

// Canonical demo scenario inputs. Every figure the README quotes is
// COMPUTED from these inputs (integer math, no floats) — change an input
// or a split and the tests fail.
export const SCENARIO = {
  tokenId: '42',
  subaccount: 'vault-42.nft.near',
  grossInflowUsdc: 2000,
  treasuryBps: 9000, // 90% of a fund goes to the token treasury
  royaltyBps: 1000, // 10% of a fund goes to the royalty pool
  creatorBps: 7000, // 70% of the royalty pool to creator-ava
  coauthorBps: 3000, // 30% of the royalty pool to co-author-ben
  inventory: ['rig-mk3', 'dataset-v2'],
  credentialScope: 'tier:pro-validator',
  owner: 'owner-42.near',
  buyer: 'buyer-cara.near',
  creator: 'creator-ava.near',
  coauthor: 'co-author-ben.near',
};

const BPS_DENOM = 10000;

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

// Credential canonical form — MUST match the on-chain contract
// (contract/src/index.js): sha256("<token_id>:<scope>:<owner_id>").
export function computeCredentialHash(tokenId, scope, ownerId) {
  return sha256Hex(`${tokenId}:${scope}:${ownerId}`);
}

// Fund split: 90% treasury / 10% royalty pool. Integer math; the pool
// takes the remainder so treasury + pool == gross exactly.
export function computeFundSplit(grossUsdc, treasuryBps = SCENARIO.treasuryBps) {
  const treasury = Math.floor((grossUsdc * treasuryBps) / BPS_DENOM);
  const royaltyPool = grossUsdc - treasury;
  return { grossUsdc, treasuryUsdc: treasury, royaltyPoolUsdc: royaltyPool };
}

// Royalty split: 70% creator / 30% co-author. The co-author takes the
// remainder so creator + coauthor == pool exactly.
export function computeRoyaltySplit(poolUsdc, creatorBps = SCENARIO.creatorBps) {
  const creator = Math.floor((poolUsdc * creatorBps) / BPS_DENOM);
  const coauthor = poolUsdc - creator;
  return { poolUsdc, creatorUsdc: creator, coauthorUsdc: coauthor };
}

// NEP-199 payout for a sale price: 10% royalty, split 70/30. The
// remaining 90% of the sale price goes to the seller (not a royalty).
export function computeRoyaltyPayout(saleUsdc) {
  const royalty = Math.floor((saleUsdc * SCENARIO.royaltyBps) / BPS_DENOM);
  const split = computeRoyaltySplit(royalty);
  return { saleUsdc, royaltyUsdc: royalty, creatorUsdc: split.creatorUsdc, coauthorUsdc: split.coauthorUsdc };
}

// Credential verification, same rule as the contract: only the current
// owner may present, and the presented hash must match the canonical
// preimage for that owner.
export function verifyCredential(tokenId, scope, presenterId, ownerId, storedHash) {
  if (presenterId !== ownerId) {
    return { ok: false, reason: 'signer_not_current_owner' };
  }
  const expected = computeCredentialHash(tokenId, scope, presenterId);
  if (storedHash !== expected) {
    return { ok: false, reason: 'credential_not_presented' };
  }
  return { ok: true, reason: 'ok', credentialHash: expected };
}

export function runScenario() {
  const s = SCENARIO;
  const fund = computeFundSplit(s.grossInflowUsdc);
  const royalties = computeRoyaltySplit(fund.royaltyPoolUsdc);
  const credentialHash = computeCredentialHash(s.tokenId, s.credentialScope, s.owner);
  const ownerCheck = verifyCredential(s.tokenId, s.credentialScope, s.owner, s.owner, credentialHash);
  const staleCheck = verifyCredential(s.tokenId, s.credentialScope, s.owner, s.buyer, null);
  const buyerCheck = verifyCredential(s.tokenId, s.credentialScope, s.buyer, s.buyer, computeCredentialHash(s.tokenId, s.credentialScope, s.buyer));
  return {
    ...s,
    ...fund,
    creatorPayoutUsdc: royalties.creatorUsdc,
    coauthorPayoutUsdc: royalties.coauthorUsdc,
    credentialHash,
    ownerVerified: ownerCheck.ok,
    staleOwnerVerified: staleCheck.ok,
    staleReason: staleCheck.reason,
    buyerVerifiedAfterTransfer: buyerCheck.ok,
  };
}

export const STEPS_SPEC = (() => {
  const sc = runScenario();
  return [
    {
      step: 'nft_receives_funds',
      summary: `Token #${sc.tokenId} (${sc.subaccount}) receives ${sc.grossInflowUsdc.toLocaleString()} USDC gross revenue -> ${sc.treasuryBps / 100}% (${sc.treasuryUsdc.toLocaleString()} USDC) credited to NFT account balance, ${sc.royaltyBps / 100}% (${sc.royaltyPoolUsdc} USDC) reserved in royalty pool`,
      metrics: {
        token_id: sc.tokenId,
        subaccount: sc.subaccount,
        gross_inflow_usdc: sc.grossInflowUsdc,
        nft_treasury_usdc: sc.treasuryUsdc,
        royalty_pool_usdc: sc.royaltyPoolUsdc,
      },
    },
    {
      step: 'pays_royalty',
      summary: `distributeRoyalties(#${sc.tokenId}) splits the ${sc.royaltyPoolUsdc} USDC royalty pool -> ${sc.creator} receives ${sc.creatorPayoutUsdc} USDC (${sc.creatorBps / 100}%), ${sc.coauthor} receives ${sc.coauthorPayoutUsdc} USDC (${sc.coauthorBps / 100}%); royalty pool = 0 USDC`,
      metrics: {
        token_id: sc.tokenId,
        payouts: {
          [sc.creator]: sc.creatorPayoutUsdc,
          [sc.coauthor]: sc.coauthorPayoutUsdc,
        },
        remaining_royalty_pool_usdc: 0,
      },
    },
    {
      step: 'presents_credential',
      summary: `Token #${sc.tokenId} holds inventory ${JSON.stringify(sc.inventory)} and signs SHA-256 access credential \`${sc.credentialScope}\` -> verifyCredential() returns ok=true; after transfer to ${sc.buyer}, old owner's credential presentation returns ok=false (${sc.staleReason})`,
      metrics: {
        token_id: sc.tokenId,
        inventory: sc.inventory,
        credential_scope: sc.credentialScope,
        credential_hash: sc.credentialHash,
        current_owner_verified: sc.ownerVerified,
        transferred_to: sc.buyer,
        stale_owner_verified: sc.staleOwnerVerified,
        stale_reason: sc.staleReason,
      },
    },
  ];
})();

export class DeterministicStateMachine {
  constructor() {
    this.events = [];
    this.headHash = '0'.repeat(64);
  }

  applyStep(stepName, payload) {
    if (!stepName || typeof stepName !== 'string') {
      throw new Error('stepName must be a non-empty string');
    }
    const index = this.events.length;
    const canonical = JSON.stringify({ index, prev: this.headHash, step: stepName, payload });
    const hash = sha256Hex(canonical);
    const entry = { index, step: stepName, payload, prevHash: this.headHash, hash };
    this.events.push(entry);
    this.headHash = hash;
    return entry;
  }

  runAllTryItSteps() {
    for (const s of STEPS_SPEC) {
      this.applyStep(s.step, { summary: s.summary, metrics: s.metrics });
    }
    return this.snapshot();
  }

  verifyChain() {
    let prev = '0'.repeat(64);
    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.prevHash !== prev) return false;
      const expected = sha256Hex(JSON.stringify({ index: i, prev, step: ev.step, payload: ev.payload }));
      if (ev.hash !== expected) return false;
      prev = expected;
    }
    return true;
  }

  snapshot() {
    return {
      track: TRACK_CODE,
      bountyId: BOUNTY_ID,
      eventCount: this.events.length,
      headHash: this.headHash,
      chainVerified: this.verifyChain(),
      events: this.events,
    };
  }
}
