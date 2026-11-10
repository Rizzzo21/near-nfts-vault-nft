// VAULT-NFT on-chain contract (NEAR testnet).
// Minimal NEP-171 core NFT + NEP-199 royalty payout + token-bound
// subaccount treasury: each token owns an internal balance (treasury),
// a royalty pool, an inventory set, and a credential registry bound to
// the current owner.
//
// Money: integer yoctoNEAR. The demo scenario's 2,000 USDC figures are
// the off-chain accounting model; the on-chain flow moves testnet NEAR
// through the same split logic (90% treasury / 10% royalty pool;
// royalties 70% creator-ava / 30% co-author-ben). Royalty payouts are
// recorded in the contract's internal ledger (no USDC exists on testnet).
//
// Credential: credential_hash = sha256("<token_id>:<scope>:<owner_id>")
// computed on-chain with the runtime's native SHA-256 (`near.sha256`),
// same canonical form as src/engine.mjs. Only the current owner may
// present; a stale owner is refused with `signer_not_current_owner`.
//
// Honest scope: this is a MINIMAL NEP-171 — no approval management, no
// cross-contract transfer callbacks, no enumeration beyond
// nft_tokens_for_owner. A production NFT would add those plus a real
// storage-deposit model. The credential is a hash-bound presentation,
// not a signed verifiable credential.
import { NearBindgen, near, call, view } from 'near-sdk-js';

const CREATOR = 'creator-ava.near';
const COAUTHOR = 'co-author-ben.near';
const TREASURY_BPS = 9000; // 90% of a fund goes to the token treasury
const ROYALTY_BPS = 1000; // 10% of a fund goes to the royalty pool
const CREATOR_BPS = 7000; // 70% of the royalty pool to the creator
const BPS_DENOM = 10000;

// ASCII-only UTF-8 encoder (all preimage fields are ids/scopes).
function utf8Bytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 127) throw new Error('preimage must be ASCII');
    bytes[i] = code;
  }
  return bytes;
}

function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function sha256HexString(str) {
  return toHex(near.sha256(utf8Bytes(str)));
}

@NearBindgen({})
class VaultNft {
  constructor() {
    this.tokens = {}; // token_id -> { owner_id, title, description, media, inventory, treasury_yocto, royalty_pool_yocto, credential_hash }
    this.balances = {}; // account_id -> yocto string (internal royalty payout ledger)
    this.total_supply = 0;
    this.flow_events = []; // append-only log, capped at 50
  }

  _log(step, detail) {
    this.flow_events.push({ step, ...detail });
    if (this.flow_events.length > 50) this.flow_events.shift();
  }

  _token(token_id) {
    const t = this.tokens[token_id];
    if (!t) throw new Error('token_not_found');
    return t;
  }

  // ---- views ----

  @view({})
  nft_token({ token_id }) {
    return this._token(token_id);
  }

  @view({})
  nft_total_supply({}) {
    return this.total_supply;
  }

  @view({})
  nft_tokens_for_owner({ account_id }) {
    return Object.entries(this.tokens)
      .filter(([, t]) => t.owner_id === account_id)
      .map(([token_id, t]) => ({ token_id, ...t }));
  }

  // NEP-199: given a sale price `balance` (yocto), return the royalty
  // payout split. 10% royalty, split 70% creator / 30% co-author.
  // The remaining 90% of the sale price goes to the seller.
  @view({})
  nft_payout({ token_id, balance, max_len_payout }) {
    this._token(token_id); // must exist
    const royalty = (BigInt(balance) * BigInt(ROYALTY_BPS)) / BigInt(BPS_DENOM);
    const creatorShare = (royalty * BigInt(CREATOR_BPS)) / BigInt(BPS_DENOM);
    const coauthorShare = royalty - creatorShare;
    const payout = {};
    payout[CREATOR] = creatorShare.toString();
    payout[COAUTHOR] = coauthorShare.toString();
    return { payout };
  }

  @view({})
  get_state({ token_id }) {
    const t = this._token(token_id);
    return {
      token_id,
      owner_id: t.owner_id,
      treasury_yocto: t.treasury_yocto,
      royalty_pool_yocto: t.royalty_pool_yocto,
      inventory: t.inventory,
      credential_hash: t.credential_hash,
      total_supply: this.total_supply,
      balances: this.balances,
    };
  }

  @view({})
  get_balance({ account_id }) {
    return { account_id, balance_yocto: this.balances[account_id] || '0' };
  }

