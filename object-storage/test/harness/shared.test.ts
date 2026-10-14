import { describe, expect, it } from 'vitest';
import { crc32c, crc32cHex, sha256Hex } from '../../shared/checksum';
import { DAY, FakeClock } from '../../shared/clock';
import { AWKWARD_KEYS, PREFIX_KEYS } from '../fixtures/keys';

const enc = (s: string) => new TextEncoder().encode(s);

describe('harness: checksums', () => {
  it('CRC32C matches the standard check value', () => {
    expect(crc32c(enc('123456789'))).toBe(0xe3069283);
    expect(crc32cHex(enc('123456789'))).toBe('e3069283');
    expect(crc32cHex(new Uint8Array(0))).toBe('00000000');
  });

  it('SHA-256 matches known digests', () => {
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const big = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(big)).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('harness: fake clock', () => {
  it('starts at a fixed time and only moves when told', () => {
    const clock = new FakeClock(Date.UTC(2026, 0, 1));
    expect(clock.date().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    clock.advance(7 * DAY);
    expect(clock.date().toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(() => clock.advance(-1)).toThrow();
    expect(() => clock.set(0)).toThrow();
  });
});

describe('harness: key fixtures', () => {
  it('are distinct strings and include the prefix family', () => {
    expect(new Set(AWKWARD_KEYS).size).toBe(AWKWARD_KEYS.length);
    expect(PREFIX_KEYS).toEqual(expect.arrayContaining(['report', 'report/a', 'report-2']));
    expect(AWKWARD_KEYS.some((k) => k.includes('../'))).toBe(true);
    expect(AWKWARD_KEYS.some((k) => k.endsWith('/'))).toBe(true);
  });
});
