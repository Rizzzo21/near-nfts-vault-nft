// Deploy the VAULT-NFT contract to NEAR testnet and run the full
// mint -> fund -> royalties -> credential -> transfer -> stale-refusal
// flow, recording real tx hashes.
//
// Usage (from nep-account-nft/):
//   npm install            # installs near-api-js (dev tooling)
//   node scripts/deploy-testnet.mjs [contract-account] [buyer-account]
//   # defaults: vnft-backstop-1110b.testnet / vnft-buyer-1110b.testnet
//
// The deployer and buyer keypairs are generated in memory in this process
// and NEVER written to disk or printed. Both accounts are funded by the
// free faucet helper; no real money is involved (testnet only). Evidence
// is written to docs/testnet-evidence.json (contract account, credential
// hash, tx hashes, explorer links) — that file contains NO private key.
//
// The credential hash is computed with the SAME function as the off-chain
// demo (imported from src/engine.mjs), so the on-chain verification
// exercises the identical canonical form.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nearApi from 'near-api-js';
import {
  computeCredentialHash,
  SCENARIO,
} from '../src/engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const ACCOUNT_ID = process.argv[2] || 'vnft-backstop-1110b.testnet';
const BUYER_ID = process.argv[3] || 'vnft-buyer-1110b.testnet';
const RPC_URL = 'https://rpc.testnet.near.org';
const HELPER_URL = 'https://helper.testnet.near.org';
const EXPLORER_TX = 'https://explorer.testnet.near.org/transactions/';
const EXPLORER_ACCT = 'https://explorer.testnet.near.org/accounts/';
const GAS = 100_000_000_000_000n;

// On-chain fund amount: 1 NEAR -> 0.9 treasury / 0.1 royalty pool.
const FUND_YOCTO = 10n ** 24n;
const fmtNear = (yocto) => (Number(BigInt(yocto)) / 1e24).toFixed(4);

// Extract a tx hash from a near-api-js failure message, if present.
function txFromError(e) {
  const m = String(e.message || e).match(/([A-Za-z0-9]{43,44})/);
  return m ? m[1] : null;
}

