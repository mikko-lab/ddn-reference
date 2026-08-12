#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Real boot: loads config/registries from the filesystem, builds the app,
// and listens. Separate from app.ts/index.ts so tests never accidentally
// bind a real port or depend on real env vars being set.

import { AnchorChainClient, AnchorSidecarStore, AnchorWorker } from '@ddn/anchor-service';
import { loadAnchorWorkerBootConfig } from './anchor-worker-config.js';
import { buildApp } from './app.js';
import { loadApiConfig } from './config.js';
import { InMemoryDecisionRepository } from './decisions/decision-repository.js';
import { ValidatorProgressStore } from './decisions/validator-progress-store.js';
import { loadPolicyRegistry } from './policies/policy-registry.js';
import { loadVerificationProfile } from './policies/verification-profile.js';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const policyRegistry = loadPolicyRegistry(config.policyRegistryPath);
  const verificationProfile = loadVerificationProfile(config.executionProfilePath);
  const decisionRepository = new InMemoryDecisionRepository();
  const anchorSidecarStore = new AnchorSidecarStore();
  const validatorProgressStore = new ValidatorProgressStore();

  // Milestone 6: the anchor worker is optional infrastructure -- it only
  // starts if a chain/contract is actually configured (see
  // anchor-worker-config.ts). It runs in-process, reading/writing the same
  // anchorSidecarStore instance injected into AppDependencies below; there
  // is no separate @ddn/anchor-service process or HTTP interface.
  const anchorWorkerBootConfig = loadAnchorWorkerBootConfig(process.env);
  if (anchorWorkerBootConfig) {
    const anchorChainClient = new AnchorChainClient({
      rpcUrl: anchorWorkerBootConfig.rpcUrl,
      chainId: anchorWorkerBootConfig.chainId,
      contractAddress: anchorWorkerBootConfig.contractAddress,
      submitterPrivateKey: anchorWorkerBootConfig.submitterPrivateKey,
    });
    const anchorWorker = new AnchorWorker(anchorSidecarStore, anchorChainClient, {
      pollIntervalMs: anchorWorkerBootConfig.pollIntervalMs,
      batchSize: anchorWorkerBootConfig.batchSize,
      confirmationBlocks: anchorWorkerBootConfig.confirmationBlocks,
    });
    anchorWorker.start();
  }

  const app = await buildApp({ config, decisionRepository, policyRegistry, verificationProfile, anchorSidecarStore, validatorProgressStore });
  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
