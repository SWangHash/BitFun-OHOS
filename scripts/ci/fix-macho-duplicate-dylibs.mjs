// Remove duplicate LC_LOAD_DYLIB entries from a 64-bit little-endian Mach-O
// and remap every two-level library ordinal that survives.
//
// zig's Mach-O linker does not deduplicate dylibs the way Apple's ld64 does:
// repeated -l arguments and tbd re-export chains can leave two load commands
// that resolve to the same dylib (observed: libobjc.A.dylib, libiconv.2.dylib).
// Recent macOS dyld refuses to launch such binaries ("duplicate linked
// dylib").
//
// Removing a load command shifts the dylib ordinals of every later library,
// so this tool remaps ordinals everywhere they are recorded:
//   - LC_SYMTAB undefined symbols (n_desc >> 8).
//   - LC_DYLD_INFO bind/weak/lazy opcode streams:
//       BIND_OPCODE_SET_DYLIB_ORDINAL_IMM  (ordinals 1-15)
//       BIND_OPCODE_SET_DYLIB_ORDINAL_ULEB (ordinals 16+).
// The earlier version of this script skipped the ULEB128 form, which silently
// re-pointed Foundation binds (ordinal 16) at WebKit after the dedup shift
// and aborted at launch with "Symbol not found: _NSHTTPCookieDomain". A
// validation walk now refuses to write the image if any ordinal falls outside
// the surviving library list. 0x00 is treated as a record separator while
// walking a stream: zig terminates every lazy-bind record with
// BIND_OPCODE_DONE, not only the stream tail.
//
// Refuses to touch images that use LC_DYLD_CHAINED_FIXUPS (their ordinal
// mapping lives in the chained-fixup import table, which this tool does not
// rewrite).
//
// Usage: node fix-macho-duplicate-dylibs.mjs <binary>
// Run before re-signing (ldid -S / codesign) — the signature is computed
// over the fixed image.

import { readFileSync, writeFileSync } from 'node:fs';

const LC_SYMTAB = 0x2;
const LC_LOAD_DYLIB = 0xc;
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_REEXPORT_DYLIB = (0x1f | 0x80000000) >>> 0;
const LC_LAZY_LOAD_DYLIB = 0x20;
const LC_LOAD_UPWARD_DYLIB = (0x1d | 0x80000000) >>> 0;
const LC_SEGMENT_64 = 0x19;
const LC_DYLD_INFO = 0x22;
const LC_DYLD_INFO_ONLY = (0x22 | 0x80000000) >>> 0;
const LC_DYLD_CHAINED_FIXUPS = (0x34 | 0x80000000) >>> 0;
// Load commands that occupy a library-ordinal slot, in command order.
const DYLIB_CMDS = new Set([
  LC_LOAD_DYLIB,
  LC_LOAD_WEAK_DYLIB,
  LC_REEXPORT_DYLIB,
  LC_LAZY_LOAD_DYLIB,
  LC_LOAD_UPWARD_DYLIB,
]);
// Only these kinds are deduplicated; re-export/upward entries keep their slot.
const DEDUPABLE_CMDS = new Set([LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB]);

// Bind opcodes (mach-o/loader.h): the high nibble is the opcode, the low
// nibble an immediate or the marker of a ULEB/SLEB operand that follows.
const BIND_OPCODE_DONE = 0x00;
const OP_SET_DYLIB_ORDINAL_IMM = 0x10;
const OP_SET_DYLIB_ORDINAL_ULEB = 0x20;
const OP_SET_DYLIB_SPECIAL_IMM = 0x30;
const OP_SET_SYMBOL_TRAILING_FLAGS_IMM = 0x40;
const OP_SET_TYPE_IMM = 0x50;
const OP_SET_ADDEND_SLEB = 0x60;
const OP_SET_SEGMENT_AND_OFFSET_ULEB = 0x70;
const OP_ADD_ADDR_ULEB = 0x80;
const OP_DO_BIND = 0x90;
const OP_DO_BIND_ADD_ADDR_ULEB = 0xa0;
const OP_DO_BIND_ADD_ADDR_IMM_SCALED = 0xb0;
const OP_DO_BIND_ULEB_TIMES_SKIPPING_ULEB = 0xc0;

const N_TYPE_MASK = 0x0e;
const N_UNDF = 0x0;
const DYNAMIC_LOOKUP_ORDINAL = 0xfe;
const EXECUTABLE_ORDINAL = 0xff;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function dylibNameAt(buffer, position) {
  const command = buffer.readUInt32LE(position);
  if (!DYLIB_CMDS.has(command)) {
    return null;
  }
  const cmdsize = buffer.readUInt32LE(position + 4);
  const nameOffset = buffer.readUInt32LE(position + 8);
  const nameEnd = buffer.indexOf(0, position + nameOffset, 'latin1');
  return buffer.toString('latin1', position + nameOffset, nameEnd === -1 ? position + cmdsize : nameEnd);
}

