// SPDX-License-Identifier: Apache-2.0
// In-memory DecisionRepository. Node's single-threaded event loop makes a
// synchronous check-then-set atomic as long as no `await` sits between the
// read and the write -- both createOrGetByIdempotencyKey and transition()
// are written that way deliberately, so two requests racing for the same
// idempotency key or the same state transition can never both win.

import type { DecisionStatus } from '@ddn/schemas';
import type { Sha256Digest } from '@ddn/crypto';
import { ApiError } from '../errors/api-error.js';
import { ALLOWED_DECISION_TRANSITIONS, type DecisionRecord, type DecisionRepository, type PendingDecisionRecord } from './types.js';

function idempotencyKey(tenantId: string, hash: Sha256Digest): string {
  return `${tenantId}:${hash}`;
}

export class InMemoryDecisionRepository implements DecisionRepository {
  private readonly byId = new Map<string, DecisionRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();

  async createOrGetByIdempotencyKey(
    tenantId: string,
    idempotencyRequestHash: Sha256Digest,
    build: () => PendingDecisionRecord
  ): Promise<DecisionRecord> {
    const key = idempotencyKey(tenantId, idempotencyRequestHash);
    const existingId = this.byIdempotencyKey.get(key);
    if (existingId !== undefined) {
      const existing = this.byId.get(existingId);
      if (existing === undefined) {
        throw new ApiError('INTERNAL_ERROR', 'idempotency index points at a missing decision record');
      }
      return existing;
    }
    const record = build();
    this.byIdempotencyKey.set(key, record.decisionId);
    this.byId.set(record.decisionId, record);
    return record;
  }

  async get(decisionId: string): Promise<DecisionRecord | undefined> {
    return this.byId.get(decisionId);
  }

  async transition(decisionId: string, expectedCurrentStatus: DecisionStatus, next: DecisionRecord): Promise<DecisionRecord> {
    const current = this.byId.get(decisionId);
    if (current === undefined) {
      throw new ApiError('DECISION_NOT_FOUND', `no decision found for id: ${decisionId}`);
    }
    if (current.status !== expectedCurrentStatus) {
      throw new ApiError(
        'DECISION_STATE_CONFLICT',
        `expected decision ${decisionId} to be ${expectedCurrentStatus}, but it is ${current.status}`
      );
    }
    if (!ALLOWED_DECISION_TRANSITIONS[current.status].includes(next.status)) {
      throw new ApiError(
        'DECISION_STATE_CONFLICT',
        `illegal transition for decision ${decisionId}: ${current.status} -> ${next.status}`
      );
    }
    this.byId.set(decisionId, next);
    return next;
  }
}
