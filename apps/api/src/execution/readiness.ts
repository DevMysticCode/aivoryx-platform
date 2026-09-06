import { dec, formatDec } from '../supply/decimal.js';

/**
 * Material readiness (Phase 7, ADR 0036 §4) — a pure roll-up over the Phase 5
 * `project_materials` rows. It never stores or duplicates inventory quantities;
 * it only summarises them so the installation workflow can decide whether
 * required materials are ready.
 */

export type ReadinessState = 'NOT_READY' | 'PARTIALLY_READY' | 'READY';

export interface MaterialQty {
  requiredQty: string;
  allocatedQty: string;
  dispatchedQty: string;
  deliveredQty: string;
}

export interface Readiness {
  state: ReadinessState;
  requiredQty: string;
  allocatedQty: string;
  dispatchedQty: string;
  deliveredQty: string;
  /** materials whose delivered quantity is still short of required */
  shortLines: number;
  totalLines: number;
}

/**
 * READY  = every material line has `delivered >= required`
 * NOT_READY = nothing has been delivered against any line
 * PARTIALLY_READY = otherwise
 *
 * A project with no material lines is READY — there is nothing to wait on.
 */
export function computeReadiness(materials: MaterialQty[]): Readiness {
  let required = 0n;
  let allocated = 0n;
  let dispatched = 0n;
  let delivered = 0n;
  let shortLines = 0;
  let anyDelivered = false;

  for (const m of materials) {
    required += toScaled(m.requiredQty);
    allocated += toScaled(m.allocatedQty);
    dispatched += toScaled(m.dispatchedQty);
    delivered += toScaled(m.deliveredQty);
    if (dec.gt(m.deliveredQty || '0', '0')) anyDelivered = true;
    if (dec.lt(m.deliveredQty || '0', m.requiredQty || '0')) shortLines += 1;
  }

  let state: ReadinessState;
  if (materials.length === 0 || shortLines === 0) state = 'READY';
  else if (!anyDelivered) state = 'NOT_READY';
  else state = 'PARTIALLY_READY';

  return {
    state,
    requiredQty: formatDec(required, 4),
    allocatedQty: formatDec(allocated, 4),
    dispatchedQty: formatDec(dispatched, 4),
    deliveredQty: formatDec(delivered, 4),
    shortLines,
    totalLines: materials.length,
  };
}

/** True when installation may begin: materials READY, or an explicit override. */
export function installationMaterialsOk(readiness: ReadinessState, override: boolean): boolean {
  return readiness === 'READY' || override;
}

function toScaled(value: string): bigint {
  // reuse the decimal helper's parser via `dec.add` against '0'
  return dec.add(value || '0', '0');
}