function readUleb128(image, pos, end) {
  let value = 0;
  let shift = 0;
  while (pos < end) {
    const byte = image[pos];
    pos += 1;
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(byte & 0x80)) {
      return { value, next: pos };
    }
  }
  fail('Truncated ULEB128 in a bind opcode stream');
}

function writeUleb128InPlace(image, pos, length, value) {
  // Dedup only removes load commands, so a remapped ordinal never grows and
  // always fits the original byte count; a shorter value is padded with
  // non-canonical zero continuation bytes, which ULEB128 readers accept.
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (i + 1 < length) {
      byte |= 0x80;
    }
    image[pos + i] = byte;
  }
  if (rest !== 0) {
    fail(`Remapped ordinal ${value} does not fit the original ${length}-byte ULEB128`);
  }
}

function skipUleb128(image, pos, end) {
  while (pos < end) {
    const byte = image[pos];
    pos += 1;
    if (!(byte & 0x80)) {
      return pos;
    }
  }
  fail('Truncated ULEB128/SLEB128 operand in a bind opcode stream');
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node fix-macho-duplicate-dylibs.mjs <macho-binary>');
  process.exit(2);
}

const buf = readFileSync(file);
if (buf.length < 32 || buf.readUInt32LE(0) !== 0xfeedfacf) {
  console.error(`Not a 64-bit little-endian Mach-O: ${file}`);
  process.exit(1);
}

const ncmds = buf.readUInt32LE(16);
const sizeofcmds = buf.readUInt32LE(20);
const cmdsStart = 32;
const cmdsEnd = cmdsStart + sizeofcmds;

// First pass: dylib commands (ordinal slots + duplicates), earliest section
// offset, chained-fixups detection.
const seen = new Set();
const remove = [];
const dylibPositions = [];
let hasChainedFixups = false;
let firstSectionOffset = Number.POSITIVE_INFINITY;
let p = cmdsStart;
for (let i = 0; i < ncmds; i += 1) {
  const cmd = buf.readUInt32LE(p);
  const cmdsize = buf.readUInt32LE(p + 4);
  if (cmdsize < 8 || p + cmdsize > cmdsEnd) {
    fail(`Malformed load command ${i} at offset ${p}`);
  }
  if (cmd === LC_DYLD_CHAINED_FIXUPS) {
    hasChainedFixups = true;
  } else if (cmd === LC_SEGMENT_64) {
    const nsects = buf.readUInt32LE(p + 64);
    for (let s = 0; s < nsects; s += 1) {
      const sectionOffset = buf.readUInt32LE(p + 72 + s * 80 + 48);
      if (sectionOffset > 0 && sectionOffset < firstSectionOffset) {
        firstSectionOffset = sectionOffset;
      }
    }
  } else if (DYLIB_CMDS.has(cmd)) {
    const name = dylibNameAt(buf, p);
    dylibPositions.push(p);
    if (DEDUPABLE_CMDS.has(cmd)) {
      if (seen.has(name)) {
        remove.push([p, cmdsize, name]);
      } else {
        seen.add(name);
      }
    }
  }
  p += cmdsize;
}

if (hasChainedFixups) {
  fail(
    'Image uses LC_DYLD_CHAINED_FIXUPS; its dylib ordinals live in the ' +
      'chained-fixup import table, which this tool does not rewrite. Refusing to modify.',
  );
}

if (remove.length === 0) {
  console.log('No duplicate dylib load commands; nothing to do.');
  process.exit(0);
}

const removedBytes = remove.reduce((total, [, cmdsize]) => total + cmdsize, 0);
const newCmdsEnd = cmdsEnd - removedBytes;
if (newCmdsEnd > firstSectionOffset) {
  fail(
    `Header slack too small to remove ${removedBytes} bytes ` +
      `(load commands would end at ${newCmdsEnd}, first section starts at ${firstSectionOffset})`,
  );
}

// Ordinal remap: survivors keep their relative order; a removed duplicate maps
// to the first surviving occurrence of the same install name.
const removedPositions = new Set(remove.map(([position]) => position));
const survivors = dylibPositions.filter((position) => !removedPositions.has(position));
const survivorCount = survivors.length;
const survivorOrdinal = new Map(survivors.map((position, index) => [position, index + 1]));

