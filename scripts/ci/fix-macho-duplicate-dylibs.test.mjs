// Regression tests for fix-macho-duplicate-dylibs.mjs.
//
// The fixture mirrors the real cargo-zigbuild desktop binary that failed to
// launch: duplicate LC_LOAD_DYLIB entries at ordinals 2 and 6, Foundation at
// ordinal 16, WebKit at ordinal 18, and lazy-bind records individually
// terminated with BIND_OPCODE_DONE. The earlier version of the fixer skipped
// ULEB128-encoded ordinals (>= 16) and stopped the lazy walk at the first
// DONE, which left Foundation binds pointing at WebKit after the dedup shift
// ("Symbol not found: _NSHTTPCookieDomain").

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptDir, 'fix-macho-duplicate-dylibs.mjs');

const LC_SYMTAB = 0x2;
const LC_LOAD_DYLIB = 0xc;
const LC_SEGMENT_64 = 0x19;
const LC_DYLD_INFO_ONLY = (0x22 | 0x80000000) >>> 0;
const LC_DYLD_CHAINED_FIXUPS = (0x34 | 0x80000000) >>> 0;

// 18 dylibs: duplicates at ordinals 2 and 6; after dedup Foundation moves
// 16 -> 14 and WebKit 18 -> 16, so a stale ordinal 16 lands on WebKit.
const DYLIBS = [
  '/usr/lib/libobjc.A.dylib',
  '/usr/lib/libobjc.A.dylib',
  '/usr/lib/libbz2.1.0.dylib',
  '/usr/lib/libiconv.2.dylib',
  '/usr/lib/libz.1.dylib',
  '/usr/lib/libiconv.2.dylib',
  '/usr/lib/libcharset.1.dylib',
  '/System/Library/Frameworks/ApplicationServices.framework/Versions/A/ApplicationServices',
  '/System/Library/Frameworks/CoreGraphics.framework/Versions/A/CoreGraphics',
  '/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation',
  '/System/Library/Frameworks/IOKit.framework/Versions/A/IOKit',
  '/System/Library/Frameworks/Vision.framework/Versions/A/Vision',
  '/System/Library/Frameworks/Carbon.framework/Versions/A/Carbon',
  '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit',
  '/System/Library/Frameworks/CoreData.framework/Versions/A/CoreData',
  '/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation',
  '/System/Library/Frameworks/OSAKit.framework/Versions/A/OSAKit',
  '/System/Library/Frameworks/WebKit.framework/Versions/A/WebKit',
];
const EXPECTED_SURVIVORS = DYLIBS.filter(
  (name, index) => !(name === '/usr/lib/libobjc.A.dylib' && index === 1) && !(name === '/usr/lib/libiconv.2.dylib' && index === 5),
);

const SECTION_OFFSET = 0x1000;
const SYMTAB_OFFSET = 0x1100;
const BIND_OFFSET = 0x1200;
const LAZY_OFFSET = 0x1300;
const FILE_SIZE = 0x1400;

function align8(value) {
  return Math.ceil(value / 8) * 8;
}

function uleb128(value) {
  const bytes = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (rest !== 0);
  return bytes;
}

function dylibCommand(name) {
  const nameBytes = Buffer.from(name, 'latin1');
  const cmdsize = align8(24 + nameBytes.length + 1);
  const cmd = Buffer.alloc(cmdsize);
  cmd.writeUInt32LE(LC_LOAD_DYLIB, 0);
  cmd.writeUInt32LE(cmdsize, 4);
  cmd.writeUInt32LE(24, 8);
  nameBytes.copy(cmd, 24);
  return cmd;
}

function segmentCommand() {
  const cmd = Buffer.alloc(152);
  cmd.writeUInt32LE(LC_SEGMENT_64, 0);
  cmd.writeUInt32LE(152, 4);
  cmd.write('__DATA', 8, 'latin1');
  cmd.writeUInt32LE(1, 64);
  cmd.write('__dummy', 72, 'latin1');
  cmd.write('__DATA', 72 + 16, 'latin1');
  cmd.writeUInt32LE(SECTION_OFFSET, 72 + 48);
  return cmd;
}

function chainedFixupsCommand() {
  const cmd = Buffer.alloc(16);
  cmd.writeUInt32LE(LC_DYLD_CHAINED_FIXUPS, 0);
  cmd.writeUInt32LE(16, 4);
  cmd.writeUInt32LE(0x1500, 8);
  cmd.writeUInt32LE(16, 12);
  return cmd;
}

