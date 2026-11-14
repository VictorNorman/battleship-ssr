import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { describe, it } from 'node:test';
import { cleanName, parseCookies, requireName, safeNext, setViewer, viewerOf } from './identity.js';

const fakeRequest = (cookie: string | undefined, originalUrl = '/'): Request => {
  return {
    headers: {
      cookie,
    },
    originalUrl,
  } as unknown as Request;
};

describe('parseCookies', () => {
  it('returns nothing for a missing header', () => {
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies(''), {});
  });

  it('parses several cookies and trims whitespace', () => {
    assert.deepEqual(parseCookies('a=1;  b=2 ; c=3'), {
      a: '1',
      b: '2',
      c: '3',
    });
  });

  it('decodes percent-encoding', () => {
    assert.deepEqual(parseCookies('player=Ana%20Smith'), {
      player: 'Ana Smith',
    });
  });

  it('keeps equals signs inside the value', () => {
    assert.deepEqual(parseCookies('token=a=b=c'), {
      token: 'a=b=c',
    });
  });

  it('skips pairs without an equals sign', () => {
    assert.deepEqual(parseCookies('junk; a=1'), {
      a: '1',
    });
  });

  it('skips malformed percent-encoding but keeps the others', () => {
    assert.deepEqual(parseCookies('bad=%E0%A4%A; ok=yes'), {
      ok: 'yes',
    });
  });

  it('lets a later duplicate win', () => {
    assert.deepEqual(parseCookies('a=1; a=2'), {
      a: '2',
    });
  });
});

describe('cleanName', () => {
  it('rejects non-strings', () => {
    assert.equal(cleanName(undefined), null);
    assert.equal(cleanName(null), null);
    assert.equal(cleanName(42), null);
    assert.equal(cleanName(['Ana']), null);
  });

  it('rejects empty and whitespace-only names', () => {
    assert.equal(cleanName(''), null);
    assert.equal(cleanName('   \t '), null);
  });

  it('trims and collapses internal whitespace', () => {
    assert.equal(cleanName('  Ana   Maria\t Smith '), 'Ana Maria Smith');
  });

  it('accepts exactly 24 characters and rejects 25', () => {
    assert.equal(cleanName('a'.repeat(24)), 'a'.repeat(24));
    assert.equal(cleanName('a'.repeat(25)), null);
  });

  it('measures length after cleaning', () => {
    assert.equal(cleanName(`  ${'a'.repeat(24)}  `), 'a'.repeat(24));
  });

  it('rejects control characters', () => {
    assert.equal(cleanName('An\u0000a'), null);
    assert.equal(cleanName('An\u001ba'), null);
    assert.equal(cleanName('An\u007fa'), null);
  });

  it('turns newlines into single spaces', () => {
    assert.equal(cleanName('Ana\nBen'), 'Ana Ben');
  });

  it('allows unicode and markup characters (they are escaped on output)', () => {
    assert.equal(cleanName('Zoë 🚢'), 'Zoë 🚢');
    assert.equal(cleanName('<b>'), '<b>');
  });
});

describe('viewerOf', () => {
  it('reads the player cookie', () => {
    assert.equal(viewerOf(fakeRequest('player=Ana')), 'Ana');
  });

  it('is null without a cookie or with an invalid name', () => {
    assert.equal(viewerOf(fakeRequest(undefined)), null);
    assert.equal(viewerOf(fakeRequest('other=1')), null);
    assert.equal(viewerOf(fakeRequest(`player=${'a'.repeat(40)}`)), null);
    assert.equal(viewerOf(fakeRequest('player=%00')), null);
  });

  it('ignores other cookies around it', () => {
    assert.equal(viewerOf(fakeRequest('a=1; player=Ben; b=2')), 'Ben');
  });
});

describe('safeNext', () => {
  it('allows same-site paths, including query strings', () => {
    assert.equal(safeNext('/games/abc'), '/games/abc');
    assert.equal(safeNext('/lobby?x=1'), '/lobby?x=1');
    assert.equal(safeNext('/'), '/');
  });

  it('falls back to the lobby for anything else', () => {
    for (const bad of [
      undefined,
      null,
      42,
      '',
      'games',
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      ['/lobby'],
    ]) {
      assert.equal(safeNext(bad), '/lobby', String(bad));
    }
  });
});

describe('setViewer', () => {
  it('sets a lax, site-wide cookie', () => {
    const calls: unknown[][] = [];
    const res = {
      cookie: (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as Response;
    setViewer(res, 'Ana');
    assert.deepEqual(calls, [
      [
        'player',
        'Ana',
        {
          sameSite: 'lax',
          path: '/',
        },
      ],
    ]);
  });
});

describe('requireName', () => {
  it('calls next when a name is present', () => {
    let nexted = false;
    const res = {
      redirect: () => {
        assert.fail('should not redirect');
      },
    } as unknown as Response;
    requireName(fakeRequest('player=Ana'), res, () => {
      nexted = true;
    });
    assert.ok(nexted);
  });

  it('redirects to the name form, remembering where the visitor was going', () => {
    const redirects: string[] = [];
    const res = {
      redirect: (url: string) => {
        redirects.push(url);
      },
    } as unknown as Response;
    requireName(fakeRequest(undefined, '/games/abc?x=1'), res, () => {
      assert.fail('should not continue');
    });
    assert.deepEqual(redirects, ['/?next=%2Fgames%2Fabc%3Fx%3D1']);
  });
});
