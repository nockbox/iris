/**
 * Zorp bridge protocol fee schedule (Nockswap-aligned).
 * Fee is `floor(amountNicks / 65536) * 195` nicks, not a flat 0.3% of decimal NOCK.
 */
import { NOCK_TO_NICKS } from './constants';

/** Nicks charged per whole NOCK of bridge input (on-chain schedule). */
export const BRIDGE_PROTOCOL_FEE_NICKS_PER_NOCK = 195;

/** Effective rate per NOCK of input (`195/65536` ≈ 0.2975%; UI label often shows 0.3%). */
export const BRIDGE_PROTOCOL_FEE_RATE = BRIDGE_PROTOCOL_FEE_NICKS_PER_NOCK / NOCK_TO_NICKS;

export function bridgeProtocolFeeNicks(amountNock: number): number {
  if (!Number.isFinite(amountNock) || amountNock <= 0) return 0;
  const amountInNicks = Math.floor(amountNock * NOCK_TO_NICKS);
  return Math.floor(amountInNicks / NOCK_TO_NICKS) * BRIDGE_PROTOCOL_FEE_NICKS_PER_NOCK;
}

export function bridgeProtocolFeeNock(amountNock: number): number {
  return bridgeProtocolFeeNicks(amountNock) / NOCK_TO_NICKS;
}

export function bridgeReceiveAmountAfterProtocolFeeNock(amountNock: number): number {
  if (!Number.isFinite(amountNock) || amountNock <= 0) return 0;
  const amountInNicks = Math.floor(amountNock * NOCK_TO_NICKS);
  const feeNicks = Math.floor(amountInNicks / NOCK_TO_NICKS) * BRIDGE_PROTOCOL_FEE_NICKS_PER_NOCK;
  const afterNicks = amountInNicks - feeNicks;
  return Math.max(afterNicks / NOCK_TO_NICKS, 0);
}
