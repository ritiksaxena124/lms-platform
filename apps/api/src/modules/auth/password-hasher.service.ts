import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

import { Injectable } from '@nestjs/common';

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

/**
 * Swap this implementation without touching a single caller — the domain asks to hash
 * and verify, and does not get to know which function that turned out to be.
 */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(digest: string, plain: string): Promise<boolean>;
}

const KEY_LENGTH = 32;
const COST_N = 2 ** 15;
const COST_R = 8;
const COST_P = 1;
/** scrypt needs 128·N·r bytes of scratch space; Node's 32 MB default is exactly that,
 * which it rejects, so the ceiling has to be lifted deliberately. */
const MAX_MEMORY = 64 * 1024 * 1024;

/**
 * `scrypt$N$r$p$salt$digest`, all base64.
 *
 * scrypt is from `node:crypto`. Argon2id is the stronger recommendation on paper, but
 * every Argon2 and bcrypt binding on npm is a native module, and "works on the dev's
 * laptop, fails to build on the VPS" is the worse failure for a POC. Cost parameters are
 * written into the digest rather than assumed at verify time, so raising them later can
 * still check a password hashed today.
 */
@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const digest = await this.derive(plain, salt, KEY_LENGTH);

    return [
      'scrypt',
      COST_N,
      COST_R,
      COST_P,
      salt.toString('base64'),
      digest.toString('base64'),
    ].join('$');
  }

  async verify(digest: string, plain: string): Promise<boolean> {
    const [scheme, n, r, p, salt, expected] = digest.split('$');
    if (scheme !== 'scrypt' || !n || !r || !p || !salt || !expected) return false;

    const [costN, costR, costP] = [Number(n), Number(r), Number(p)];
    if (![costN, costR, costP].every((cost) => Number.isFinite(cost) && cost > 0)) return false;

    try {
      const expectedBytes = Buffer.from(expected, 'base64');
      const actual = await this.derive(plain, Buffer.from(salt, 'base64'), expectedBytes.length, {
        N: costN,
        r: costR,
        p: costP,
        maxmem: MAX_MEMORY,
      });
      return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
    } catch {
      // A malformed digest is a failed login, not a 500.
      return false;
    }
  }

  private derive(
    plain: string,
    salt: Buffer,
    keyLength: number,
    costs: ScryptOptions = { N: COST_N, r: COST_R, p: COST_P, maxmem: MAX_MEMORY },
  ): Promise<Buffer> {
    // NFKC so two visually identical passwords with different Unicode spellings cannot
    // produce two different hashes for the same account.
    return scryptAsync(plain.normalize('NFKC'), salt, keyLength, costs);
  }
}
