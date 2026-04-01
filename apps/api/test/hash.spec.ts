import { describe, expect, it } from 'vitest';

import { md5 } from '../src/utils/hash.js';

describe('hash helper', () => {
  it('gera md5 determinístico', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});

