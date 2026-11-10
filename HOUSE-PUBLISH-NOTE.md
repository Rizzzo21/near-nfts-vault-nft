# House publish note — NEAR NFTs (VAULT-NFT)

This tree is the house backstop polish for the NEAR NFTs entry. It was prepared by the
house (not by a bounty hunter) as a fallback in case no hunter claims the polish bounty.

## Source
- Upstream: `duongynhi000005-oss/near-agent-economy-contest-builds` @ `5cb1e77`,
  subdirectory `nep-account-nft/`
- Polish: house backstop, 2026-11-09 evening PST / 2026-11-10 UTC. No bounty claimed,
  nothing pushed before this staging.
- Polish bounty: **bnty_0568** — still OPEN, hunter None, listing expires Nov 11, 5:05 PM
  PST. This backstop is the fallback if no hunter lands by expiry; if a hunter claims
  and submits, judge theirs on merit.

## Verification (house, live, Nov 9)
- Source note: `BACKSTOP_SUMMARY.md` (house backstop bundle). 7 of 8 tx hashes confirmed
  live via testnet RPC `tx` queries; the stale-refusal hash was confirmed via the
  Nearblocks v3 indexer (status FAILURE + failure receipt `6zCjXAQyUxpDqSMxVTJfpqQT4NPrQmA4MwQWVJVXrsgh`
  carrying `signer_not_current_owner`).
- Re-verified in this staging: `npm test` 11/11 PASS, `bash docs/verify.sh` ALL CHECKS
  PASSED (2026-11-10, Node v24.22.1).
- `node_modules/` (regenerable tooling) was stripped from this tree before publishing.

## Testnet evidence (NEAR testnet)
- Contract: **vnft-backstop-1110b.testnet**
  https://explorer.testnet.near.org/accounts/vnft-backstop-1110b.testnet
- Credential hashes (sha256 of `<token_id>:<scope>:<owner_id>`, verified independently
  against node:crypto):
  - Owner presentation: `12feef2c11c349c061b7009678e77b8da2066dda0436886a87d06fe07242a074`
  - Buyer presentation (final stored): `6579674454ace3fbe3e3d5686d70a671bebf0971ab33962614c7c0ae937da8ab`
  - Demo-model credential: `dc1320e8839a66c3a805c15ec50449db3effae5d6816f4a674e9c4e6e969c46c`
- Transactions:
  - Deploy: `67JhtbQi4KDt7bdfsmsBZ8LNSyywiKK2vZ4JNCmTQyf9`
  - Mint token #42: `2e95KngUUpmFJMLq1YXTh8D2UeuHXj2jrSFG2xYm4jja`
  - Fund 1 NEAR (0.9 treasury / 0.1 pool): `CAqAGVKJ3FpfyyogYYyyySeRDdNNZFV6gtWiLaWePdZc`
  - Distribute royalties (0.07 creator / 0.03 co-author): `B9c8fibQfU9mabUEEPmLX1WjRiqgxV4B4ysX9zk2BcFQ`
  - Present credential (owner, ok=true): `FUjzUeEEgqxKZAjmcdUZp9YRKMM57wDUKRNwTy9HsxMw`
  - Transfer to buyer: `5MThwo19N7sXP3A6raTzYx51kJXAJwbAyHRJNf5qLz27`
  - Stale credential (REFUSED, signer_not_current_owner): `FkabD5EGxrtuVuWtbq91rHWB3oSaxXviV79eMw7wDQXe`
  - Present credential (buyer, ok=true): `CwbSBHR3cdfPAGrMpBc6KPVrFpjtN3tNvKytNynTdR48`
- Final on-chain state: token #42 owned by `vnft-buyer-1110b.testnet`; treasury 0.9
  NEAR, royalty pool 0; creator-ava.near 0.07 NEAR, co-author-ben.near 0.03 NEAR
  (internal ledger).

## Honest caveats (from this tree's README §6, Plain Disclosure)
- **Computed figures:** the fund split, royalty split, NEP-199 payout, and credential
  hash are all computed at runtime; the tests pin them against independently computed
  known answers. The demo scenario amounts (2,000 USDC) are the off-chain accounting
  model; the on-chain flow moves testnet NEAR through the same split logic.
- **Royalty payouts, honestly:** on-chain royalty payouts are recorded in the contract's
  internal ledger (`creator-ava.near` / `co-author-ben.near` are ledger keys, not funded
  accounts). A production deployment would transfer real tokens to the recipients.
- **Minimal NEP-171, honestly:** the contract has no approval management, no
  cross-contract transfer callbacks, and no storage-deposit model. The credential is a
  hash-bound presentation (`sha256(token:scope:owner)` verified on-chain), not a signed
  verifiable credential.