async function createFaucetAccount(near, keyStore, accountId) {
  const keyPair = nearApi.KeyPair.fromRandom('ed25519');
  await keyStore.setKey('testnet', accountId, keyPair);
  console.log(`creating ${accountId} via faucet helper...`);
  const res = await fetch(`${HELPER_URL}/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: keyPair.getPublicKey().toString(),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`faucet helper ${res.status}: ${body.slice(0, 500)}`);
  }
  const account = await near.account(accountId);
  const state = await account.state();
  const balanceNear = Number(nearApi.utils.format.formatNearAmount(state.amount));
  console.log(`      funded. balance: ${balanceNear.toFixed(4)} NEAR`);
  return { account, balanceNear };
}

async function main() {
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  const near = await nearApi.connect({
    networkId: 'testnet',
    nodeUrl: RPC_URL,
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: HELPER_URL,
    keyStore,
  });

  // 1. Fresh throwaway testnet accounts, funded by the free faucet helper.
  console.log('[1/9] creating accounts...');
  const { account, balanceNear } = await createFaucetAccount(near, keyStore, ACCOUNT_ID);
  // Deploy needs ~5.4 NEAR storage for the ~540KB contract, plus 1 NEAR
  // for the fund step and gas for the calls.
  if (balanceNear < 7) {
    throw new Error(
      `INSUFFICIENT FAUCET FUNDING: ${balanceNear} NEAR < ~7 NEAR needed (deploy ~5.4 + fund 1 + gas). ` +
        `Re-run with a different faucet or a pre-funded testnet account.`,
    );
  }
  const buyer = await createFaucetAccount(near, keyStore, BUYER_ID);
  const buyerAccount = buyer.account;

  // 2. Deploy the contract.
  const wasm = fs.readFileSync(path.join(rootDir, 'contract', 'build', 'contract.wasm'));
  console.log(`[2/9] deploying ${wasm.length} bytes to ${ACCOUNT_ID}...`);
  const deployOutcome = await account.deployContract(wasm);
  const deployTx = deployOutcome.transaction.hash;
  console.log(`      deploy tx: ${deployTx}`);

  // 3. Mint token #42 to the deployer.
  const tokenId = SCENARIO.tokenId;
  console.log(`[3/9] minting token #${tokenId} to ${ACCOUNT_ID}...`);
  const mintOutcome = await account.functionCall({
    contractId: ACCOUNT_ID,
    methodName: 'nft_mint',
    args: {
      token_id: tokenId,
      receiver_id: ACCOUNT_ID,
      metadata: {
        title: `VAULT-NFT #${tokenId}`,
        description: 'NEP-171 token-bound account NFT that owns money, splits royalties, holds inventory, and presents credentials',
        media: '',
        inventory: SCENARIO.inventory,
      },
    },
    gas: GAS,
  });
  const mintTx = mintOutcome.transaction.hash;
  console.log(`      mint tx: ${mintTx}`);

  // 4. Fund the token with 1 NEAR -> 0.9 treasury / 0.1 royalty pool.
  console.log('[4/9] funding token #42 with 1 NEAR...');
  const fundOutcome = await account.functionCall({
    contractId: ACCOUNT_ID,
    methodName: 'fund',
    args: { token_id: tokenId },
    gas: GAS,
    attachedDeposit: FUND_YOCTO,
  });
  const fundTx = fundOutcome.transaction.hash;
  const fundResult = fundOutcome.returnValue ?? null;
  console.log(`      fund tx: ${fundTx} -> ${JSON.stringify(fundResult)}`);
  if (fundResult && fundResult.treasury_yocto !== '900000000000000000000000') {
    throw new Error(`fund split mismatch: ${JSON.stringify(fundResult)}`);
  }

  // 5. Distribute royalties: 0.1 pool -> 0.07 creator / 0.03 co-author.
  console.log('[5/9] distributing royalties...');
  const royOutcome = await account.functionCall({
    contractId: ACCOUNT_ID,
    methodName: 'distribute_royalties',
    args: { token_id: tokenId },
    gas: GAS,
  });
  const royTx = royOutcome.transaction.hash;
  const royResult = royOutcome.returnValue ?? null;
  console.log(`      royalties tx: ${royTx} -> ${JSON.stringify(royResult)}`);
  if (royResult && royResult.payouts?.['creator-ava.near'] !== '70000000000000000000000') {
    throw new Error(`royalty split mismatch: ${JSON.stringify(royResult)}`);
  }

  // 6. Present the credential as the current owner -> ok=true.
  const scope = SCENARIO.credentialScope;
  const expectedHash = computeCredentialHash(tokenId, scope, ACCOUNT_ID);
  console.log(`[6/9] presenting credential '${scope}' as owner...`);
  const credOutcome = await account.functionCall({
    contractId: ACCOUNT_ID,
    methodName: 'present_credential',
    args: { token_id: tokenId, scope },
    gas: GAS,
  });
  const credTx = credOutcome.transaction.hash;
  const credResult = credOutcome.returnValue ?? null;
  console.log(`      credential tx: ${credTx} -> ${JSON.stringify(credResult)}`);
  if (credResult && credResult.credential_hash !== expectedHash) {
    throw new Error(`credential hash mismatch: ${credResult.credential_hash} != ${expectedHash}`);
  }

  // 7. Transfer the token to the buyer.
  console.log(`[7/9] transferring token #${tokenId} to ${BUYER_ID}...`);
  const xferOutcome = await account.functionCall({
    contractId: ACCOUNT_ID,
    methodName: 'nft_transfer',
    args: { receiver_id: BUYER_ID, token_id: tokenId },
    gas: GAS,
  });
  const xferTx = xferOutcome.transaction.hash;
  console.log(`      transfer tx: ${xferTx}`);

  // 8. Stale owner presents the credential -> must be REFUSED on-chain.
  let staleTx = null;
  let staleError = null;
  try {
    const stale = await account.functionCall({
      contractId: ACCOUNT_ID,
      methodName: 'present_credential',
      args: { token_id: tokenId, scope },
      gas: GAS,
    });
    staleTx = stale.transaction.hash;
    staleError = 'UNEXPECTED SUCCESS — stale credential was accepted';
  } catch (e) {
    staleError = String(e.message || e).slice(0, 300);
    staleTx = txFromError(e);
  }
  console.log(`      stale credential refused: ${String(staleError).slice(0, 120)}`);
  if (!String(staleError).includes('signer_not_current_owner')) {
    throw new Error(`stale credential refusal reason unexpected: ${staleError}`);
  }

  // 9. The new owner presents the credential -> ok=true.
  console.log('[9/9] buyer presents the credential...');
  const buyerCredOutcome = await buyerAccount.functionCall({
    contractId: ACCOUNT_ID,
    methodName: 'present_credential',
    args: { token_id: tokenId, scope },
    gas: GAS,
  });
  const buyerCredTx = buyerCredOutcome.transaction.hash;
  const buyerCredResult = buyerCredOutcome.returnValue ?? null;
  console.log(`      buyer credential tx: ${buyerCredTx} -> ${JSON.stringify(buyerCredResult)}`);
  const buyerExpectedHash = computeCredentialHash(tokenId, scope, BUYER_ID);
  if (buyerCredResult && buyerCredResult.credential_hash !== buyerExpectedHash) {
    throw new Error(`buyer credential hash mismatch: ${buyerCredResult.credential_hash} != ${buyerExpectedHash}`);
  }

  // Final on-chain state + evidence file.
  const finalState = await account.viewFunction({
    contractId: ACCOUNT_ID,
    methodName: 'get_state',
    args: { token_id: tokenId },
  });
  console.log('final state:', JSON.stringify(finalState));
  if (finalState.owner_id !== BUYER_ID) throw new Error(`owner mismatch: ${finalState.owner_id}`);
  if (finalState.treasury_yocto !== '900000000000000000000000') {
    throw new Error(`treasury mismatch: ${finalState.treasury_yocto}`);
  }
  if (finalState.royalty_pool_yocto !== '0') {
    throw new Error(`royalty pool not drained: ${finalState.royalty_pool_yocto}`);
  }

  const evidence = {
    network: 'testnet',
    contract_account: ACCOUNT_ID,
    contract_explorer: EXPLORER_ACCT + ACCOUNT_ID,
    contract_wasm_sha256: (await import('node:crypto')).createHash('sha256').update(wasm).digest('hex'),
    deployed_at_utc: new Date().toISOString(),
    token_id: tokenId,
    buyer_account: BUYER_ID,
    credential_hash: expectedHash,
    credential_scope: scope,
    flow: {
      deploy: { tx: deployTx, explorer: EXPLORER_TX + deployTx },
      mint: { tx: mintTx, explorer: EXPLORER_TX + mintTx },
      fund: {
        tx: fundTx,
        explorer: EXPLORER_TX + fundTx,
        deposit_near: '1',
        treasury_near: '0.9',
        royalty_pool_near: '0.1',
      },
      distribute_royalties: {
        tx: royTx,
        explorer: EXPLORER_TX + royTx,
        creator_near: '0.07',
        coauthor_near: '0.03',
      },
      present_credential: { tx: credTx, explorer: EXPLORER_TX + credTx, result: credResult },
      transfer: { tx: xferTx, explorer: EXPLORER_TX + xferTx },
      stale_credential_refused: {
        tx: staleTx,
        explorer: staleTx ? EXPLORER_TX + staleTx : null,
        error: staleError,
      },
      buyer_credential: { tx: buyerCredTx, explorer: EXPLORER_TX + buyerCredTx, result: buyerCredResult },
    },
    final_state: finalState,
    verified_figures: {
      treasury_near: fmtNear(finalState.treasury_yocto),
      creator_balance_near: fmtNear(finalState.balances['creator-ava.near'] || '0'),
      coauthor_balance_near: fmtNear(finalState.balances['co-author-ben.near'] || '0'),
      owner_after_transfer: finalState.owner_id,
    },
    disclosure:
      'On-chain amounts are testnet NEAR; the demo scenario figures (2,000 USDC gross, 1,800 treasury, 200 pool, 140/60 split) are the off-chain accounting model run through the same split logic. Royalty payouts are recorded in the contract internal ledger (creator-ava.near / co-author-ben.near are ledger keys, not funded accounts). The credential is a hash-bound presentation, not a signed verifiable credential.',
  };
  const evidencePath = path.join(rootDir, 'docs', 'testnet-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`evidence written: ${evidencePath}`);
  console.log('DONE. Contract:', ACCOUNT_ID);
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
