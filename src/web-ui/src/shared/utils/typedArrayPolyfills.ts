/**
 * ES2025 `Uint8Array` to/from base64 & hex polyfills.
 *
 * pdf.js >= 5.4 (after mozilla/pdf.js#5b368dd) dropped its own polyfills for
 * `Uint8Array.prototype.toHex`, `Uint8Array.prototype.toBase64`, and
 * `Uint8Array.fromBase64`, assuming the runtime supports the native methods
 * (Chrome/Edge >= 129, Firefox >= 133, Safari >= 18.2, Node >= 22.9).
 * Embedded WebViews (e.g. HarmonyOS ArkWeb based on older Chromium) do not,
 * which makes every PDF load fail with `a.toHex is not a function` while the
 * document fingerprint is computed.
 *
 * Install the main-thread side with `installTypedArrayPolyfills()` and prepend
 * `TYPED_ARRAY_POLYFILL_SOURCE` to the pdf.js worker source so the worker
 * global gets the same methods (the fingerprint path runs inside the worker).
 */

/** Self-contained worker-safe source. Keep in sync with installTypedArrayPolyfills below. */
export const TYPED_ARRAY_POLYFILL_SOURCE = [
  '(function () {',
  "  'use strict';",
  '  if (typeof Uint8Array.prototype.toHex !== \'function\') {',
  '    Object.defineProperty(Uint8Array.prototype, \'toHex\', {',
  '      configurable: true,',
  '      writable: true,',
  '      value: function () {',
  "        var hex = '';",
  '        for (var i = 0; i < this.length; i += 1) {',
  "          hex += this[i].toString(16).padStart(2, '0');",
  '        }',
  '        return hex;',
  '      }',
  '    });',
  '  }',
  '  if (typeof Uint8Array.prototype.toBase64 !== \'function\') {',
  '    Object.defineProperty(Uint8Array.prototype, \'toBase64\', {',
  '      configurable: true,',
  '      writable: true,',
  '      value: function (options) {',
  "        var binary = '';",
  '        for (var i = 0; i < this.length; i += 1) {',
  '          binary += String.fromCharCode(this[i]);',
  '        }',
  '        var result = btoa(binary);',
  "        if (options && options.alphabet === 'base64url') {",
  '          result = result.split(\'+\').join(\'-\').split(\'/\').join(\'_\');',
  '        }',
  '        if (options && options.omitPadding) {',
  "          result = result.replace(/=+$/, '');",
  '        }',
  '        return result;',
  '      }',
  '    });',
  '  }',
  '  if (typeof Uint8Array.fromBase64 !== \'function\') {',
  '    Object.defineProperty(Uint8Array, \'fromBase64\', {',
  '      configurable: true,',
  '      writable: true,',
  '      value: function (string, options) {',
  "        if (typeof string !== 'string') {",
  "          throw new TypeError('String expected');",
  '        }',
  '        var normalized = string;',
  "        if (options && options.alphabet === 'base64url') {",
  '          normalized = string.split(\'-\').join(\'+\').split(\'_\').join(\'/\');',
  '        }',
  '        var binary = atob(normalized);',
  '        var bytes = new Uint8Array(binary.length);',
  '        for (var i = 0; i < binary.length; i += 1) {',
  '          bytes[i] = binary.charCodeAt(i);',
  '        }',
  '        return bytes;',
  '      }',
  '    });',
  '  }',
  '})();',
  '',
].join('\n');

declare global {
  interface Uint8ArrayConstructor {
    fromBase64?: (string: string, options?: { alphabet?: 'base64' | 'base64url' }) => Uint8Array;
  }
  interface Uint8Array {
    toBase64?: (options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }) => string;
    toHex?: () => string;
  }
}

/**
 * Install the three polyfills on the calling global (main thread). No-op when
 * the runtime already provides the native methods.
 */
export function installTypedArrayPolyfills(): void {
  if (typeof Uint8Array.prototype.toHex !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      configurable: true,
      writable: true,
      value(this: Uint8Array): string {
        let hex = '';
        for (let index = 0; index < this.length; index += 1) {
          hex += this[index].toString(16).padStart(2, '0');
        }
        return hex;
      },
    });
  }

  if (typeof Uint8Array.prototype.toBase64 !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      configurable: true,
      writable: true,
      value(this: Uint8Array, options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string {
        let binary = '';
        for (let index = 0; index < this.length; index += 1) {
          binary += String.fromCharCode(this[index]);
        }
        let result = btoa(binary);
        if (options?.alphabet === 'base64url') {
          result = result.replace(/\+/g, '-').replace(/\//g, '_');
        }
        if (options?.omitPadding) {
          result = result.replace(/=+$/, '');
        }
        return result;
      },
    });
  }

  if (typeof Uint8Array.fromBase64 !== 'function') {
    Object.defineProperty(Uint8Array, 'fromBase64', {
      configurable: true,
      writable: true,
      value(string: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array {
        if (typeof string !== 'string') {
          throw new TypeError('String expected');
        }
        let normalized = string;
        if (options?.alphabet === 'base64url') {
          normalized = string.replace(/-/g, '+').replace(/_/g, '/');
        }
        const binary = atob(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      },
    });
  }
}