function bindRecord(name, ordinalKind, ordinal, offset) {
  const bytes = [0x40];
  for (const ch of Buffer.from(name, 'latin1')) bytes.push(ch);
  bytes.push(0x00);
  if (ordinalKind === 'imm') {
    bytes.push(0x10 | ordinal);
  } else {
    bytes.push(0x20, ...uleb128(ordinal));
  }
  bytes.push(0x51);
  bytes.push(0x70, ...uleb128(offset));
  bytes.push(0x90);
  bytes.push(0x00);
  return Buffer.from(bytes);
}

function lazyRecord(name, ordinalKind, ordinal, offset) {
  const bytes = [0x70, ...uleb128(offset)];
  bytes.push(0x40);
  for (const ch of Buffer.from(name, 'latin1')) bytes.push(ch);
  bytes.push(0x00);
  if (ordinalKind === 'imm') {
    bytes.push(0x10 | ordinal);
  } else {
    bytes.push(0x20, ...uleb128(ordinal));
  }
  bytes.push(0x90);
  bytes.push(0x00);
  return Buffer.from(bytes);
}

function buildStrtab(names) {
  const parts = ['\0'];
  const offsets = new Map();
  for (const name of names) {
    offsets.set(name, parts.reduce((total, part) => total + part.length, 0));
    parts.push(`${name}\0`);
  }
  return { table: Buffer.from(parts.join(''), 'latin1'), offsets };
}

function buildFixture({ uniqueDylibs = false, chainedFixups = false, outOfRangeOrdinal = false } = {}) {
  const dylibs = uniqueDylibs ? DYLIBS.map((name, index) => `${name}.${index}`) : DYLIBS;
  const strtab = buildStrtab(['_sym_objc', '_sym_foundation', '_sym_corefoundation']);
  const strtabOffset = SYMTAB_OFFSET + 3 * 16;

  const bindRecords = [
    bindRecord('_sym_foundation', 'uleb', 16, 0x10),
    bindRecord('_sym_corefoundation', 'imm', 10, 0x18),
    bindRecord('_sym_objc', 'imm', 1, 0x20),
  ];
  if (outOfRangeOrdinal) {
    bindRecords.push(bindRecord('_sym_out_of_range', 'uleb', 25, 0x28));
  }
  const bindStream = Buffer.concat(bindRecords);
  const lazyStream = Buffer.concat([
    lazyRecord('_lazy_a', 'uleb', 16, 0x08),
    lazyRecord('_lazy_b', 'uleb', 16, 0x10),
  ]);

  const symtabCommand = Buffer.alloc(24);
  symtabCommand.writeUInt32LE(LC_SYMTAB, 0);
  symtabCommand.writeUInt32LE(24, 4);
  symtabCommand.writeUInt32LE(SYMTAB_OFFSET, 8);
  symtabCommand.writeUInt32LE(3, 12);
  symtabCommand.writeUInt32LE(strtabOffset, 16);
  symtabCommand.writeUInt32LE(strtab.table.length, 20);

  const dyldInfoCommand = Buffer.alloc(48);
  dyldInfoCommand.writeUInt32LE(LC_DYLD_INFO_ONLY, 0);
  dyldInfoCommand.writeUInt32LE(48, 4);
  dyldInfoCommand.writeUInt32LE(BIND_OFFSET, 16);
  dyldInfoCommand.writeUInt32LE(bindStream.length, 20);
  dyldInfoCommand.writeUInt32LE(LAZY_OFFSET, 32);
  dyldInfoCommand.writeUInt32LE(lazyStream.length, 36);

  const commands = [
    segmentCommand(),
    ...dylibs.map(dylibCommand),
    symtabCommand,
    dyldInfoCommand,
  ];
  if (chainedFixups) {
    commands.push(chainedFixupsCommand());
  }
  const sizeofcmds = commands.reduce((total, cmd) => total + cmd.length, 0);
  assert.ok(32 + sizeofcmds < SECTION_OFFSET, 'fixture load commands must fit before the first section');

  const image = Buffer.alloc(FILE_SIZE);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(0, 8);
  image.writeUInt32LE(2, 12);
  image.writeUInt32LE(commands.length, 16);
  image.writeUInt32LE(sizeofcmds, 20);
  image.writeUInt32LE(0x200084, 24);
  let cursor = 32;
  for (const cmd of commands) {
    cmd.copy(image, cursor);
    cursor += cmd.length;
  }

  // Undefined symbols: _sym_objc (duplicate libobjc, ordinal 2),
  // _sym_foundation (ordinal 16), _sym_corefoundation (ordinal 10).
  const symbols = [
    { name: '_sym_objc', ordinal: 2 },
    { name: '_sym_foundation', ordinal: 16 },
    { name: '_sym_corefoundation', ordinal: 10 },
  ];
  symbols.forEach((symbol, index) => {
    const entry = SYMTAB_OFFSET + index * 16;
    image.writeUInt32LE(strtab.offsets.get(symbol.name), entry);
    image.writeUInt8(0x01, entry + 4);
    image.writeUInt16LE(symbol.ordinal << 8, entry + 6);
  });
  strtab.table.copy(image, strtabOffset);
  bindStream.copy(image, BIND_OFFSET);
  lazyStream.copy(image, LAZY_OFFSET);
  return image;
}

