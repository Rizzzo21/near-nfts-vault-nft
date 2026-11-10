# VAULT-NFT - NEP-171 token-bound account NFTs that own money, split royalties, hold inventory, and present credentials

## 1. Problem Solved
Standard NFTs are passive metadata pointers; agents and creators need NFTs that act as autonomous sub-accounts holding fungible balances, enforcing multi-recipient royalty splits on every cashflow, storing equipment inventory, and signing verifiable access credentials.

## Prerequisites
- **Node.js 20+** (tested on Node v24.22.1). The demo and tests use the Node.js standard library only.
- For the testnet deploy only: `npm install` (pulls `near-api-js` for the deploy scripts and `near-sdk-js` for the contract build).

## 2. Try It ('Do X -> See Y' Deterministic Steps)
```bash
npm test
node scripts/demo.mjs
bash docs/verify.sh
```
1. **`nft_receives_funds`**: Token #42 (vault-42.nft.near) receives 2,000 USDC gross revenue -> 90% (1,800 USDC) credited to NFT account balance, 10% (200 USDC) reserved in royalty pool
2. **`pays_royalty`**: distributeRoyalties(#42) splits the 200 USDC royalty pool -> creator-ava receives 140 USDC (70%), co-author-ben receives 60 USDC (30%); royalty pool = 0 USDC
3. **`presents_credential`**: Token #42 holds inventory ['rig-mk3', 'dataset-v2'] and signs SHA-256 access credential `tier:pro-validator` (`dc1320e8…`) -> verifyCredential() returns ok=true; after transfer to buyer-cara, old owner's credential presentation returns ok=false (signer_not_current_owner)

Final Merkle State Head: `72c1a6eea6c80069cf7df812557f541723bd2bc65a814ec3899aa076aa61da28`

Every number above is **computed, not pasted**: `src/engine.mjs` runs the scenario with integer math (90/10 fund split, 70/30 royalty split, SHA-256 credential hash), and `test/engine.test.mjs` pins the values against independently computed known answers — a tampered split, fee, or canonical form fails the tests. The credential hash is `sha256("<token_id>:<scope>:<owner_id>")`, the same canonical form the on-chain contract verifies.

## 3. Mechanical Mapping to NEAR Protocol Contracts
Maps 1:1 to [NEP-171 (Core NFT)](https://nomicon.io/Standards/Tokens/NonFungibleToken/Core) + [NEP-199 (Royalties)](https://nomicon.io/Standards/Tokens/NonFungibleToken/Payout) + token-bound subaccounts ([NEAR account model](https://nomicon.io/Standards/Accounts)) on NEAR, where each token ID controls an internal balance map, inventory set, and credential attestation registry. The contract implements `nft_mint`, `nft_transfer`, `nft_token`, `nft_total_supply`, `nft_tokens_for_owner`, and the NEP-199 `nft_payout` view; `fund` splits an attached deposit 90% treasury / 10% royalty pool, `distribute_royalties` pays the pool 70/30, and `present_credential` only succeeds for the current owner.

## 4. On-Chain Evidence (NEAR testnet)
The same flow was executed against a minimal NEP-171 contract deployed to NEAR testnet. Contract: [`vnft-backstop-1110b.testnet`](https://explorer.testnet.near.org/accounts/vnft-backstop-1110b.testnet) (WASM sha256 `4ca44f43ac73f0a0218b6c5fd6a4a6b843b6111fe3473e6aa90f865efb027755`).

Credential hash (owner presentation): `12feef2c11c349c061b7009678e77b8da2066dda0436886a87d06fe07242a074`
Credential hash (buyer presentation, final stored): `6579674454ace3fbe3e3d5686d70a671bebf0971ab33962614c7c0ae937da8ab`

| Step | Tx hash | Explorer |
|---|---|---|
| Deploy | `67JhtbQi4KDt7bdfsmsBZ8LNSyywiKK2vZ4JNCmTQyf9` | https://explorer.testnet.near.org/transactions/67JhtbQi4KDt7bdfsmsBZ8LNSyywiKK2vZ4JNCmTQyf9 |
| Mint token #42 | `2e95KngUUpmFJMLq1YXTh8D2UeuHXj2jrSFG2xYm4jja` | https://explorer.testnet.near.org/transactions/2e95KngUUpmFJMLq1YXTh8D2UeuHXj2jrSFG2xYm4jja |
| Fund 1 NEAR (0.9 treasury / 0.1 pool) | `CAqAGVKJ3FpfyyogYYyyySeRDdNNZFV6gtWiLaWePdZc` | https://explorer.testnet.near.org/transactions/CAqAGVKJ3FpfyyogYYyyySeRDdNNZFV6gtWiLaWePdZc |
| Distribute royalties (0.07 creator / 0.03 co-author) | `B9c8fibQfU9mabUEEPmLX1WjRiqgxV4B4ysX9zk2BcFQ` | https://explorer.testnet.near.org/transactions/B9c8fibQfU9mabUEEPmLX1WjRiqgxV4B4ysX9zk2BcFQ |
| Present credential (owner, ok=true) | `FUjzUeEEgqxKZAjmcdUZp9YRKMM57wDUKRNwTy9HsxMw` | https://explorer.testnet.near.org/transactions/FUjzUeEEgqxKZAjmcdUZp9YRKMM57wDUKRNwTy9HsxMw |
| Transfer to buyer | `5MThwo19N7sXP3A6raTzYx51kJXAJwbAyHRJNf5qLz27` | https://explorer.testnet.near.org/transactions/5MThwo19N7sXP3A6raTzYx51kJXAJwbAyHRJNf5qLz27 |
| Stale credential (REFUSED, signer_not_current_owner) | `FkabD5EGxrtuVuWtbq91rHWB3oSaxXviV79eMw7wDQXe` | https://explorer.testnet.near.org/transactions/FkabD5EGxrtuVuWtbq91rHWB3oSaxXviV79eMw7wDQXe |
| Present credential (buyer, ok=true) | `CwbSBHR3cdfPAGrMpBc6KPVrFpjtN3tNvKytNynTdR48` | https://explorer.testnet.near.org/transactions/CwbSBHR3cdfPAGrMpBc6KPVrFpjtN3tNvKytNynTdR48 |

Final on-chain state: token #42 owned by `vnft-buyer-1110b.testnet`; treasury 0.9 NEAR, royalty pool 0; creator-ava.near balance 0.07 NEAR, co-author-ben.near balance 0.03 NEAR. All tx hashes above were re-verified live (testnet RPC `tx` queries for 7 of 8; the stale-refusal hash was confirmed via the Nearblocks v3 indexer `/v3/txns/{hash}` + `/receipts`, whose failure receipt matches the deploy log). Full evidence: `docs/testnet-evidence.json`. `docs/demo-screenshot.png` is a render of actual `node scripts/demo.mjs` stdout; `docs/architecture.svg` diagrams the flow (NFT, token-bound subaccount, royalty split, credential).

## 5. Deploy to Testnet (reproduce the on-chain evidence)
```bash
npm install
# 1. Build the contract (near-sdk-js). The build must run from the
#    contract/ directory with node_modules reachable there:
cd contract && ln -s ../node_modules node_modules
../node_modules/.bin/near-sdk-js build src/index.js build/contract.wasm
cd ..
# (near-sdk-js's postinstall download can fail in a sandbox; if so, run
#  npm install with --ignore-scripts and fetch binaryen/quickjs/wasi-sdk
#  into node_modules/near-sdk-js/lib/cli/deps/ by hand. near-api-js must
#  be 5.x for the deploy scripts — v7 removed the keyStores/connect API
#  these scripts use.)
# 2. Create throwaway testnet accounts via the free faucet and run the flow.
#    The deployer key is generated in memory and never written to disk.
node scripts/deploy-testnet.mjs [your-account.testnet] [buyer-account.testnet]
```
This writes `docs/testnet-evidence.json` with the contract account, credential hashes, and every tx hash. Testnet only — no real money, no mainnet keys.

## 6. Plain Disclosure
- **Zero External Dependencies** for the demo and tests: Node.js standard library only (`node:crypto`, `node:test`, `node:assert`, `node:fs`). The contract build and deploy scripts use `near-sdk-js` / `near-api-js` as dev tooling.
- **No Secrets or Network Calls** in the deterministic demo (`bash docs/verify.sh` -> `ALL CHECKS PASSED`).
- **Computed figures**: the fund split, royalty split, NEP-199 payout, and credential hash are all computed at runtime; the tests pin them against independently computed known answers. The demo scenario amounts (2,000 USDC) are the off-chain accounting model; the on-chain flow moves testnet NEAR through the same split logic.
- **Royalty payouts, honestly**: on-chain royalty payouts are recorded in the contract's internal ledger (`creator-ava.near` / `co-author-ben.near` are ledger keys, not funded accounts). A production deployment would transfer real tokens to the recipients.
- **Minimal NEP-171, honestly**: the contract has no approval management, no cross-contract transfer callbacks, and no storage-deposit model. The credential is a hash-bound presentation (`sha256(token:scope:owner)` verified on-chain), not a signed verifiable credential.
- **Shared Utility Harness Disclosure**: The SHA-256 hash-chain verification harness (`DeterministicStateMachine`) and `docs/verify.sh` layout are shared across our 7 NEAR Contest Build track entries (`bnty_0422`, `bnty_0420`, `bnty_0419`, `bnty_0417`, `bnty_0416`, `bnty_0412`, `bnty_0411`), while each track's step specifications, domain invariants, and state transitions are tailored to that track.
