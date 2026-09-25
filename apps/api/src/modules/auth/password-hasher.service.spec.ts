import { describe, expect, it } from 'vitest';

import { ScryptPasswordHasher } from './password-hasher.service';

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  it('round-trips a password', async () => {
    const digest = await hasher.hash('correct horse battery staple');

    expect(await hasher.verify(digest, 'correct horse battery staple')).toBe(true);
  });

  it('rejects the near-miss a user actually types', async () => {
    const digest = await hasher.hash('correct horse battery staple');

    expect(await hasher.verify(digest, 'correct horse battery stapl')).toBe(false);
    expect(await hasher.verify(digest, 'Correct horse battery staple')).toBe(false);
  });

  it('never leaves the password in the digest, even encoded', async () => {
    const password = 'correct horse battery staple';
    const digest = await hasher.hash(password);

    expect(digest).not.toContain(password);
    expect(Buffer.from(digest.split('$').at(-1) as string, 'base64').toString()).not.toContain(
      password,
    );
  });

  it('treats a malformed or truncated digest as a failed login rather than a crash', async () => {
    expect(await hasher.verify('not-a-digest', 'anything')).toBe(false);
    expect(await hasher.verify('scrypt$32768$8$1$!!notbase64$also-bad', 'anything')).toBe(false);
    expect(await hasher.verify('', 'anything')).toBe(false);
  });

  it('derives from the cost parameters stored in the digest, not the current defaults', async () => {
    // If verification used the module constants instead of the values in the string,
    // rewriting the digest with a different N would still succeed. Raising the defaults
    // later then has to keep working for old rows precisely because each one carries its
    // own parameters.
    const digest = await hasher.hash('a password');
    const [scheme, , , , salt, key] = digest.split('$');
    const rewritten = [scheme, 2 ** 12, 8, 1, salt, key].join('$');

    expect(await hasher.verify(rewritten, 'a password')).toBe(false);
    expect(await hasher.verify(digest, 'a password')).toBe(true);
  });
});
