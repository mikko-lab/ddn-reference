// SPDX-License-Identifier: Apache-2.0
// @ddn/api's library surface: buildApp and the types needed to assemble
// an AppDependencies, for tests and contract/E2E harnesses that want a
// Fastify instance via app.inject() without spawning a real server
// process. server.ts is the actual bootable entrypoint (see the
// "ddn-api" bin).

export { buildApp } from './app.js';
export type { AppDependencies } from './dependencies.js';
export { loadApiConfig, ConfigError } from './config.js';
export type { ApiConfig, ServiceTokenConfig, ValidatorInstancePathConfig } from './config.js';
export { InMemoryDecisionRepository } from './decisions/decision-repository.js';
export { ValidatorProgressStore, ValidatorProgressStoreError } from './decisions/validator-progress-store.js';
export type { ValidatorProgressEntry } from './decisions/validator-progress-store.js';
export { loadPolicyRegistry, requireActivePolicy, PolicyRegistryError } from './policies/policy-registry.js';
export type { PolicyRegistry, PolicyRegistryEntry } from './policies/policy-registry.js';
export { loadVerificationProfile } from './policies/verification-profile.js';
export type { VerificationProfile } from './policies/verification-profile.js';