  // View-only credential check: ok only when the account is the current
  // owner AND the stored credential hash matches the canonical preimage.
  @view({})
  verify_credential({ token_id, account_id, scope }) {
    const t = this._token(token_id);
    const expected = sha256HexString(`${token_id}:${scope}:${account_id}`);
    const isOwner = account_id === t.owner_id;
    const hashMatches = t.credential_hash === expected;
    return {
      token_id,
      account_id,
      scope,
      ok: isOwner && hashMatches,
      reason: !isOwner ? 'signer_not_current_owner' : !hashMatches ? 'credential_not_presented' : 'ok',
    };
  }

  @view({})
  get_events({}) {
    return this.flow_events;
  }

  // ---- calls ----

  @call({})
  nft_mint({ token_id, receiver_id, metadata }) {
    if (this.tokens[token_id]) throw new Error('token_already_exists');
    const md = metadata || {};
    this.tokens[token_id] = {
      owner_id: receiver_id,
      title: md.title || `VAULT-NFT #${token_id}`,
      description: md.description || '',
      media: md.media || '',
      inventory: md.inventory || ['rig-mk3', 'dataset-v2'],
      treasury_yocto: '0',
      royalty_pool_yocto: '0',
      credential_hash: null,
    };
    this.total_supply += 1;
    this._log('mint', { token_id, receiver_id });
    return this.tokens[token_id];
  }

  @call({})
  nft_transfer({ receiver_id, token_id, memo }) {
    const t = this._token(token_id);
    const caller = near.predecessorAccountId();
    if (caller !== t.owner_id) throw new Error('signer_not_current_owner');
    t.owner_id = receiver_id;
    t.credential_hash = null; // credential is bound to the previous owner
    this._log('transfer', { token_id, from: caller, to: receiver_id });
    return { token_id, from: caller, to: receiver_id };
  }

  // Payable: the attached deposit is split 90% to the token treasury,
  // 10% to the royalty pool (integer yocto math, no rounding loss:
  // royalty share = deposit - treasury share).
  @call({ payableFunction: true })
  fund({ token_id }) {
    const t = this._token(token_id);
    const deposit = near.attachedDeposit();
    if (deposit <= 0n) throw new Error('fund requires an attached deposit');
    const treasuryShare = (deposit * BigInt(TREASURY_BPS)) / BigInt(BPS_DENOM);
    const royaltyShare = deposit - treasuryShare;
    t.treasury_yocto = (BigInt(t.treasury_yocto) + treasuryShare).toString();
    t.royalty_pool_yocto = (BigInt(t.royalty_pool_yocto) + royaltyShare).toString();
    this._log('fund', {
      token_id,
      deposit_yocto: deposit.toString(),
      treasury_yocto: treasuryShare.toString(),
      royalty_pool_yocto: royaltyShare.toString(),
    });
    return {
      token_id,
      treasury_yocto: t.treasury_yocto,
      royalty_pool_yocto: t.royalty_pool_yocto,
    };
  }

  @call({})
  distribute_royalties({ token_id }) {
    const t = this._token(token_id);
    const pool = BigInt(t.royalty_pool_yocto);
    if (pool <= 0n) throw new Error('royalty_pool_empty');
    const creatorShare = (pool * BigInt(CREATOR_BPS)) / BigInt(BPS_DENOM);
    const coauthorShare = pool - creatorShare;
    this.balances[CREATOR] = (BigInt(this.balances[CREATOR] || '0') + creatorShare).toString();
    this.balances[COAUTHOR] = (BigInt(this.balances[COAUTHOR] || '0') + coauthorShare).toString();
    t.royalty_pool_yocto = '0';
    this._log('distribute_royalties', {
      token_id,
      creator_yocto: creatorShare.toString(),
      coauthor_yocto: coauthorShare.toString(),
    });
    const payouts = {};
    payouts[CREATOR] = creatorShare.toString();
    payouts[COAUTHOR] = coauthorShare.toString();
    return { token_id, payouts, remaining_royalty_pool_yocto: '0' };
  }

  // Only the current owner may present. The credential hash is computed
  // on-chain from the canonical preimage and stored on the token.
  @call({})
  present_credential({ token_id, scope }) {
    const t = this._token(token_id);
    const caller = near.predecessorAccountId();
    if (caller !== t.owner_id) throw new Error('signer_not_current_owner');
    const credential_hash = sha256HexString(`${token_id}:${scope}:${caller}`);
    t.credential_hash = credential_hash;
    this._log('present_credential', { token_id, scope, owner_id: caller, credential_hash });
    return { token_id, scope, owner_id: caller, credential_hash, ok: true };
  }
}
