// SPDX-License-Identifier: Apache-2.0
// The local demo chain's RPC endpoint. NEXT_PUBLIC_-prefixed so Next.js
// inlines it into the client bundle at build time; defaults to Anvil's
// own default port so the common local case needs no configuration.

export const DEFAULT_DEMO_CHAIN_RPC_URL = 'http://127.0.0.1:8545';

export function getChainRpcUrl(): string {
  return process.env.NEXT_PUBLIC_DDN_CHAIN_RPC_URL ?? DEFAULT_DEMO_CHAIN_RPC_URL;
}