function runFixer(image) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fix-macho-test-'));
  const binaryPath = path.join(dir, 'bitfun-desktop');
  writeFileSync(binaryPath, image);
  const result = spawnSync(process.execPath, [scriptPath, binaryPath], { encoding: 'utf8' });
  const fixed = readFileSync(binaryPath);
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, fixed };
}

function parseDylibs(buffer) {
  const ncmds = buffer.readUInt32LE(16);
  const sizeofcmds = buffer.readUInt32LE(20);
  const names = [];
  let p = 32;
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = buffer.readUInt32LE(p);
    const cmdsize = buffer.readUInt32LE(p + 4);
    if (cmd === LC_LOAD_DYLIB) {
      const nameOffset = buffer.readUInt32LE(p + 8);
      const nameEnd = buffer.indexOf(0, p + nameOffset, 'latin1');
      names.push(buffer.toString('latin1', p + nameOffset, nameEnd));
    }
    p += cmdsize;
  }
  assert.equal(p, 32 + sizeofcmds);
  return names;
}

function findDyldInfo(buffer) {
  const ncmds = buffer.readUInt32LE(16);
  let p = 32;
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = buffer.readUInt32LE(p);
    const cmdsize = buffer.readUInt32LE(p + 4);
    if (cmd === LC_DYLD_INFO_ONLY) {
      return {
        bindOff: buffer.readUInt32LE(p + 16),
        bindSize: buffer.readUInt32LE(p + 20),
        lazyOff: buffer.readUInt32LE(p + 32),
        lazySize: buffer.readUInt32LE(p + 36),
      };
    }
    p += cmdsize;
  }
  throw new Error('LC_DYLD_INFO_ONLY not found');
}

function parseBindRecords(buffer, off, size) {
  const records = [];
  let sp = off;
  const end = off + size;
  let sym = null;
  let ordinal = 0;
  while (sp < end) {
    const byte = buffer[sp];
    if (byte === 0x00) {
      sp += 1;
      continue;
    }
    const opcode = byte & 0xf0;
    const imm = byte & 0x0f;
    if (opcode === 0x10) {
      ordinal = imm;
      sp += 1;
    } else if (opcode === 0x20) {
      let value = 0;
      let shift = 0;
      let q = sp + 1;
      let t;
      do {
        t = buffer[q];
        q += 1;
        value += (t & 0x7f) * 2 ** shift;
        shift += 7;
      } while (t & 0x80);
      ordinal = value;
      sp = q;
    } else if (opcode === 0x40) {
      const nameEnd = buffer.indexOf(0, sp + 1, 'latin1');
      sym = buffer.toString('latin1', sp + 1, nameEnd);
      sp = nameEnd + 1;
    } else if (opcode === 0x90) {
      records.push({ sym, ordinal });
      sym = null;
      ordinal = 0;
      sp += 1;
    } else if (opcode === 0x30 || opcode === 0x50 || opcode === 0xb0) {
      sp += 1;
    } else if (opcode === 0x60 || opcode === 0x70 || opcode === 0x80 || opcode === 0xa0) {
      let q = sp + 1;
      let t;
      do {
        t = buffer[q];
        q += 1;
      } while (t & 0x80);
      sp = q;
    } else if (opcode === 0xc0) {
      let q = sp + 1;
      let t;
      do {
        t = buffer[q];
        q += 1;
      } while (t & 0x80);
      do {
        t = buffer[q];
        q += 1;
      } while (t & 0x80);
      sp = q;
    } else {
      throw new Error(`unexpected opcode 0x${byte.toString(16)}`);
    }
  }
  return records;
}

