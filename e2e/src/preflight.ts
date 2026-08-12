// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CONTRACT_ARTIFACT_PATH, EXECUTION_PROFILE_PATH, POLICY_PACKAGE_DIR, POLICY_REGISTRY_PATH, VALIDATOR_BINARY_PATH } from './paths.js';

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

/** Every one of these is a genuine prerequisite for a real, no-mocks E2E
 * run -- if any is missing, this throws with a specific, actionable
 * message rather than letting the run limp on with a mock or silently
 * skip, matching this repo's existing DDN_VALIDATOR_BIN/
 * DDN_ANCHOR_TEST_ANVIL "explicitly requested, must be real" discipline. */
export function runPreflightChecks(): void {
  const problems: string[] = [];

  if (!existsSync(VALIDATOR_BINARY_PATH)) {
    problems.push(`${VALIDATOR_BINARY_PATH} does not exist -- run \`cargo build --release -p ddn-validator\` first`);
  }
  if (!existsSync(join(POLICY_PACKAGE_DIR, 'policy.wasm'))) {
    problems.push(`${POLICY_PACKAGE_DIR}/policy.wasm does not exist -- run \`./scripts/build-policy.sh\` first`);
  }
  if (!existsSync(POLICY_REGISTRY_PATH)) {
    problems.push(`${POLICY_REGISTRY_PATH} does not exist`);
  }
  if (!existsSync(EXECUTION_PROFILE_PATH)) {
    problems.push(`${EXECUTION_PROFILE_PATH} does not exist`);
  }
  if (!existsSync(CONTRACT_ARTIFACT_PATH)) {
    problems.push(`${CONTRACT_ARTIFACT_PATH} does not exist -- run \`forge build\` in contracts/ first`);
  }

  try {
    execFileSync('anvil', ['--version'], { stdio: 'ignore' });
  } catch {
    problems.push('`anvil` (Foundry) was not found on PATH -- install Foundry first');
  }

  if (problems.length > 0) {
    throw new PreflightError(`real E2E prerequisites are missing, refusing to silently skip or mock any of them:\n  - ${problems.join('\n  - ')}`);
  }
}
