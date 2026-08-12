// SPDX-License-Identifier: Apache-2.0
// @ddn/demo-trust-profile
//
// Milestone 7: the single, versioned TrustedDemoProfileV1 apps/explorer's
// public verifier bundles as its sole trust anchor -- committed public
// validator-set info, chainId, and DecisionAnchor.sol contract address,
// regenerated only via generate-trusted-demo-profile.ts's --confirm-update,
// plus the deploy-time fail-closed check the local demo stack's bootstrap
// script must run before starting anything else. See docs/public-demo-boundary.md.

export { parseTrustedDemoProfileV1, TrustedDemoProfileError } from './trusted-demo-profile.js';
export type { TrustedDemoProfileV1, TrustedDemoProfileChainV1, TrustedDemoProfileErrorCode } from './trusted-demo-profile.js';

export { loadBundledTrustedDemoProfile, assertProfileIntegrity, TRUSTED_DEMO_PROFILE_PATH } from './load-profile.js';

export { createDemoChainReader } from './chain-reader.js';

export {
  CONTRACT_ARTIFACT,
  contractArtifactExists,
  deployDecisionAnchor,
  assertDeployedContractMatchesTrustedProfile,
  deployAndVerifyDecisionAnchor,
  DemoTrustProfileMismatchError,
} from './deploy-and-verify.js';
export type { DeployedDecisionAnchor } from './deploy-and-verify.js';