function mapOrdinal(oldOrdinal) {
  if (oldOrdinal < 1 || oldOrdinal > dylibPositions.length) {
    return oldOrdinal;
  }
  const position = dylibPositions[oldOrdinal - 1];
  if (!removedPositions.has(position)) {
    return survivorOrdinal.get(position) ?? oldOrdinal;
  }
  const name = dylibNameAt(buf, position);
  const firstSurvivor = survivors.find((candidate) => dylibNameAt(buf, candidate) === name);
  return firstSurvivor !== undefined ? survivorOrdinal.get(firstSurvivor) : oldOrdinal;
}

// Second pass: rebuild the load command region without the duplicates. The
// freed bytes are zero-filled so every later file offset stays stable.
const kept = [];
let cursor = cmdsStart;
for (const [start, cmdsize] of remove) {
  kept.push(buf.subarray(cursor, start));
  cursor = start + cmdsize;
}
kept.push(buf.subarray(cursor, cmdsEnd));

const out = Buffer.concat([
  buf.subarray(0, cmdsStart),
  ...kept,
  Buffer.alloc(removedBytes),
  buf.subarray(cmdsEnd),
]);
out.writeUInt32LE(ncmds - remove.length, 16);
out.writeUInt32LE(sizeofcmds - removedBytes, 20);

// Walk one bind opcode stream. onOrdinal(kind, opcodePos, opcodeLength, value)
// returns the position after the opcode; it may rewrite the ordinal in place.
// 0x00 is treated as a record separator: zig terminates every lazy-bind
// record with DONE, not only the stream tail.
function walkBindStream(image, off, size, label, onOrdinal) {
  if (!off || !size) {
    return;
  }
  const end = off + size;
  let sp = off;
  while (sp < end) {
    const byte = image[sp];
    if (byte === BIND_OPCODE_DONE) {
      sp += 1;
      continue;
    }
    const opcode = byte & 0xf0;
    const imm = byte & 0x0f;
    if (opcode === OP_SET_DYLIB_ORDINAL_IMM) {
      sp = onOrdinal('imm', sp, 1, imm);
    } else if (opcode === OP_SET_DYLIB_ORDINAL_ULEB) {
      const { value, next } = readUleb128(image, sp + 1, end);
      sp = onOrdinal('uleb', sp, next - sp, value);
    } else if (
      opcode === OP_SET_DYLIB_SPECIAL_IMM ||
      opcode === OP_SET_TYPE_IMM ||
      opcode === OP_DO_BIND ||
      opcode === OP_DO_BIND_ADD_ADDR_IMM_SCALED
    ) {
      sp += 1;
    } else if (opcode === OP_SET_SYMBOL_TRAILING_FLAGS_IMM) {
      const nameEnd = image.indexOf(0, sp + 1, 'latin1');
      if (nameEnd === -1 || nameEnd >= end) {
        fail(`Unterminated symbol name in the ${label} stream at offset ${sp}`);
      }
      sp = nameEnd + 1;
    } else if (
      opcode === OP_SET_ADDEND_SLEB ||
      opcode === OP_SET_SEGMENT_AND_OFFSET_ULEB ||
      opcode === OP_ADD_ADDR_ULEB ||
      opcode === OP_DO_BIND_ADD_ADDR_ULEB
    ) {
      sp = skipUleb128(image, sp + 1, end);
    } else if (opcode === OP_DO_BIND_ULEB_TIMES_SKIPPING_ULEB) {
      sp = skipUleb128(image, skipUleb128(image, sp + 1, end), end);
    } else {
      fail(
        `Unsupported bind opcode 0x${byte.toString(16)} in the ${label} stream at offset ${sp}; ` +
          'aborting without writing',
      );
    }
  }
}

function remapStreamOrdinals(image, off, size, label) {
  let patched = 0;
  walkBindStream(image, off, size, label, (kind, pos, length, value) => {
    const mapped = mapOrdinal(value);
    if (mapped !== value) {
      if (kind === 'imm') {
        if (mapped > 15) {
          fail(`Ordinal ${value} -> ${mapped} does not fit the 4-bit immediate in the ${label} stream`);
        }
        image[pos] = OP_SET_DYLIB_ORDINAL_IMM | mapped;
      } else {
        writeUleb128InPlace(image, pos + 1, length - 1, mapped);
      }
      patched += 1;
    }
    return pos + length;
  });
  if (patched > 0) {
    console.log(`Remapped ${patched} ordinals in the ${label} stream`);
  }
  return patched;
}

