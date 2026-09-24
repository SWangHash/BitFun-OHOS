// @vitest-environment jsdom

import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installTypedArrayPolyfills, TYPED_ARRAY_POLYFILL_SOURCE } from './typedArrayPolyfills';

const original = {
  toHex: Uint8Array.prototype.toHex,
  toBase64: Uint8Array.prototype.toBase64,
  fromBase64: Uint8Array.fromBase64,
};

beforeAll(() => {
  // Force the polyfill path regardless of the runner's native support.
  delete Uint8Array.prototype.toHex;
  delete Uint8Array.prototype.toBase64;
  delete Uint8Array.fromBase64;
  installTypedArrayPolyfills();
});

afterAll(() => {
  if (original.toHex) Uint8Array.prototype.toHex = original.toHex;
  if (original.toBase64) Uint8Array.prototype.toBase64 = original.toBase64;
  if (original.fromBase64) Uint8Array.fromBase64 = original.fromBase64;
});

describe('installTypedArrayPolyfills', () => {
  it('installs toHex producing lowercase zero-padded hex', () => {
    expect(new Uint8Array([0x0f, 0x10, 0xab]).toHex()).toBe('0f10ab');
  });

  it('installs toBase64 with standard padding', () => {
    expect(new Uint8Array([104, 105]).toBase64()).toBe('aGk=');
  });

  it('supports base64url alphabet and omitPadding', () => {
    expect(new Uint8Array([104, 105]).toBase64({ alphabet: 'base64url', omitPadding: true })).toBe('aGk');
  });

  it('installs fromBase64 and round-trips', () => {
    const bytes = Uint8Array.fromBase64('aGk=');
    expect(Array.from(bytes)).toEqual([104, 105]);
  });

  it('supports base64url input to fromBase64', () => {
    const bytes = Uint8Array.fromBase64('aGk', { alphabet: 'base64url' });
    expect(Array.from(bytes)).toEqual([104, 105]);
  });

  it('rejects non-string input with TypeError', () => {
    expect(() => Uint8Array.fromBase64(123 as unknown as string)).toThrow(TypeError);
  });

  it('handles empty input', () => {
    const empty = new Uint8Array(0);
    expect(empty.toHex()).toBe('');
    expect(empty.toBase64()).toBe('');
    expect(Array.from(Uint8Array.fromBase64(''))).toEqual([]);
  });
});

describe('TYPED_ARRAY_POLYFILL_SOURCE', () => {
  it('is executable and provides the same behavior', () => {
    const context = vm.createContext({ Uint8Array, TypeError, btoa, atob });
    vm.runInContext(TYPED_ARRAY_POLYFILL_SOURCE, context);
    const result = vm.runInContext(
      "new Uint8Array([0x0f, 0x10, 0xab]).toHex() + '|' + new Uint8Array([104, 105]).toBase64() + '|' + Array.from(Uint8Array.fromBase64('aGk=')).join(',')",
      context,
    );
    expect(result).toBe('0f10ab|aGk=|104,105');
  });
});