function parseSymtabOrdinals(buffer) {
  const ncmds = buffer.readUInt32LE(16);
  let p = 32;
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = buffer.readUInt32LE(p);
    const cmdsize = buffer.readUInt32LE(p + 4);
    if (cmd === LC_SYMTAB) {
      const symoff = buffer.readUInt32LE(p + 8);
      const nsyms = buffer.readUInt32LE(p + 12);
      const stroff = buffer.readUInt32LE(p + 16);
      const ordinals = new Map();
      for (let s = 0; s < nsyms; s += 1) {
        const entry = symoff + s * 16;
        const strx = buffer.readUInt32LE(entry);
        const nameEnd = buffer.indexOf(0, stroff + strx, 'latin1');
        const name = buffer.toString('latin1', stroff + strx, nameEnd);
        ordinals.set(name, buffer.readUInt16LE(entry + 6) >> 8);
      }
      return ordinals;
    }
    p += cmdsize;
  }
  throw new Error('LC_SYMTAB not found');
}

test('removes duplicates and remaps IMM + ULEB128 ordinals everywhere', () => {
  const image = buildFixture();
  const { status, stdout, fixed } = runFixer(image);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /Removed 2 duplicate dylib load commands/);
  assert.match(stdout, /16 libraries remain/);
  assert.match(stdout, /Remapped 2 ordinals in the bind stream/);
  assert.match(stdout, /Remapped 2 ordinals in the lazy stream/);
  assert.match(stdout, /Remapped ordinals: 3 in LC_SYMTAB, 2 bind, 0 weak, 2 lazy\./);

  assert.equal(fixed.length, FILE_SIZE);
  const names = parseDylibs(fixed);
  assert.deepEqual(names, EXPECTED_SURVIVORS);
  assert.equal(new Set(names).size, names.length);

  const info = findDyldInfo(fixed);
  // Foundation (old ordinal 16) must move to 14, not stay on WebKit's slot.
  const bindOrdinals = new Map(parseBindRecords(fixed, info.bindOff, info.bindSize).map((r) => [r.sym, r.ordinal]));
  assert.equal(bindOrdinals.get('_sym_foundation'), 14);
  assert.equal(bindOrdinals.get('_sym_corefoundation'), 8);
  assert.equal(bindOrdinals.get('_sym_objc'), 1);

  // Both lazy records sit behind an earlier BIND_OPCODE_DONE separator.
  const lazyOrdinals = new Map(parseBindRecords(fixed, info.lazyOff, info.lazySize).map((r) => [r.sym, r.ordinal]));
  assert.equal(lazyOrdinals.get('_lazy_a'), 14);
  assert.equal(lazyOrdinals.get('_lazy_b'), 14);

  const symtabOrdinals = parseSymtabOrdinals(fixed);
  assert.equal(symtabOrdinals.get('_sym_objc'), 1);
  assert.equal(symtabOrdinals.get('_sym_foundation'), 14);
  assert.equal(symtabOrdinals.get('_sym_corefoundation'), 8);
});

test('leaves an image without duplicates untouched', () => {
  const image = buildFixture({ uniqueDylibs: true });
  const { status, stdout, fixed } = runFixer(image);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /No duplicate dylib load commands; nothing to do\./);
  assert.ok(fixed.equals(image));
});

test('refuses to modify images using chained fixups', () => {
  const image = buildFixture({ chainedFixups: true });
  const { status, stderr, fixed } = runFixer(image);
  assert.equal(status, 1);
  assert.match(stderr, /LC_DYLD_CHAINED_FIXUPS/);
  assert.ok(fixed.equals(image));
});

test('aborts instead of writing when an ordinal stays out of range', () => {
  const image = buildFixture({ outOfRangeOrdinal: true });
  const { status, stderr, fixed } = runFixer(image);
  assert.equal(status, 1);
  assert.match(stderr, /Ordinal 25 in the bind stream is outside the surviving 1\.\.16 library list/);
  assert.ok(fixed.equals(image));
});
