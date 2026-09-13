/**
 * @jest-environment node
 */
import {validateRemoteRelease} from './validation';

const VALID_PAYLOAD = {
  version: '1.1.0',
  versionCode: 2,
  apkUrl: 'https://example.com/kharcha-1.1.0.apk',
  releaseNotes: ['Added monthly analytics', 'Improved performance'],
  mandatory: false,
};

describe('validateRemoteRelease', () => {
  it('accepts a fully valid payload', () => {
    expect(validateRemoteRelease(VALID_PAYLOAD)).toEqual({
      version: '1.1.0',
      versionCode: 2,
      apkUrl: 'https://example.com/kharcha-1.1.0.apk',
      releaseNotes: ['Added monthly analytics', 'Improved performance'],
      mandatory: false,
    });
  });

  it('accepts a payload without the optional fields', () => {
    const {releaseNotes, mandatory, ...minimal} = VALID_PAYLOAD;
    expect(validateRemoteRelease(minimal)).toEqual({
      ...minimal,
      releaseNotes: [],
      mandatory: false,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '1.1.0'],
    ['a number', 42],
    ['an empty array', []],
  ])('rejects %p', (_label, payload) => {
    expect(validateRemoteRelease(payload)).toBeNull();
  });

  it.each([
    ['missing version', {...VALID_PAYLOAD, version: undefined}],
    ['empty version', {...VALID_PAYLOAD, version: '   '}],
    ['non-string version', {...VALID_PAYLOAD, version: 2}],
    ['oversized version', {...VALID_PAYLOAD, version: 'v'.repeat(33)}],
  ])('rejects a payload with %s', (_label, payload) => {
    expect(validateRemoteRelease(payload)).toBeNull();
  });

  it.each([
    ['a string', '2'],
    ['a float', 2.5],
    ['zero', 0],
    ['a negative number', -3],
    ['true (boolean)', true],
    ['null', null],
    ['NaN (JSON never yields it, but guard anyway)', Number.NaN],
  ])('rejects a versionCode that is %s', (_label, versionCode) => {
    expect(validateRemoteRelease({...VALID_PAYLOAD, versionCode})).toBeNull();
  });

  it('rejects an absurdly large versionCode (Android int cap)', () => {
    expect(
      validateRemoteRelease({...VALID_PAYLOAD, versionCode: 2_100_000_001}),
    ).toBeNull();
  });

  it.each([
    ['http', 'http://example.com/kharcha.apk'],
    ['javascript', 'javascript:alert(1)'],
    ['ftp', 'ftp://example.com/kharcha.apk'],
    ['data', 'data:text/html,hello'],
    ['plain garbage', 'not a url'],
    ['empty string', '   '],
    ['missing', undefined],
  ])('rejects an apkUrl that is %s', (_label, apkUrl) => {
    expect(validateRemoteRelease({...VALID_PAYLOAD, apkUrl})).toBeNull();
  });

  it('rejects a non-array releaseNotes', () => {
    expect(
      validateRemoteRelease({...VALID_PAYLOAD, releaseNotes: 'nope'}),
    ).toBeNull();
  });

  it('sanitizes releaseNotes leniently instead of rejecting', () => {
    const messy = {
      ...VALID_PAYLOAD,
      releaseNotes: ['  Added monthly analytics  ', 42, null, '', 'x'.repeat(500)],
    };
    const result = validateRemoteRelease(messy);
    expect(result).not.toBeNull();
    expect(result?.releaseNotes).toHaveLength(2);
    expect(result?.releaseNotes[0]).toBe('Added monthly analytics');
    expect(result?.releaseNotes[1].length).toBe(200);
  });

  it('caps releaseNotes at 10 entries', () => {
    const notes = Array.from({length: 15}, (_v, i) => `note ${i + 1}`);
    const result = validateRemoteRelease({...VALID_PAYLOAD, releaseNotes: notes});
    expect(result?.releaseNotes).toHaveLength(10);
  });

  it.each([
    ['boolean true', true, true],
    ['boolean false', false, false],
    ['missing', undefined, false],
    ['string "true" (not trusted)', 'true', false],
  ])('maps mandatory %s to %p', (_label, mandatory, expected) => {
    const result = validateRemoteRelease({...VALID_PAYLOAD, mandatory});
    expect(result?.mandatory).toBe(expected);
  });

  it('ignores unknown extra fields (forward compatible)', () => {
    const result = validateRemoteRelease({
      ...VALID_PAYLOAD,
      somedayNewField: {nested: true},
    });
    expect(result).toEqual({
      version: '1.1.0',
      versionCode: 2,
      apkUrl: 'https://example.com/kharcha-1.1.0.apk',
      releaseNotes: ['Added monthly analytics', 'Improved performance'],
      mandatory: false,
    });
  });

  it('trims surrounding whitespace from version and apkUrl', () => {
    const result = validateRemoteRelease({
      ...VALID_PAYLOAD,
      version: '  1.1.0  ',
      apkUrl: '  https://example.com/k.apk  ',
    });
    expect(result?.version).toBe('1.1.0');
    expect(result?.apkUrl).toBe('https://example.com/k.apk');
  });
});
