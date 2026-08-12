// SPDX-License-Identifier: Apache-2.0
// @ddn/coordinator
//
// Milestone 4: orchestrates N isolated `ddn-validator execute` instances
// (own process, own temp dir, own timeout, separate stdout/stderr, own
// exit code -- see isolated-validator.ts) and hands their outputs to
// @ddn/receipt-sdk for quorum selection and DecisionReceiptV1 assembly.
// This package spawns processes and touches private key *file paths*; it
// never contains cryptographic or quorum logic itself -- that all lives in
// the pure @ddn/receipt-sdk library. See docs/decision-receipt-v1.md.

export { runIsolatedValidator } from './isolated-validator.js';
export type { IsolatedValidatorConfig, IsolatedValidatorOutcome } from './isolated-validator.js';

export { buildValidatorSetFromPublicKeyFiles } from './build-validator-set.js';

export { decide } from './decide.js';
export type {
  ValidatorInstanceConfig,
  DecideConfig,
  DecideOutcome,
  ValidatorInstanceDiagnostic,
  ValidatorInstanceDiagnosticOutcome,
  ValidatorProgressPhase,
  ValidatorProgressEvent,
  ValidatorProgressCallback,
} from './decide.js';
