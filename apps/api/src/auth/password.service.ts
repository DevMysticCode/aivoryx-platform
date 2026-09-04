import { Inject, Injectable } from '@nestjs/common';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';

// `@node-rs/argon2` ships `Algorithm` as a `const enum`, which cannot be
// referenced across modules under `isolatedModules`. Argon2id === 2.
const ALGORITHM_ARGON2ID = 2;

/**
 * Argon2id password hashing (ADR 0010 / 0028).
 *
 *  - only Argon2id, parameters from config (`ARGON2_*`)
 *  - output is the standard PHC string (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`)
 *    stored verbatim in `users.password_hash`; algorithm, params and per-hash
 *    salt are embedded, so there is no separate salt column and never plaintext
 *  - `needsRehash` lets `login` transparently upgrade a hash when params change
 */
@Injectable()
export class PasswordService {
  private readonly params: { memoryCost: number; timeCost: number; parallelism: number };

  constructor(@Inject(SERVER_ENV) env: ServerEnv) {
    this.params = {
      memoryCost: env.ARGON2_MEMORY_KIB,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    };
  }

  hash(plaintext: string): Promise<string> {
    return argon2Hash(plaintext, { algorithm: ALGORITHM_ARGON2ID, ...this.params });
  }

  /** Constant-time verify. Returns false (never throws) for a malformed hash. */
  async verify(phcHash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2Verify(phcHash, plaintext);
    } catch {
      return false;
    }
  }

  /** True when `phcHash` was produced with weaker params than the current config. */
  needsRehash(phcHash: string): boolean {
    const parsed = parsePhc(phcHash);
    if (!parsed || parsed.algorithm !== 'argon2id') return true;
    return (
      parsed.memoryCost < this.params.memoryCost ||
      parsed.timeCost < this.params.timeCost ||
      parsed.parallelism < this.params.parallelism
    );
  }
}

interface ParsedPhc {
  algorithm: string;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

function parsePhc(phc: string): ParsedPhc | null {
  // $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
  const parts = phc.split('$');
  if (parts.length < 5) return null;
  const algorithm = parts[1];
  const paramSegment = parts[3];
  if (!algorithm || !paramSegment) return null;
  const params: Record<string, number> = {};
  for (const kv of paramSegment.split(',')) {
    const [k, v] = kv.split('=');
    if (k && v && Number.isFinite(Number(v))) params[k] = Number(v);
  }
  if (params.m === undefined || params.t === undefined || params.p === undefined) return null;
  return {
    algorithm,
    memoryCost: params.m,
    timeCost: params.t,
    parallelism: params.p,
  };
}
