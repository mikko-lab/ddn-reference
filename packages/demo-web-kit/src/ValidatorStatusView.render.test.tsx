// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ValidatorStatusView } from './ValidatorStatusView.js';
import { idle, loaded, loading } from './fetch-state.js';
import type { DemoValidatorProgressDto } from './demo-decision-dto.js';

test('ValidatorStatusView shows a live-watching message while polling is active', () => {
  const html = renderToStaticMarkup(<ValidatorStatusView decisionId="dec_1" statusState={idle()} validatorsState={loading()} polling={true} />);
  assert.match(html, /Watching for live validator updates/);
});

test('ValidatorStatusView shows a settled message once polling has stopped', () => {
  const validators: DemoValidatorProgressDto = {
    decisionId: 'dec_2',
    validators: [
      { validatorId: 'sha256:11', phase: 'SUCCEEDED', updatedAt: '2026-08-01T00:00:00.000Z', outputHash: 'sha256:aa' },
      { validatorId: 'sha256:22', phase: 'SUCCEEDED', updatedAt: '2026-08-01T00:00:00.000Z', outputHash: 'sha256:aa' },
      { validatorId: 'sha256:33', phase: 'FAILED', updatedAt: '2026-08-01T00:00:00.000Z' },
    ],
  };
  const html = renderToStaticMarkup(<ValidatorStatusView decisionId="dec_2" statusState={idle()} validatorsState={loaded(validators)} polling={false} />);
  assert.match(html, /All validators have reached a final state/);
  assert.match(html, /SUCCEEDED/);
  assert.match(html, /FAILED/);
});

test('ValidatorStatusView never renders a raw stderr/output field beyond outputHash', () => {
  const validators: DemoValidatorProgressDto = {
    decisionId: 'dec_3',
    validators: [{ validatorId: 'sha256:11', phase: 'RUNNING', updatedAt: '2026-08-01T00:00:00.000Z' }],
  };
  const html = renderToStaticMarkup(<ValidatorStatusView decisionId="dec_3" statusState={idle()} validatorsState={loaded(validators)} polling={true} />);
  assert.doesNotMatch(html, /stderr|privateKey|traceback/i);
});
