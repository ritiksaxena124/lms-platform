import { describe, expect, it } from 'vitest';

import { parseEnvFile } from './global-setup';

describe('parseEnvFile', () => {
  it('reads KEY=VALUE pairs, ignoring comments and blank lines', () => {
    const parsed = parseEnvFile(
      ['# comment', '', 'NODE_ENV=test', 'PORT=4000', '   ', 'QUOTED="hello world"'].join('\n'),
    );
    expect(parsed.get('NODE_ENV')).toBe('test');
    expect(parsed.get('PORT')).toBe('4000');
    expect(parsed.get('QUOTED')).toBe('hello world');
  });

  it('keeps a value that itself contains =, as connection strings do', () => {
    const parsed = parseEnvFile(
      'DATABASE_URL=postgresql://lms:pw@localhost:5432/lms?schema=public',
    );
    expect(parsed.get('DATABASE_URL')).toBe('postgresql://lms:pw@localhost:5432/lms?schema=public');
  });

  it('preserves an empty value so the config layer can treat it as unset', () => {
    expect(parseEnvFile('JWT_SECRET=').get('JWT_SECRET')).toBe('');
  });
});
