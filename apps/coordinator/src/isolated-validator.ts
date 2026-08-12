// SPDX-License-Identifier: Apache-2.0
// Runs one `ddn-validator execute` as a fully isolated instance. See
// docs/decision-receipt-v1.md's "Important rajaus" section: three
// same-machine subprocesses are *isolated validator instances*, not
// independent network operators. This implementation does not claim
// independent operator distribution.
// What this file guarantees today, per validator instance:
//   - its own process (execFile, never a shell)
//   - its own temp working directory
//   - read-only access to the same pinned policy package
//   - separately captured stdout/stderr
//   - its own timeout
//   - its own exit code
//
// Deliberately execFile, never exec(): exec() runs the command through a
// shell, so a value containing shell metacharacters could be interpreted
// as shell syntax instead of a literal argument. execFile (like spawn)
// passes an explicit argv array straight to the OS with no shell in
// between -- there is no string for anything to inject into.

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface IsolatedValidatorConfig {
  readonly validatorBinaryPath: string;
  readonly policyPackagePath: string;
  readonly profilePath: string | undefined;
  readonly requestPath: string;
  readonly privateKeyFilePath: string;
  readonly timeoutMs: number;
}

export type IsolatedValidatorOutcome =
  | { readonly kind: 'SUCCESS'; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'TIMEOUT'; readonly stderr: string }
  | { readonly kind: 'PROCESS_ERROR'; readonly exitCode: number | null; readonly stdout: string; readonly stderr: string };

interface ExecFileError extends Error {
  readonly killed?: boolean;
  readonly signal?: NodeJS.Signals | null;
  readonly code?: number | string | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

export async function runIsolatedValidator(config: IsolatedValidatorConfig): Promise<IsolatedValidatorOutcome> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-validator-'));
  try {
    const args = [
      'execute',
      '--policy',
      config.policyPackagePath,
      '--request',
      config.requestPath,
      '--private-key-file',
      config.privateKeyFilePath,
    ];
    if (config.profilePath !== undefined) args.push('--profile', config.profilePath);

    const { stdout, stderr } = await execFileAsync(config.validatorBinaryPath, args, {
      cwd: tempDir,
      timeout: config.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 10_000_000,
    });
    return { kind: 'SUCCESS', stdout, stderr };
  } catch (error) {
    const err = error as ExecFileError;
    if (err.killed && err.signal === 'SIGKILL') {
      return { kind: 'TIMEOUT', stderr: err.stderr ?? '' };
    }
    return {
      kind: 'PROCESS_ERROR',
      exitCode: typeof err.code === 'number' ? err.code : null,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