function validateStreamOrdinals(image, off, size, label) {
  walkBindStream(image, off, size, label, (kind, pos, length, value) => {
    if (value !== 0 && (value < 1 || value > survivorCount)) {
      fail(
        `Ordinal ${value} in the ${label} stream is outside the surviving ` +
          `1..${survivorCount} library list; aborting without writing`,
      );
    }
    return pos + length;
  });
}

// Third pass on the rebuilt image: remap undefined symbols' library ordinals
// in LC_SYMTAB and every ordinal opcode in the LC_DYLD_INFO streams.
let symtabPatched = 0;
const streamPatched = { bind: 0, weak: 0, lazy: 0 };
let q = cmdsStart;
const newNcmds = ncmds - remove.length;
for (let i = 0; i < newNcmds; i += 1) {
  const cmd = out.readUInt32LE(q);
  const cmdsize = out.readUInt32LE(q + 4);
  if (cmd === LC_SYMTAB) {
    const symoff = out.readUInt32LE(q + 8);
    const nsyms = out.readUInt32LE(q + 12);
    for (let s = 0; s < nsyms; s += 1) {
      const entry = symoff + s * 16;
      const n_type = out.readUInt8(entry + 4);
      if ((n_type & N_TYPE_MASK) !== N_UNDF) {
        continue;
      }
      const n_desc = out.readUInt16LE(entry + 6);
      const ordinal = n_desc >> 8;
      if (ordinal === 0 || ordinal === DYNAMIC_LOOKUP_ORDINAL || ordinal === EXECUTABLE_ORDINAL) {
        continue;
      }
      const mapped = mapOrdinal(ordinal);
      if (mapped !== ordinal) {
        out.writeUInt16LE(((n_desc & 0xff) | (mapped << 8)) >>> 0, entry + 6);
        symtabPatched += 1;
      }
    }
  } else if (cmd === LC_DYLD_INFO || cmd === LC_DYLD_INFO_ONLY) {
    streamPatched.bind = remapStreamOrdinals(out, out.readUInt32LE(q + 16), out.readUInt32LE(q + 20), 'bind');
    streamPatched.weak = remapStreamOrdinals(out, out.readUInt32LE(q + 24), out.readUInt32LE(q + 28), 'weak');
    streamPatched.lazy = remapStreamOrdinals(out, out.readUInt32LE(q + 32), out.readUInt32LE(q + 36), 'lazy');
  }
  q += cmdsize;
}

// Validation pass: every surviving ordinal must address the new library list.
// A stale ordinal is exactly the launch failure this tool exists to prevent
// ("Symbol not found" against the wrong framework), so refuse to write the
// image if any remain.
q = cmdsStart;
for (let i = 0; i < newNcmds; i += 1) {
  const cmd = out.readUInt32LE(q);
  const cmdsize = out.readUInt32LE(q + 4);
  if (cmd === LC_SYMTAB) {
    const symoff = out.readUInt32LE(q + 8);
    const nsyms = out.readUInt32LE(q + 12);
    for (let s = 0; s < nsyms; s += 1) {
      const entry = symoff + s * 16;
      const n_type = out.readUInt8(entry + 4);
      if ((n_type & N_TYPE_MASK) !== N_UNDF) {
        continue;
      }
      const ordinal = out.readUInt16LE(entry + 6) >> 8;
      if (
        ordinal !== 0 &&
        ordinal !== DYNAMIC_LOOKUP_ORDINAL &&
        ordinal !== EXECUTABLE_ORDINAL &&
        (ordinal < 1 || ordinal > survivorCount)
      ) {
        fail(
          `Symbol table ordinal ${ordinal} is outside the surviving ` +
            `1..${survivorCount} library list; aborting without writing`,
        );
      }
    }
  } else if (cmd === LC_DYLD_INFO || cmd === LC_DYLD_INFO_ONLY) {
    validateStreamOrdinals(out, out.readUInt32LE(q + 16), out.readUInt32LE(q + 20), 'bind');
    validateStreamOrdinals(out, out.readUInt32LE(q + 24), out.readUInt32LE(q + 28), 'weak');
    validateStreamOrdinals(out, out.readUInt32LE(q + 32), out.readUInt32LE(q + 36), 'lazy');
  }
  q += cmdsize;
}

writeFileSync(file, out);

const names = [...new Set(remove.map(([, , name]) => name))].join(', ');
console.log(`Removed ${remove.length} duplicate dylib load commands (${names}); ${survivorCount} libraries remain.`);
console.log(
  `Remapped ordinals: ${symtabPatched} in LC_SYMTAB, ` +
    `${streamPatched.bind} bind, ${streamPatched.weak} weak, ${streamPatched.lazy} lazy.`,
);
console.log('Re-sign required (ldid -S / codesign).');
