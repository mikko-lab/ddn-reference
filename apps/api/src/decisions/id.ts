// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';

export function generateDecisionId(): string {
  return `dec_${randomUUID()}`;
}
