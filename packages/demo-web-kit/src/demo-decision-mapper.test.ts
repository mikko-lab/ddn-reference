// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DecisionStatusResponseV1, ValidatorProgressResponseV1 } from '@ddn/schemas';
import {
  isTerminalDecisionStatus,
  isTerminalValidatorPhase,
  toDemoDecisionStatusDto,
  toDemoValidatorProgressDto,
} from './demo-decision-mapper.js';

test('toDemoDecisionStatusDto maps a PENDING/RUNNING response 1:1, dropping schemaVersion', () => {
  const upstream: DecisionStatusResponseV1 = {
    schemaVersion: '1.0.0',
    decisionId: 'dec_1',
    status: 'RUNNING',
    submittedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:01.000Z',
  };
  const dto = toDemoDecisionStatusDto(upstream);
  assert.deepEqual(dto, {
    decisionId: 'dec_1',
    status: 'RUNNING',
    submittedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:01.000Z',
  });
  assert.ok(!('schemaVersion' in dto));
});

test('toDemoDecisionStatusDto maps a FINALIZED response, including result and verification', () => {
  const upstream: DecisionStatusResponseV1 = {
    schemaVersion: '1.0.0',
    decisionId: 'dec_2',
    status: 'FINALIZED',
    result: { decision: 'ACCEPT' },
    verification: {
      receiptId: 'sha256:aa',
      validatorSetId: 'sha256:bb',
      matchingValidators: 3,
      requiredQuorum: 2,
      policyHash: 'sha256:cc',
      profileHash: 'sha256:dd',
      inputHash: 'sha256:ee',
      outputHash: 'sha256:ff',
      executionHash: 'sha256:00',
    },
    submittedAt: '2026-08-01T00:00:00.000Z',
    finalizedAt: '2026-08-01T00:00:02.000Z',
  };
  const dto = toDemoDecisionStatusDto(upstream);
  assert.deepEqual(dto, {
    decisionId: 'dec_2',
    status: 'FINALIZED',
    submittedAt: '2026-08-01T00:00:00.000Z',
    finalizedAt: '2026-08-01T00:00:02.000Z',
    result: { decision: 'ACCEPT' },
    verification: {
      receiptId: 'sha256:aa',
      validatorSetId: 'sha256:bb',
      matchingValidators: 3,
      requiredQuorum: 2,
      policyHash: 'sha256:cc',
      profileHash: 'sha256:dd',
      inputHash: 'sha256:ee',
      outputHash: 'sha256:ff',
      executionHash: 'sha256:00',
    },
  });
});

test('toDemoDecisionStatusDto maps a NO_QUORUM/FAILED response, including only code+message from the error', () => {
  const upstream: DecisionStatusResponseV1 = {
    schemaVersion: '1.0.0',
    decisionId: 'dec_3',
    status: 'NO_QUORUM',
    error: { code: 'NO_QUORUM', message: 'not enough validators agreed' },
    submittedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:03.000Z',
  };
  const dto = toDemoDecisionStatusDto(upstream);
  assert.deepEqual(dto, {
    decisionId: 'dec_3',
    status: 'NO_QUORUM',
    submittedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:03.000Z',
    error: { code: 'NO_QUORUM', message: 'not enough validators agreed' },
  });
});

test('toDemoValidatorProgressDto maps every validator entry, omitting outputHash when absent', () => {
  const upstream: ValidatorProgressResponseV1 = {
    schemaVersion: '1.0.0',
    decisionId: 'dec_4',
    validators: [
      { validatorId: 'sha256:aa', phase: 'RUNNING', updatedAt: '2026-08-01T00:00:00.000Z' },
      { validatorId: 'sha256:bb', phase: 'SUCCEEDED', updatedAt: '2026-08-01T00:00:01.000Z', outputHash: 'sha256:cc' },
    ],
  };
  const dto = toDemoValidatorProgressDto('dec_4', upstream);
  assert.deepEqual(dto, {
    decisionId: 'dec_4',
    validators: [
      { validatorId: 'sha256:aa', phase: 'RUNNING', updatedAt: '2026-08-01T00:00:00.000Z' },
      { validatorId: 'sha256:bb', phase: 'SUCCEEDED', updatedAt: '2026-08-01T00:00:01.000Z', outputHash: 'sha256:cc' },
    ],
  });
});

test('isTerminalValidatorPhase is true only for SUCCEEDED/FAILED/TIMED_OUT', () => {
  assert.equal(isTerminalValidatorPhase('PENDING'), false);
  assert.equal(isTerminalValidatorPhase('RUNNING'), false);
  assert.equal(isTerminalValidatorPhase('SUCCEEDED'), true);
  assert.equal(isTerminalValidatorPhase('FAILED'), true);
  assert.equal(isTerminalValidatorPhase('TIMED_OUT'), true);
});

test('isTerminalDecisionStatus is true only for FINALIZED/NO_QUORUM/FAILED', () => {
  assert.equal(isTerminalDecisionStatus('PENDING'), false);
  assert.equal(isTerminalDecisionStatus('RUNNING'), false);
  assert.equal(isTerminalDecisionStatus('FINALIZED'), true);
  assert.equal(isTerminalDecisionStatus('NO_QUORUM'), true);
  assert.equal(isTerminalDecisionStatus('FAILED'), true);
});
