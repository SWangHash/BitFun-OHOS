#!/usr/bin/env node
/**
 * 鸿蒙 PC（hmfs）要求原生库在 dlopen/exec 前携带代码签名段，
 * 否则报 ERR_DLOPEN_FAILED / Permission denied。
 *
 * 本脚本扫描 node_modules 中的原生 ELF（*.node、*.so*、bin/ 下无扩展名可执行文件），
 * 对未签名的文件调用 binary-sign-tool 自签（selfSign）。
 *
 * 接入点：
 *   - 根 package.json "postinstall"：每次安装依赖后自动补签
 *   - 根 package.json "build"：构建前兜底再扫一遍
 *
 * 非 HarmonyOS 环境（无 binary-sign-tool）自动跳过，不影响其他平台开发。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";

const TOOL = "binary-sign-tool";
const MAX_SIZE = 300 * 1024 * 1024;
const ROOTS = [path.resolve(process.cwd(), "node_modules")];

function toolAvailable() {
  const r = spawnSync(TOOL, ["display-sign"], { encoding: "utf8" });
  // 仅当可执行文件本身不存在（非鸿蒙环境）时跳过；其余情况（参数错、退出码非0）都视为可用
  return !(r.error && r.error.code === "ENOENT");
}

function isSigned(file) {
  const r = spawnSync(TOOL, ["display-sign", "-inFile", file], { encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  return out.includes("code signature is");
}

function signFile(file) {
  const tmp = `${file}.tmpsign`;
  const r = spawnSync(TOOL, ["sign", "-inFile", file, "-outFile", tmp, "-selfSign", "1"], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !existsSync(tmp)) {
    console.warn(`[ohos-sign] 签名失败(忽略): ${file}`);
    try { existsSync(tmp) && renameSync(tmp, file); } catch {}
    return false;
  }
  renameSync(tmp, file);
  return true;
}

function isElf(file) {
  let fd = -1;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(4);
    const n = readSync(fd, buf, 0, 4, 0);
    return n === 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  } catch {
    return false;
  } finally {
    if (fd >= 0) closeSync(fd);
  }
}

function* walk(dir, depth = 0) {
  if (depth > 12) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (e.isFile()) yield p;
  }
}

function isCandidate(file, relName) {
  if (relName.endsWith(".node")) return true;
  if (/\.so([.\d]+)?$/.test(relName)) return true;
  // 无扩展名的 bin 目录可执行文件（esbuild 等）
  if (!path.extname(relName) && relName.includes("/bin/")) return true;
  return false;
}

function main() {
  if (!toolAvailable()) {
    console.log("[ohos-sign] 未检测到 binary-sign-tool，非鸿蒙环境跳过签名。");
    process.exit(0);
  }
  let scanned = 0;
  let signed = 0;
  let skipped = 0;
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      const rel = file.slice(root.length + 1);
      if (!isCandidate(file, rel)) continue;
      let st;
      try { st = statSync(file); } catch { continue; }
      if (st.size > MAX_SIZE || st.size === 0) continue;
      scanned++;
      if (isSigned(file)) { skipped++; continue; }
      if (!isElf(file)) continue;
      if (signFile(file)) signed++;
    }
  }
  console.log(`[ohos-sign] 扫描 ${scanned} 个原生文件：新签名 ${signed}，已签名 ${skipped}。`);
}

main();
