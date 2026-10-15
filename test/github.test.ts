import { describe, it, expect } from 'vitest';
import { AUTHOR_EMAIL, buildPutBody, contentsUrl } from '../src/github';

describe('contentsUrl', () => {
  it('builds the Contents API url', () => {
    expect(contentsUrl('huraypositive', 'huray-design-token', 'tokens.json')).toBe(
      'https://api.github.com/repos/huraypositive/huray-design-token/contents/tokens.json',
    );
  });
});

describe('buildPutBody', () => {
  it('base64-encodes 2-space JSON and includes sha when updating', () => {
    const body = buildPutBody({ json: { a: 1 }, message: 'm', branch: 'b', sha: 's' });
    expect(body.message).toBe('m');
    expect(body.branch).toBe('b');
    expect(body.sha).toBe('s');
    expect(JSON.parse(atob(body.content))).toEqual({ a: 1 });
    expect(atob(body.content)).toBe('{\n  "a": 1\n}');
  });
  it('omits sha when creating new file', () => {
    const body = buildPutBody({ json: {}, message: 'm', branch: 'b' });
    expect('sha' in body).toBe(false);
  });
  it('adds author (name + fixed email) only when a name is given', () => {
    const body = buildPutBody({ json: {}, message: 'm', branch: 'b', author: '홍길동' });
    expect(body.author).toEqual({ name: '홍길동', email: AUTHOR_EMAIL });
    expect('author' in buildPutBody({ json: {}, message: 'm', branch: 'b' })).toBe(false);
  });
});
