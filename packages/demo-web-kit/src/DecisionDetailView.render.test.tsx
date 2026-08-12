// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionDetailView } from './DecisionDetailView.js';
import { idle, loaded, loading, errored } from './fetch-state.js';
import type { DemoDecisionStatusDto, DemoReceiptDto, DemoValidatorProgressDto, DemoAnchorDto } from './demo-decision-dto.js';

test('DecisionDetailView renders a loading state for every section before anything has loaded', () => {
  const html = renderToStaticMarkup(
    <DecisionDetailView
      decisionId="dec_1"
      statusState={loading()}
      validatorsState={loading()}
      receiptState={idle()}
      anchorState={idle()}
      localVerification={undefined}
    />
  );
  assert.match(html, /Loading decision status/);
  assert.match(html, /Loading validator progress/);
});

test('DecisionDetailView renders the four sections clearly separated once everything is loaded', () => {
  const status: DemoDecisionStatusDto = {
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
  };
  const validators: DemoValidatorProgressDto = {
    decisionId: 'dec_2',
    validators: [{ validatorId: 'sha256:11', phase: 'SUCCEEDED', updatedAt: '2026-08-01T00:00:01.000Z', outputHash: 'sha256:ff' }],
  };
  const receipt: DemoReceiptDto = { decisionId: 'dec_2', receipt: undefined };
  const anchor: DemoAnchorDto = { decisionId: 'dec_2', anchor: undefined };

  const html = renderToStaticMarkup(
    <DecisionDetailView
      decisionId="dec_2"
      statusState={loaded(status)}
      validatorsState={loaded(validators)}
      receiptState={loaded(receipt)}
      anchorState={loaded(anchor)}
      localVerification={undefined}
    />
  );

  assert.match(html, /Decision status/);
  assert.match(html, /Validator results.*quorum/);
  assert.match(html, /Local receipt verification/);
  assert.match(html, /On-chain anchor/);
  assert.match(html, /FINALIZED/);
  assert.match(html, /Not finalized yet/); // receipt.receipt is undefined here
});

test('DecisionDetailView surfaces a fetch error message without a stack trace or internal detail', () => {
  const html = renderToStaticMarkup(
    <DecisionDetailView
      decisionId="dec_3"
      statusState={errored('could not reach the demo backend')}
      validatorsState={idle()}
      receiptState={idle()}
      anchorState={idle()}
      localVerification={undefined}
    />
  );
  assert.match(html, /could not reach the demo backend/);
  assert.doesNotMatch(html, /at Object\.|node_modules|\.ts:\d+/);
});
