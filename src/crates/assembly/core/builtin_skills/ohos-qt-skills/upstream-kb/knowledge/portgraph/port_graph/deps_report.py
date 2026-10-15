"""综合依赖分析（deps report）：一个 Qt 工程的依赖全景画像。

按角色回答"这个项目到底依赖什么"：

  link       项目期望获取到编译产物的依赖（目标侧 headers + .so/.a，
             编译/链接应用时必须存在；缺失则交叉编译失败）
  build-tool 编译器/构建工具依赖（构建机运行：cmake 版本、C++ 标准、
             代码生成器 protoc/flex/bison…；不部署到设备）
  runtime    运行时依赖（设备侧 .so：link 依赖的传递闭包 +
             dlopen/QLibrary 动态加载；不参与编译但缺了跑不起来）
  test       测试专用依赖（不进发行包）
  vendored   项目内自带源码（.gitmodules / 3rdparty 目录，随项目编译）

每个依赖附：
  - 版本要求（find_package 最低版本 / pkg-config·meson·autotools 约束 /
    conan 范围）
  - 需求级别（REQUIRED / optional）
  - 鸿蒙产物获取途径（hb bottle / cmd-pkgs / Qt SDK 提供 / 系统自带 /
    需源码移植）与版本要求校验（satisfied / conflict）

用法：

    python portgraph.py deps <项目路径|已扫描应用名> [--json]

与既有命令的关系：analyze 回答"能不能移植"；fetch-deps 回答"产物怎么拿"；
deps 回答"依赖全景是什么、各自扮演什么角色、版本要求是否满足"。
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Dict, List, Optional

from . import db, engine, kb_seed, project_scanner, qt_scanner
from .kb_seed import PKG_ALIASES as LIB_NAME_ALIASES
from .qt_scanner import BUILD_TOOL_FINDPKG, WIN32_SYSTEM_LIBS

# OHOS 系统自带库（NDK sysroot / 系统镜像）：链接无需自带产物
# （KB: semantic/qt-harmonyos-third-party-libs §系统库直链）
OHOS_SYSTEM_LIBS = {
    "zlib": "OHOS 系统/NDK 自带 libz，可直接 -lz；用 bottle 亦可",
    "z": "OHOS 系统/NDK 自带 libz",
    "openssl": "OHOS 系统自带 libssl/libcrypto（Qt 编译需额外配置头文件路径）",
    "ssl": "OHOS 系统自带 libssl",
    "crypto": "OHOS 系统自带 libcrypto",
    "icu": "OHOS 系统自带 ICU（Qt 时区/文本后端依赖）",
    "pthread": "musl libc 内置 pthread",
    "dl": "musl libc 内置 dlopen",
    "m": "musl libc 数学库",
    "rt": "musl libc",
    "atomic": "编译器运行时 libatomic（OHOS NDK clang 自带）",
    "gcov": "GCC 覆盖率运行时（clang 用 --coverage；通常仅测试/覆盖率构建使用）",
    "stdc++": "OHOS NDK libc++",
    "c++": "OHOS NDK libc++",
    "c++_shared": "OHOS NDK libc++_shared（随 SDK 提供）",
    "log": "OHOS NDK hilog（libhilog_ndk.z.so）",
    "EGL": "OHOS 系统 EGL（libEGL_ndk.z.so）",
    "GLESv3": "OHOS 系统 OpenGL ES（libGLESv3_ndk.z.so）",
    "GLESv2": "OHOS 系统 OpenGL ES",
    "intl": "musl libc 内置 gettext/libintl",
}
# 键统一小写：裸链接名经 .lower() 匹配（GLESv3/glesv3 等）
OHOS_SYSTEM_LIBS = {k.lower(): v for k, v in OHOS_SYSTEM_LIBS.items()}

# Windows 系统库（qmake win32 块 / MSVC 链接）：鸿蒙不适用（代码通常被
# 平台守卫包裹），标注而非当作“需源码编译”的缺口。
# 表本体在 qt_scanner（project_scanner 扫描期也需按它过滤 win32 系统库
# 名，防止同名 Unix 库（如 bcrypt）误连边）

# -l 链接名 → 常见包名对齐（hb 包名口径）：见 kb_seed.PKG_ALIASES
# （deps_report 与 project_scanner 共享同一张表，保证 deps 与
#   fetch-deps/analyze 的名称解析口径一致）

# libav* 系列的 pkg-config 版本号是库主版本号（libavcodec 58 ≈
# ffmpeg 4.x），与 ffmpeg 发布版本不同量纲：跨名归并到 ffmpeg 后该
# 约束不可直接比较——由 version_req_from 机制统一处理（worker1 方案）

# CMake 内置模块：非第三方包，按语义归类（kind + 说明）
CMAKE_BUILTIN_PACKAGES = {
    "threads": {"kind": "system-lib",
                "note": "CMake 内置 Threads 模块：pthread（musl libc 内置）"},
    "openmp": {"kind": "build-tool",
               "note": "编译器特性：OHOS NDK clang 支持 -fopenmp（libomp 随 SDK）"},
    "iconv": {"kind": "system-lib", "note": "musl libc 内置 iconv"},
    "dl": {"kind": "system-lib", "note": "musl libc 内置 dlopen"},
    "opengl": {"kind": "system-lib",
               "note": "OHOS 提供 OpenGL ES（libEGL_ndk / libGLESv3_ndk），"
                      "桌面 OpenGL 调用需适配 GLES 3（gen_d/gen_p 实证）"},
    "packagehandlestandardargs": {
        "kind": "build-tool",
        "note": "CMake 内置模块（find_package_handle_standard_args），非依赖"
                "（gen_d FindFFTW.cmake 实证；曾以错名"
                "findpackagehandlestandardargs 入表致幽灵残留）"},
}

# 平台接口绑定包：find_package/链接命中说明应用直连该平台栈，
# 鸿蒙不可用（是否真的编译由 analyze 的宏守卫/CMake 条件证据判定）
INTERFACE_BOUND_PACKAGES = {
    "x11": "X11 显示接口：鸿蒙不支持直连；确认所在代码是否可通过构建选项"
           "/条件编译裁剪，hb 的 libx11 bottle 仅用于依赖链传递场景",
    "xext": "X11 扩展：鸿蒙不支持直连",
    "xcb": "XCB：鸿蒙不支持直连",
    "alsa": "ALSA 音频：鸿蒙不可用，需改鸿蒙 AudioRenderer",
    "asound": "ALSA 客户端库名（-lasound / find_library）：鸿蒙不可用，"
            "需改鸿蒙 AudioRenderer/AudioCapturer（gen_d FindAlsa 实证）",
    "pulseaudio": "PulseAudio：鸿蒙无此服务",
    "libpulse": "PulseAudio 客户端库（pkg-config 名 libpulse）：鸿蒙无此服务，"
              "需改鸿蒙 AudioRenderer/AudioCapturer（gen_d 实证）",
    "pulse": "PulseAudio 客户端库名（find_library pulse / -lpulse）：鸿蒙无此"
           "服务（gen_d FindPulseAudio 实证）",
    "dbus": "D-Bus IPC：鸿蒙无 D-Bus（Qt D-Bus 模块 Out of scope）",
    "cocoa": "macOS Cocoa：鸿蒙不适用",
    "appkit": "macOS AppKit：鸿蒙不适用",
    "coreaudio": "macOS CoreAudio：鸿蒙不可用",
    "wayland": "Wayland 直连：鸿蒙窗口模型非 Wayland 协议",
    "systemd": "systemd：鸿蒙无 systemd",
    "network": "macOS Network 框架（裸链接名形态）：通常位于 APPLE "
              "平台块，鸿蒙不适用",
    "foundation": "macOS Foundation 框架：鸿蒙不适用（APPLE 平台块）",
    "security": "macOS Security 框架：鸿蒙不适用（APPLE 平台块）",
    "coreservices": "macOS CoreServices 框架：鸿蒙不适用（APPLE 平台块）",
    "corefoundation": "macOS CoreFoundation 框架：鸿蒙不适用（APPLE 平台块）",
    # macOS 框架经 find_library 裸名引入（corpus_b_core 实证：AudioToolbox/CoreMIDI
    # 在 OS_IS_MAC 块内 find_library，未命中表时被当普通包报“需源码交叉编译”）
    "audiotoolbox": "macOS AudioToolbox 框架：鸿蒙不可用，需改鸿蒙"
                  " AudioRenderer/AudioCapturer（APPLE 平台块内引入）",
    "coremidi": "macOS CoreMIDI 框架：鸿蒙不适用（APPLE 平台块内引入；"
              "MIDI 需改鸿蒙 MIDI 能力）",
    "carbon": "macOS Carbon 遗留框架：鸿蒙不适用（APPLE 平台块内引入）",
}

# find_package 命中的主机侧构建工具（原 _FINDPKG_SKIP 静默丢弃，现归入
# build-tool 分类，不再丢失信息）。表本体在 qt_scanner（project_scanner
# 也需按它过滤运行时边；deps_report 不能被 project_scanner 反向依赖）

# 测试框架（find_package/QT 模块名命中 → test 分类）
TEST_FRAMEWORKS = {
    "gtest", "googletest", "catch2", "catch", "doctest", "qtest", "qttest",
    "testlib", "cppunit", "boosttest", "unittest++", "gtest_main", "qttest",
    "gmock", "gmock_main",
    "cxxtest",
}

# Qt 自带的构建工具（由 Qt SDK 提供，无需单独准备）
QT_TOOL_NAMES = {"moc", "uic", "rcc", "lupdate", "lrelease", "lconvert",
                 "qmake", "qtpaths", "lrelease-pro", "lupdate-pro"}

# Qt for HarmonyOS 可用版本（KB 校验基准：5.12.12 / 5.15.16 / 6.12 预构建）
QT_OHOS_AVAILABLE = {"5": ("5.12", "5.15"), "6": ("6.12",)}

RECURSE_TYPES = ("runtime",)
SKIP_PLATFORM_CONDS = ("macos",)
PROVIDED_KINDS = ("qt-module", "platform-api")


# ---------------------------------------------------------------- 版本比较

def _ver_key(v) -> tuple:
    if not v:
        return ()
    parts = re.findall(r"\d+", str(v))
    return tuple(int(p) for p in parts)


def _check_min(min_ver: Optional[str], available: Optional[str]) -> str:
    """find_package 最低版本 vs 可用版本。"""
    if min_ver is None:
        return "any" if available else "unknown"
    if not available:
        return "unknown"
    return ("satisfied" if _ver_key(available) >= _ver_key(min_ver)
            else "conflict")


def _check_req(version_req: Optional[str], available: Optional[str]) -> str:
    """pkg-config/conan 带操作符约束（">= 2.50"）vs 可用版本。"""
    if not version_req:
        return _check_min(None, available)
    m = re.match(r"(>=|<=|==|=|<|>|!=)\s*([\w.]+)", version_req)
    if not m:
        return "unknown"
    if not available:
        return "unknown"
    op, want = m.group(1), _ver_key(m.group(2))
    have = _ver_key(available)
    if not want or not have:
        return "unknown"
    ok = {">=": have >= want, "<=": have <= want, "<": have < want,
          ">": have > want, "==": have == want, "=": have == want,
          "!=": have != want}.get(op)
    if ok is None:
        return "unknown"
    return "satisfied" if ok else "conflict"


# ---------------------------------------------------------------- 产物解析

def _resolve(conn, name: str, cache: Optional[Dict] = None) -> Optional[Dict]:
    """包名（find_package/pkg-config/include 线索）→ 已入库包节点。

    委托 kb_seed.resolve_pkg_name 共享解析阶梯（别名优先 → 原名 →
    lib 前缀变体 → 去 pkg-config 版本后缀），与扫描期（project_scanner）
    口径一致——扫描期建幽灵节点而报告期能解析的口径分裂由此消除
    （libsparsehash/gio-2.0 实证）。
    cache: 单次分析内的解析结果缓存（含 None 未命中；分析期间图不变）。
    """
    if conn is None:
        return None
    return kb_seed.resolve_pkg_name(conn, name, cache)


def _artifact_of(node: Optional[Dict]) -> Optional[Dict]:
    if node is None:
        return None
    art = engine.artifact_info(node)
    if art["ready"]:
        src = art["artifact_url"] or art["artifact_cmd"] or art["artifact_local"]
    elif art["provided"]:
        src = "provided"
    else:
        src = None
    return {"ready": art["ready"], "provided": art["provided"],
            "source": src,
            "source_url": art.get("source_url"),
            "repo_url": art.get("repo_url")}


def _in_tree_dir_index(root: Path) -> Dict[str, str]:
    """项目内自带源码目录索引：目录名（小写）→ 相对路径。

    用于判定未解析的裸链接名/find_package 名是否其实是项目自带源码
    （gen_f 的 src/libraries/fakevim、botan、litehtml 实证：报告
    误报 need_port，而源码就在仓库内随项目编译）。

    只收「像三方库」的目录，避免把项目自身代码目录（gen_a 的
    libs/flake/text/lager、plugins/impex/jpeg/3rdparty/lcms 里的
    iccjpeg 胶水）误判成 in-tree：
      - 目录含构建文件（CMakeLists/Makefile.am/.pri/.pro）（无构建文件的
        胶水目录如 iccjpeg 由此排除）
      - 且满足其一：路径含 vendored 目录段（3rdparty/external/…）、
        父目录是依赖集合（≥5 个子目录各自含构建文件，如 src/libraries）、
        目录含 README/LICENSE/COPYING（上游源码包特征）
    """
    vendored_names = set(qt_scanner.VENDORED_DIR_NAMES)
    lib_dirs: Dict[str, list] = {}      # dirpath -> (basename, relpath, nfiles)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in (".git", "node_modules", "build",
                                    "build_ohos")]
        d = Path(dirpath)
        base = d.name.lower()
        if not base or len(base) < 3 or base in lib_dirs:
            continue
        has_build = any(f in filenames for f in
                        ("CMakeLists.txt", "Makefile.am")) or any(
            f.rsplit(".", 1)[-1] in ("pri", "pro") for f in filenames)
        if not has_build:
            continue
        lib_dirs[dirpath] = [base, d.relative_to(root).as_posix(), 0,
                             filenames]
    # 父目录的“依赖集合”判定：父目录名是库容器（libraries/libs）且
    # ≥5 个子目录各自像库目录。容器名白名单是为了避免把功能分组目录
    # 误当依赖集合——gen_b 的 generators/（poppler/epub/markdown/…）
    # 是格式生成器插件代码目录，不是自带库源码（实证误判 in-tree，
    # 掩盖 poppler/epub 真实 need_port）；gen_f 的 src/libraries
    # 是真实的自带库集合。
    _LIB_CONTAINER_NAMES = {"libraries", "libs"}
    children: Dict[str, int] = {}
    for dirpath in lib_dirs:
        parent = str(Path(dirpath).parent)
        children[parent] = children.get(parent, 0) + 1
    out: Dict[str, str] = {}
    for dirpath, (base, rel, _n, filenames) in lib_dirs.items():
        parts = Path(rel).parts[:-1]
        parent_path = Path(dirpath).parent
        parent = str(parent_path)
        parent_is_collection = (
            children.get(parent, 0) >= 5
            and parent_path.name.lower() in _LIB_CONTAINER_NAMES)
        has_readme = any(f.upper().startswith(("README", "LICENSE", "COPYING"))
                         for f in filenames)
        # README/LICENSE 单独不足以判定：gen_b generators/epub 的 README
        # 描述的是“基于外部 libepub 的后端”（指向 svn 获取库），不是自带
        # 源码包——仅在库容器父目录内作为补充佐证（容器内非集合规模的
        # 自带库，如 libraries/ 下仅 2 个真库但各自带上游 README）。
        if (vendored_names.intersection(parts) or parent_is_collection
                or (has_readme
                    and parent_path.name.lower() in _LIB_CONTAINER_NAMES)):
            out.setdefault(base, rel)
    return out


def _loose_folds(n: str) -> set:
    """依赖名宽松折叠候选集：小写、去非字母数字、去 lib 前缀、
    去尾部 qt5/qt6/system 变体 token。

    editorconfig_core_qt ≡ editorconfig-core-qt；
    Qt-Advanced-Docking-System ≡ qtadvanceddocking-qt6（CPM 名 ads
    vs 链接目标名 qtadvanceddocking-qt6，gen_i 实证）。"""
    toks = [t for t in re.split(r"[-_./]+", (n or "").lower()) if t]
    while toks and toks[-1] in ("qt5", "qt6", "system"):
        toks = toks[:-1]
    out = set()
    if toks:
        f = "".join(toks)
        out.add(f)
        if f.startswith("lib") and len(f) > 3:
            out.add(f[3:])
    return {f for f in out if len(f) >= 3}


def _vendored_declarations(info: Dict) -> Dict[str, tuple]:
    """项目自带源码声明索引：宽松折叠名 → (标签, 详情)。

    覆盖四类“随项目编译”的声明：
    - git 子模块（.gitmodules；浅克隆未初始化时目录为空，
      _in_tree_dir_index 不可见）——corpus_a kcoreaddons/microtex 实证
    - CPM/FetchContent/ExternalProject 配置期拉取（fetched_deps；
      名字或 URL 末段均可匹配）——gen_i ads/QSimpleUpdater 实证
    - meson 自带子项目（subprojects/ 目录与 .wrap）与项目内部
      override_dependency 目标——gen_j/rizin 的 zydis/rz_* 实证
    """
    out: Dict[str, tuple] = {}

    def add(nm: str, label: str, detail: str) -> None:
        for f in _loose_folds(nm):
            if f not in out:
                out[f] = (label, detail)

    for gm in info.get("git_submodules") or []:
        cands = [gm.get("name") or "", gm.get("path") or ""]
        url_last = ((gm.get("url") or "").rstrip("/").rsplit("/", 1)[-1])
        if url_last.endswith(".git"):
            url_last = url_last[:-4]
        cands.append(url_last)
        path = gm.get("path") or gm.get("name") or ""
        for c in cands:
            add(c, "git 子模块", path)
    for fd in info.get("fetched_deps") or []:
        nm = fd.get("name") or ""
        how = fd.get("how") or "FetchContent"
        add(nm, how, nm)
        url = fd.get("url") or ""
        last = url.rstrip("/").rsplit("/", 1)[-1]
        if last.endswith(".git"):
            last = last[:-4]
        if last:
            add(last, how, nm)
    meson = info.get("meson") or {}
    for nm in meson.get("internal_deps") or []:
        add(nm, "meson 子项目/内部目标", nm)
    for nm in meson.get("subprojects") or []:
        add(nm, "meson 子项目", nm)
    return out


def _match_in_tree_dir(index: Dict[str, str], name: str) -> Optional[str]:
    """未解析的库名 → 项目内同名源码目录（去版本后缀/别名口径）。"""
    cands = [name.lower()]
    canon = LIB_NAME_ALIASES.get(name.lower())
    if canon:
        cands.append(canon.lower())
    for c in list(cands):
        stripped = re.sub(r"-\d+(\.\d+)*$", "", c)
        if stripped != c:
            cands.append(stripped)
    for c in cands:
        hit = index.get(c)
        if hit:
            return hit
    return None


class _GraphCache:
    """单次分析内的图查询缓存（节点 / 出边）。

    deps 报告对每个 link 依赖各做一次 runtime 闭包 BFS，同一节点会被
    反复查库（200 个依赖 × 深链图实测 24 万次 SQL 查询）。分析期间
    图不变，共享缓存把总查询量压回 O(V+E)。
    """

    def __init__(self, conn):
        self.conn = conn
        self._nodes: Dict = {}
        self._edges: Dict = {}

    def node(self, node_id: str) -> Optional[Dict]:
        if node_id not in self._nodes:
            self._nodes[node_id] = db.get_node(self.conn, node_id)
        return self._nodes[node_id]

    def out_edges(self, node_id: str, etypes) -> List[Dict]:
        key = (node_id, etypes)
        if key not in self._edges:
            self._edges[key] = db.out_edges(self.conn, node_id, etypes)
        return self._edges[key]


def _runtime_closure(conn, node_id: str,
                     cache: Optional[_GraphCache] = None) -> List[Dict]:
    """一个包节点的传递 runtime 依赖（BFS；跳过 provided 与 macos 条件）。

    与 deps_fetch.dependency_closure 口径一致：bottle 不捆绑依赖，
    目标侧链接/运行仍需其依赖的 .so。
    cache: 跨依赖共享的节点/出边缓存（见 _GraphCache）。
    """
    from collections import deque
    if cache is None:
        cache = _GraphCache(conn)
    out: List[Dict] = []
    visited = {node_id}
    queue = deque([node_id])
    while queue:
        nid = queue.popleft()
        if nid != node_id:
            node = cache.node(nid)
            if node:
                out.append(node)
        for e in cache.out_edges(nid, RECURSE_TYPES):
            if e.get("platform_cond") in SKIP_PLATFORM_CONDS:
                continue
            if e["dst"] not in visited:
                visited.add(e["dst"])
                nd = cache.node(e["dst"])
                if nd is None or nd["kind"] in PROVIDED_KINDS:
                    continue
                queue.append(e["dst"])
    return out


def _version_check(entry: Dict) -> str:
    """多源版本约束（conan 范围 / pkg 约束 / find_package 最低版本）
    是否满足：同时存在时取最差结果（任一冲突即冲突）。

    version_req_from 存在时，version_req 来自另一个库名（别名归并，如
    libavcodec >= 58 → ffmpeg），约束的是库主版本而非包版本，口径
    不可比 → 按未知处理（不产生虚假 conflict）。
    """
    avail = entry.get("available_version")
    cross = bool(entry.get("version_req_from"))
    checks = []
    if entry.get("version_range"):
        checks.append(_check_req(_range_to_req(entry["version_range"]), avail))
    if entry.get("version_req"):
        checks.append("unknown" if cross
                      else _check_req(entry["version_req"], avail))
    if entry.get("min_version"):
        checks.append(_check_min(entry["min_version"], avail))
    if "conflict" in checks:
        return "conflict"
    if "satisfied" in checks:
        return "satisfied"
    if checks:
        return checks[0]
    return "any" if avail else "unknown"


# ---------------------------------------------------------------- 主分析

def _merge_link_entries(base: Dict, entry: Dict) -> None:
    """把同库异名条目 entry 合入 base（7b 阶段调用）。

    - REQUIRED 优先；版本信息取最先出现的明确值（与 _DepBook 口径一致）
    - kind 更具体的覆盖（system-lib/platform-iface/framework 优先于 package）
    - base 无产物而 entry 有（跨源 hb/cmdpkgs 互补）时采用 entry 的解析结果
    """
    base["required"] = base["required"] or entry["required"]
    for f in ("min_version", "version_req", "version_range"):
        base[f] = base.get(f) or entry.get(f)
    if not base.get("version_req") and entry.get("version_req") \
            and entry.get("version_req_from"):
        base["version_req_from"] = entry["version_req_from"]
    if entry["kind"] not in ("package", base["kind"]):
        # kind 更具体的覆盖（system-lib/platform-iface/framework 优先）
        if base["kind"] == "package":
            base["kind"] = entry["kind"]
    if entry.get("ohos_note") and not base.get("ohos_note"):
        base["ohos_note"] = entry["ohos_note"]
    base["evidence"] = (base.get("evidence", [])
                        + [e for e in entry.get("evidence", [])
                           if e not in base.get("evidence", [])])
    base_art = base.get("artifact") or {}
    ent_art = entry.get("artifact") or {}
    if ent_art.get("ready") and not base_art.get("ready"):
        # base 无产物而 entry 解析到有产物的节点（如 vcpkg 名未解析而
        # find_package 名解析到 bottle）：采用 entry 的解析结果
        for f in ("resolved_node", "port_status", "available_version",
                  "artifact"):
            if entry.get(f) is not None:
                base[f] = entry[f]


class _DepBook:
    """同名依赖的多源证据合并（find_package/pkg/conan/include/qmake）。"""

    def __init__(self):
        self.by_name: Dict[str, Dict] = {}

    def add(self, name: str, kind: str = "package", required: bool = True,
            min_version: str = None, version_req: str = None,
            version_range: str = None, components: List[str] = None,
            evidence: str = None) -> Dict:
        key = name.lower()
        entry = self.by_name.get(key)
        if entry is None:
            entry = {"name": name, "kind": kind, "required": required,
                     "min_version": min_version, "version_req": version_req,
                     "version_range": version_range,
                     "components": components or [], "evidence": []}
            self.by_name[key] = entry
        else:
            # REQUIRED 优先于 optional；版本信息取最先出现的明确值
            if required:
                entry["required"] = True
            entry["min_version"] = entry["min_version"] or min_version
            entry["version_req"] = entry["version_req"] or version_req
            entry["version_range"] = entry["version_range"] or version_range
            if components:
                for c in components:
                    if c not in entry["components"]:
                        entry["components"].append(c)
        if evidence and evidence not in entry["evidence"]:
            entry["evidence"].append(evidence)
        return entry

    def values(self) -> List[Dict]:
        return sorted(self.by_name.values(), key=lambda d: d["name"].lower())


def analyze_dependencies(conn, root, info: Dict = None) -> Dict:
    """生成综合依赖分析报告。conn 可为 None（纯扫描，无产物解析）。"""
    root = Path(root).resolve()
    info = info or qt_scanner.scan_project(root)
    version = project_scanner._detect_version(root)

    fp_details = info.get("find_package_details", [])
    pkg_manifests = info.get("pkg_manifests", {})
    cmake_packages = info.get("cmake_packages", {})

    # ---- Qt 版本要求（find_package(Qt5 5.15 ...) 声明 / .pro 文件推断）
    qt_min = None
    qt_optional_modules = set()
    for fp in fp_details:
        if re.fullmatch(r"qt\d", fp["name_lower"]):
            if fp["version"]:
                qt_min = fp["version"] if qt_min is None else max(
                    qt_min, fp["version"], key=_ver_key)
            for c in fp.get("optional_components") or []:
                qt_optional_modules.add(c.lower())
    qt_major = info.get("qt_version_hint")

    # ---- 分类桶
    link = _DepBook()
    test_deps: List[Dict] = []
    build_tools: List[Dict] = []
    warnings: List[Dict] = []

    # ---- 1) find_package 明细
    for fp in fp_details:
        name = fp["name_lower"]
        ev = "find_package(%s%s%s) %s:%d" % (
            fp["name"], " %s" % fp["version"] if fp["version"] else "",
            " REQUIRED" if fp["required"] else "", fp["file"], fp["line"])
        if name.startswith("qt") or name.startswith("kf"):
            continue  # Qt 模块/KF 组件单独处理
        if name in TEST_FRAMEWORKS:
            test_deps.append({"name": fp["name"], "source": ev,
                              "note": "测试框架，不进发行包"})
            continue
        if name in CMAKE_BUILTIN_PACKAGES:
            spec = CMAKE_BUILTIN_PACKAGES[name]
            if spec["kind"] == "build-tool":
                build_tools.append({"tool": name, "how": [ev],
                                    "note": spec["note"],
                                    "provided_by": "host"})
            else:
                e = link.add(fp["name"], kind=spec["kind"],
                             required=fp["required"], evidence=ev)
                e["ohos_note"] = spec["note"]
            continue
        if name in BUILD_TOOL_FINDPKG:
            build_tools.append({"tool": name, "how": [ev],
                                "note": BUILD_TOOL_FINDPKG[name],
                                "provided_by": "qt-sdk"
                                if name == "linguisttools" else "host"})
            continue
        if name in INTERFACE_BOUND_PACKAGES:
            plat = fp.get("platform")
            e = link.add(fp["name"], kind="platform-iface",
                         required=(fp["required"] and not fp.get("optional")
                                   and not plat),
                         evidence=ev)
            e["ohos_note"] = INTERFACE_BOUND_PACKAGES[name]
            if fp.get("optional"):
                e["note"] = ("CMake 选项守卫（默认 OFF）："
                              "默认构建不含此依赖")
            elif plat:
                e["note"] = ("位于 if(%s) 平台块：仅该平台构建，"
                              "鸿蒙构建不含" % plat)
            continue
        # 同库异名归并：find_package 名按别名表改写（KDcrawQt6→kdcraw、
        # QuaZip-Qt→quazip），使无包源时与 pkg-config/裸链接声明合为一条
        aliased = LIB_NAME_ALIASES.get(name)
        entry = link.add(aliased or fp["name"],
                         required=(fp["required"] and not fp.get("optional")
                                   and not fp.get("platform")),
                         min_version=fp["version"],
                         components=(fp["components"]
                                     + fp["optional_components"]) or None,
                         evidence=ev)
        if fp.get("optional"):
            entry["note"] = ("CMake 选项守卫（默认 OFF）："
                              "默认构建不含此依赖")
        elif fp.get("platform"):
            entry["note"] = ("位于 if(%s) 平台块：仅该平台构建，"
                              "鸿蒙构建不含" % fp["platform"])
        if aliased:
            entry.setdefault("ohos_note",
                             "find_package 名 %s 归并为包 %s"
                             % (fp["name"], aliased))
        if fp["exact"]:
            entry["version_req"] = "== %s" % fp["version"]

    # ---- 2) pkg_check_modules（含版本约束）
    for pm in cmake_packages.get("pkg_modules", []):
        ev = "pkg_check_modules(%s%s)" % (
            pm["name"], " %s" % pm["version_req"] if pm["version_req"] else "")
        if pm["name"] in TEST_FRAMEWORKS:
            test_deps.append({"name": pm["name"], "source": ev,
                              "note": "测试框架，不进发行包"})
            continue
        if pm["name"] in INTERFACE_BOUND_PACKAGES:
            e = link.add(pm["name"], kind="platform-iface",
                         required=(not pm.get("optional")
                                   and not pm.get("platform")), evidence=ev)
            e["ohos_note"] = INTERFACE_BOUND_PACKAGES[pm["name"]]
            if pm.get("optional"):
                e["note"] = ("CMake 选项守卫（默认 OFF）："
                              "默认构建不含此依赖")
            elif pm.get("platform"):
                e["note"] = ("位于 if(%s) 平台块：仅该平台构建，"
                              "鸿蒙构建不含" % pm["platform"])
            continue
        # 同库双声明（pkg-config 名 vs find_package 名）按别名合并。
        # 版本约束挂在被归并的原名下（version_req_from）：libavcodec 的
        # “>= 58”是库主版本口径，与 ffmpeg 包版本不可直接比较。
        aliased = LIB_NAME_ALIASES.get(pm["name"], pm["name"])
        e = link.add(aliased, version_req=pm["version_req"], evidence=ev,
                     required=(not pm.get("optional")
                               and not pm.get("platform")))
        if pm.get("optional"):
            e["note"] = "CMake 选项守卫（默认 OFF）：默认构建不含此依赖"
        elif pm.get("platform"):
            e["note"] = ("位于 if(%s) 平台块：仅该平台构建，"
                          "鸿蒙构建不含" % pm["platform"])
        if pm["version_req"] and aliased != pm["name"]:
            e["version_req_from"] = pm["name"]

    # ---- 3) Conan / vcpkg 清单（版本可为范围串）
    for c in pkg_manifests.get("conan", []):
        link.add(c["name"], version_range=c.get("version"),
                 evidence="conan: %s/%s" % (c["name"], c.get("version") or "*"))
    for v in pkg_manifests.get("vcpkg", []):
        link.add(v["name"], min_version=v.get("version"),
                 evidence="vcpkg.json: %s" % v["name"]
                 + (" (>= %s)" % v["version"] if v.get("version") else ""))

    # ---- 4) 源码直接 #include 第三方库头文件（zlib/openssl/boost 等 16 类，
    #          构建文件未声明时的隐性依赖来源）
    for h in info.get("third_party_hints", []):
        link.add(h["name"], required=False,
                 evidence="include: %s" % h["evidence"][0]
                 if h.get("evidence") else "include")

    # ---- 5) qmake LIBS += -lfoo
    for ql in info.get("qmake_libs", []):
        n = ql["name"]
        if n in OHOS_SYSTEM_LIBS:
            ev = "qmake LIBS -l%s（%s）" % (n, OHOS_SYSTEM_LIBS[n])
            e = link.add(n, kind="system-lib", evidence=ev)
            e["ohos_note"] = OHOS_SYSTEM_LIBS[n]
        elif n in WIN32_SYSTEM_LIBS:
            e = link.add(n, kind="win32-system-lib", required=False,
                         evidence="qmake LIBS -l%s" % n)
            e["ohos_note"] = "Windows 系统库：通常位于 win32 平台块，鸿蒙不适用"
        else:
            aliased = LIB_NAME_ALIASES.get(n.lower())
            e = link.add(aliased or n,
                         evidence="qmake LIBS -l%s (%s)" % (
                             n, ql["evidence"][0] if ql.get("evidence") else "?"))
            if aliased:
                e.setdefault("ohos_note", "链接名 %s 归并为包 %s" % (n, aliased))

    # ---- 6) KDE Frameworks 组件（link，framework 类）
    for comp in info.get("kf_components", []):
        deps = kb_seed.KF_DEPS.get(comp)
        note = None
        if deps:
            note = "依赖 Qt 模块: %s" % ", ".join(deps.get("qt", []))
            if deps.get("ifaces"):
                note += "；绑定平台接口: %s" % ", ".join(deps["ifaces"])
        e = link.add(comp, kind="framework", evidence="find_package(KF* %s)" % comp)
        if note:
            e["ohos_note"] = "KDE Frameworks 组件，需源码交叉编译；" + note

    # ---- 6b) 裸链接名（target_link_libraries / find_library /
    #          cc.find_library / AC_CHECK_LIB）：不经 find_package 的直接链接
    for rl in info.get("raw_libs", []):
        n = rl["name"]
        ev = "%s (%s)" % ("+".join(rl.get("hows", [])),
                          rl["evidence"][0] if rl.get("evidence") else "?")
        plat = rl.get("platform_block")
        if n.lower() in TEST_FRAMEWORKS:
            # target_link_libraries 裸名命中测试框架（如 gen_f 的
            # gtest_main）：归入 test 而非 need_port 的 link
            test_deps.append({"name": n, "source": ev,
                              "note": "测试框架，不进发行包"})
            continue
        if n.lower() in OHOS_SYSTEM_LIBS:
            e = link.add(n, kind="system-lib",
                         required=not plat, evidence=ev)
            e["ohos_note"] = OHOS_SYSTEM_LIBS[n.lower()]
        elif n.lower() in WIN32_SYSTEM_LIBS:
            e = link.add(n, kind="win32-system-lib", required=False, evidence=ev)
            e["ohos_note"] = "Windows 系统库：通常位于 win32 平台块，鸿蒙不适用"
        elif n.lower() in INTERFACE_BOUND_PACKAGES:
            existed = (n.lower() in link.by_name)
            e = link.add(n, kind="platform-iface", required=not plat,
                         evidence=ev)
            e["ohos_note"] = INTERFACE_BOUND_PACKAGES[n.lower()]
            if plat and not existed:
                e["note"] = ("位于 if(%s) 平台块：仅该平台构建，"
                              "鸿蒙构建不含" % plat)
        else:
            aliased = LIB_NAME_ALIASES.get(n.lower())
            existed = ((aliased or n).lower() in link.by_name)
            e = link.add(aliased or n, required=not plat, evidence=ev)
            if rl.get("ext_target"):
                e.setdefault(
                    "ohos_note",
                    "external_* 导入目标链接（find_package 声明位于外部"
                    "构建模块/未初始化子模块，如 cmake_helpers），"
                    "产物获取途径取决于名称匹配结果")
            else:
                e.setdefault("ohos_note",
                             "裸链接名（未用 find_package/pkg-config 声明），"
                             "产物获取途径取决于名称匹配结果")
            if plat and not existed:
                # 仅当此条目由平台块内的裸链接声明创建时标注；已存在的
                # 条目（find_package 必需声明等）required 语义由合并规则
                # 保护（REQUIRED 优先，不会被此处降级）
                e["note"] = ("位于 if(%s) 平台块：仅该平台构建，"
                              "鸿蒙构建不含" % plat)

    # ---- 6c) macOS 框架（-framework X）
    for fw in info.get("macos_frameworks", []):
        e = link.add(fw["name"], kind="platform-iface", required=False,
                     evidence="-framework %s (%s)" % (
                         fw["name"], fw["evidence"][0] if fw.get("evidence") else "?"))
        e["ohos_note"] = "macOS 框架：位于 APPLE 平台块，鸿蒙不适用"

    # ---- 6d) qmake PKGCONFIG +=
    for pc in info.get("qmake_pkgconfig", []):
        link.add(pc["name"],
                 evidence="qmake PKGCONFIG += %s (%s)" % (
                     pc["name"], pc["evidence"][0] if pc.get("evidence") else "?"))

    # ---- 6e) meson dependency('name', version: ...)
    for md in info.get("meson_deps", []):
        n = md["name"]
        if n.lower() in CMAKE_BUILTIN_PACKAGES:
            spec = CMAKE_BUILTIN_PACKAGES[n.lower()]
            e = link.add(n, kind=spec["kind"],
                         required=md.get("required", True),
                         evidence="meson dependency('%s') %s" % (
                             n, md["evidence"][0] if md.get("evidence") else ""))
            e["ohos_note"] = spec["note"]
            continue
        if n.lower() in INTERFACE_BOUND_PACKAGES:
            e = link.add(n, kind="platform-iface", required=md.get("required", True),
                         evidence="meson dependency('%s') %s" % (
                             n, md["evidence"][0] if md.get("evidence") else ""))
            e["ohos_note"] = INTERFACE_BOUND_PACKAGES[n.lower()]
        else:
            link.add(n, required=md.get("required", True),
                     version_req=md.get("version"),
                     evidence="meson dependency('%s'%s) %s" % (
                         n, " %s" % md["version"] if md.get("version") else "",
                         md["evidence"][0] if md.get("evidence") else ""))

    # ---- 6f) autotools PKG_CHECK_MODULES（含版本约束）
    for ad in info.get("autotools_deps", []):
        n = ad["name"]
        if n.lower() in INTERFACE_BOUND_PACKAGES:
            e = link.add(n, kind="platform-iface",
                         evidence="PKG_CHECK_MODULES %s" % n)
            e["ohos_note"] = INTERFACE_BOUND_PACKAGES[n.lower()]
        else:
            link.add(n, version_req=ad.get("version_req"),
                     evidence="PKG_CHECK_MODULES(%s%s) %s" % (
                         n, " %s" % ad["version_req"] if ad.get("version_req") else "",
                         ad["evidence"][0] if ad.get("evidence") else ""))

    # ---- 6g) 自定义包装函数声明（如 gen_n search_dependency 的
    #          PACKAGE <pkg-config 名> [LIBRARY x] [MINIMUM_VERSION v]）
    for wd in info.get("wrapper_deps", []):
        n = wd["name"]
        ev = "%s(PACKAGE %s%s%s)" % (
            wd.get("wrapper", "wrapper"), n,
            " %s" % wd["version"] if wd.get("version") else "",
            " %s" % wd["evidence"][0] if wd.get("evidence") else "")
        if n.lower() in INTERFACE_BOUND_PACKAGES:
            e = link.add(n, kind="platform-iface", evidence=ev)
            e["ohos_note"] = INTERFACE_BOUND_PACKAGES[n.lower()]
            continue
        aliased = LIB_NAME_ALIASES.get(n.lower())
        e = link.add(aliased or n,
                     version_req=(">= %s" % wd["version"]) if wd.get("version")
                     else None,
                     evidence=ev)
        if aliased:
            e.setdefault("ohos_note", "包装声明 %s 归并为包 %s" % (n, aliased))

    # ---- 6h) 依赖清单函数（corpus_b_deps 引擎等）：require_dep / require_source_dep /
    #          require_tool。link → 常规 link 依赖；source → vendored；tool → 工具链
    manifest_vendored: List[Dict] = []
    for md in info.get("manifest_deps", []):
        n = md["name"]
        ev = "require_dep 系清单声明 %s (%s)" % (
            n, md["evidence"][0] if md.get("evidence") else "?")
        if md.get("conditional"):
            ev += " [条件块 if(%s)，默认构建未必启用]" % (md.get("condition") or "?")
        if md["mode"] == "tool":
            build_tools.append({"tool": n, "how": [ev],
                                "note": "依赖清单声明的主机构建工具"
                                        "（require_tool），构建机安装即可",
                                "provided_by": "host"})
        elif md["mode"] == "source":
            manifest_vendored.append({"name": n, "path": None, "url": None,
                                      "note": "require_source_dep：源码自带，"
                                              "随项目一起编译"})
        else:
            e = link.add(n, required=not md.get("conditional"), evidence=ev)
            if md.get("conditional"):
                e.setdefault("ohos_note",
                             "条件块 if(%s) 内声明，默认构建未必启用"
                             % (md.get("condition") or "?"))

    # ---- 7) 解析产物 + 版本检查 + 传递 runtime
    runtime_book: Dict[str, Dict] = {}
    graph_cache = _GraphCache(conn) if conn is not None else None
    resolve_cache: Dict[str, Optional[Dict]] = {}
    in_tree_index: Optional[Dict[str, str]] = None   # 惰性构建
    vendored_decls = _vendored_declarations(info)
    link_list = link.values()
    for entry in link_list:
        skip_resolve = entry["kind"] in ("system-lib", "win32-system-lib",
                                         "platform-iface")
        if entry["kind"] == "framework":
            # KF 组件不能走包名解析阶梯：组件名与无关 C 库同名异义
            # （KF Archive ≠ libarchive、KF Config ≠ libconfig，gen_b/
            # gen_c 实证曾误展示 ready bottle 与闭包 need_port 矛盾）。
            # 解析到扫描入库的 kf:<comp> 节点（port_status=unknown →
            # 需源码交叉编译，与 fetch-deps 闭包口径一致）。
            node = (db.get_node(conn, "kf:%s" % entry["name"].lower())
                    if conn is not None else None)
        else:
            node = None if skip_resolve else _resolve(conn, entry["name"],
                                                      resolve_cache)
        entry["resolved_node"] = node["id"] if node else None
        entry["_resolved_name"] = node["name"] if node else None
        entry["port_status"] = node["port_status"] if node else None
        entry["available_version"] = node["version"] if node else None
        entry["artifact"] = _artifact_of(node)
        # 未解析且项目内存在同名源码目录：自带源码随项目编译，
        # 不是外部 need_port 缺口（fakevim/litehtml/botan 实证）
        if (node is None and entry["kind"] == "package" and root
                and Path(root).is_dir()):
            if in_tree_index is None:
                in_tree_index = _in_tree_dir_index(Path(root))
            hit = _match_in_tree_dir(in_tree_index, entry["name"])
            if hit:
                entry["kind"] = "in-tree"
                entry["artifact"] = {"ready": True, "provided": True,
                                     "source": "in-tree:%s" % hit}
                entry["ohos_note"] = ("项目内自带源码目录（%s）：随项目"
                                      "编译，无需外部产物" % hit)
        # 未解析且命中项目自带源码声明（git 子模块 / CPM-FetchContent
        # / meson 子项目与内部目标）：源码随项目，不是外部 need_port
        # 缺口（corpus_a kcoreaddons、gen_i QSimpleUpdater、
        # gen_j rz_*/zydis 实证）
        if node is None and entry["kind"] == "package" and vendored_decls:
            hit = next((vendored_decls[f]
                        for f in _loose_folds(entry["name"])
                        if f in vendored_decls), None)
            if hit:
                label, detail = hit
                entry["kind"] = "in-tree"
                entry["artifact"] = {"ready": True, "provided": True,
                                     "source": "%s:%s" % (label, detail)}
                entry["ohos_note"] = (
                    "%s（%s）：源码随项目编译，无需外部产物" % (label, detail))
        # 已解析到鸿蒙产物、但项目同时自带该库源码：bottle 为备选
        if (node is not None and entry["kind"] == "package"
                and vendored_decls):
            hit = next((vendored_decls[f]
                        for f in _loose_folds(entry["name"])
                        if f in vendored_decls), None)
            if hit:
                label, detail = hit
                entry["ohos_note"] = ((entry.get("ohos_note") or "")
                                      + "；项目自带该库源码（%s %s），"
                                        "可随项目编译，bottle 为备选"
                                        % (label, detail)).lstrip("；")
        if entry["kind"] == "system-lib":
            entry["artifact"] = entry["artifact"] or {
                "ready": True, "provided": True, "source": "ohos-system"}
        # 版本要求校验（见 _version_check）
        entry["version_check"] = _version_check(entry)
        if conn is not None and node is not None and node["id"].startswith(("hb:", "cmdpkgs:")):
            for trans in _runtime_closure(conn, node["id"], graph_cache):
                r = runtime_book.get(trans["name"].lower())
                if r is None:
                    r = {"name": trans["name"], "kind": trans["kind"],
                         "version": trans.get("version"),
                         "port_status": trans.get("port_status"),
                         "artifact": _artifact_of(trans),
                         "needed_by": []}
                    runtime_book[trans["name"].lower()] = r
                if entry["name"].lower() not in r["needed_by"]:
                    r["needed_by"].append(entry["name"].lower())

    # ---- 7b) 同库异名合并：先按 resolved_node（如 xkbcommon/libxkbcommon），
    #          再按解析节点的规范化名（去 lib 前缀/@变体，如 hb:qrencode 与
    #          cmdpkgs:libqrencode 同为 qrencode，避免同一库出现多条矛盾条目）
    def _canon_pkg_name(n: str) -> str:
        n = (n or "").lower()
        if n.startswith("lib"):
            n = n[3:]
        at = n.find("@")
        return n[:at] if at > 0 else n

    def _dashless_merge_key(name: str) -> Optional[str]:
        """去分隔符合并键（libtorrent-rasterbar → libtorrentrasterbar）。

        仅限无空白的单词名（含空白的 KF 节点名如 "KF archive" 不适用，
        否则全部 KF 组件会同键误并）且键长 ≥ 6（与
        kb_seed.resolve_package_dashless 的碰撞防护一致）；名字本身
        无分隔符时键即 name.lower()，无需额外键（压平名条目的普通键
        天然与带分隔符条目的去分隔符键碰撞 → 合并）。
        """
        if not re.fullmatch(r"[A-Za-z0-9@+_.-]+", name or ""):
            return None
        key = kb_seed._dashless_key(name)
        if len(key) < 6 or key == name.lower():
            return None
        return key

    by_key: Dict[str, Dict] = {}
    for entry in link_list:
        keys = []
        if entry.get("resolved_node"):
            keys.append(entry["resolved_node"])
            if entry.get("_resolved_name"):
                keys.append(_canon_pkg_name(entry["_resolved_name"]))
        else:
            keys.append(entry["name"].lower())
        # 同库异名（压平名 vs 连字符名）凭去分隔符键合并——与扫描期
        # project_scanner._link_third_party 的分组策略对齐，避免 deps
        # 表对同一未解析库双计（两条“需源码交叉编译”警告）
        dk = _dashless_merge_key(entry["name"])
        if dk:
            keys.append(dk)
        for key in keys:
            base = by_key.get(key)
            if base is not None and base is not entry:
                _merge_link_entries(base, entry)
                break
        else:
            for key in keys:
                by_key[key] = entry
            continue
    merged_ids = set()
    for base in by_key.values():
        merged_ids.add(id(base))
    link_list = sorted((e for e in link_list if id(e) in merged_ids),
                       key=lambda d: d["name"].lower())
    for entry in link_list:
        entry.pop("_resolved_name", None)
        # 合并可能改变了版本字段，重算校验
        entry["version_check"] = _version_check(entry)

    # ---- 8) dlopen/QLibrary/QPluginLoader 运行时动态加载
    dynamic_loads = []
    for dl in info.get("dynamic_loads", []):
        raw = dl["name"]
        cand = re.sub(r"^lib", "", re.sub(r"\.(so|dll|dylib).*$", "", raw))
        node = (_resolve(conn, cand, resolve_cache)
                or _resolve(conn, raw, resolve_cache))
        dynamic_loads.append({
            "name": raw, "resolved_node": node["id"] if node else None,
            "artifact": _artifact_of(node),
            "how": dl["how"],
            "note": (None if node else
                     "运行时加载目标未匹配到已知包：若非 Qt 插件需确认来源"),
        })
        if node is None and not raw.startswith(("platform", "imageformats",
                                                "iconengines", "codecs",
                                                "styles", "sqldrivers")):
            warnings.append({
                "level": "warn",
                "msg": "动态加载 %s（%s）未匹配到已知包；Qt 自带插件"
                       "（platform/styles 等）随 Qt SDK 部署，其余需确认"
                       % (raw, dl["how"][0])})

    # ---- 9) Qt 模块（provided，随 Qt SDK）
    qt_modules = []
    resolve_cache: Dict = {}
    for mod in info.get("qt_modules", []):
        node = (project_scanner._resolve_qtmod(conn, mod, _cache=resolve_cache)
                if conn is not None else None)
        qt_modules.append({
            "module": mod, "node": node["id"] if node else None,
            "status": node["port_status"] if node else "unknown",
            "required": mod not in qt_optional_modules,
        })

    # ---- 10) 工具链
    toolchain_info = info.get("toolchain", {})
    meson_info = info.get("meson", {})
    tools = []
    for tool, hows in sorted(toolchain_info.get("tools", {}).items()):
        tools.append({"tool": tool, "how": hows[:3],
                      "provided_by": ("qt-sdk" if tool in QT_TOOL_NAMES
                                      else "host")})
    # find_package 命中的构建工具包（ecm/gettext/doxygen 等）并入工具链
    for bt in build_tools:
        tools.append({"tool": bt["tool"], "how": bt["how"],
                      "provided_by": bt["provided_by"],
                      "note": bt["note"]})
    cxx_std = toolchain_info.get("cxx_standard")
    if meson_info.get("cxx_standard"):
        cxx_std = max(cxx_std or 0, meson_info["cxx_standard"])
    if meson_info.get("version_min"):
        tools.append({"tool": "meson", "how": [">= %s（meson_version）"
                                               % meson_info["version_min"]],
                      "provided_by": "host"})
    toolchain = {
        "cmake_min": toolchain_info.get("cmake_min"),
        "cxx_standard": cxx_std,
        "compiler": "OHOS NDK clang（HarmonyOS SDK 自带）",
        "cxx_note": (
            "OHOS NDK clang 支持 C++17；C++20 特性覆盖需按 SDK 版本确认"
            if cxx_std and cxx_std >= 20 else
            ("C++%d：OHOS NDK clang 支持" % cxx_std if cxx_std else None)),
        "tools": tools,
        "has_testing": toolchain_info.get("has_testing", False),
        "note": "构建工具只需在构建机可用（Windows/Linux/macOS 均可），"
                "不部署到设备；Qt 工具（moc/uic/rcc）随 Qt SDK 自动调用",
    }

    # ---- 11) vendored（submodule / vendored 目录 / FetchContent 等配置期拉取）
    vendored = [{"name": gm.get("name") or gm.get("path"),
                 "path": gm.get("path"), "url": gm.get("url"),
                 "note": "submodule：随项目编译，锁定提交在仓库内"}
                for gm in info.get("git_submodules", [])]
    vendored.extend({"name": d, "path": d, "url": None,
                     "note": "vendored 目录：随项目一起编译"}
                    for d in info.get("vendored_dirs", []))
    vendored.extend({"name": fd["name"], "path": None, "url": fd.get("url"),
                     "tag": fd.get("tag"),
                     "note": "%s：configure 阶段拉取源码随项目编译%s" % (
                         fd["how"],
                         "，锁定 %s" % fd["tag"] if fd.get("tag") else "")}
                    for fd in info.get("fetched_deps", []))
    vendored.extend({"name": sp, "path": "subprojects/%s" % sp, "url": None,
                     "note": "meson subproject：随项目一起编译"}
                    for sp in meson_info.get("subprojects", []))
    # require_source_dep 声明的源码自带依赖（去重后并入）
    vendored_names = {v["name"].lower() for v in vendored}
    vendored.extend(v for v in manifest_vendored
                    if v["name"].lower() not in vendored_names)

    # ---- 11b) 环境依赖（CI / 安装脚本 apt/brew/pacman install 清单）
    env_deps = []
    for env in info.get("env_installs", []):
        raw_name = env["name"]
        # 发行版包名 → 库名近似（libfoo-dev → foo）
        cand = re.sub(r"-dev$", "", raw_name)
        if cand.startswith("lib") and len(cand) > 3:
            cand = cand[3:]
        node = (_resolve(conn, cand, resolve_cache)
                or _resolve(conn, raw_name, resolve_cache))
        env_deps.append({
            "name": raw_name, "resolved_node": node["id"] if node else None,
            "available_version": node["version"] if node else None,
            "evidence": env.get("evidence", [])[:2]})

    # ---- 12) Qt 版本校验
    qt_check = None
    if qt_major:
        avail = QT_OHOS_AVAILABLE.get(str(qt_major))
        if avail:
            best = max(avail, key=_ver_key)
            qt_check = _check_min(qt_min, best)
        else:
            qt_check = "unknown"

    # ---- 13) 汇总与警告
    for entry in link_list:
        if entry.get("version_req_from"):
            warnings.append({
                "level": "info",
                "msg": "%s 的版本约束 %s 来自 %s 的库版本口径（别名归并），"
                       "与 %s 包版本（%s）不可直接比较，需人工确认"
                       % (entry["name"], entry.get("version_req"),
                          entry["version_req_from"], entry["name"],
                          entry.get("available_version") or "?")})
    for entry in link_list:
        if entry["kind"] in ("system-lib", "win32-system-lib"):
            continue
        if entry.get("version_check") == "conflict":
            wants = []
            if entry.get("version_range"):
                wants.append("[%s]" % entry["version_range"])
            if entry.get("version_req"):
                wants.append(entry["version_req"])
            if entry.get("min_version"):
                wants.append(">= %s" % entry["min_version"])
            warnings.append({
                "level": "warn",
                "msg": "%s 版本冲突：要求 %s，鸿蒙产物为 %s"
                       % (entry["name"], " 且 ".join(wants),
                          entry.get("available_version") or "?")})
        elif entry["kind"] == "platform-iface":
            if entry["required"]:
                warnings.append({
                    "level": "warn",
                    "msg": "%s 直连平台栈：%s"
                           % (entry["name"],
                              entry.get("ohos_note") or "鸿蒙不支持")})
        elif not (entry.get("artifact") or {}).get("ready") and entry["required"]:
            warnings.append({
                "level": "warn" if entry["kind"] == "package" else "info",
                "msg": "%s 无鸿蒙预编译产物（required=%s）：需源码交叉编译%s"
                       % (entry["name"], entry["required"],
                          "，源码: %s" % (entry["artifact"] or {}).get("repo_url")
                          if (entry["artifact"] or {}).get("repo_url") else "")})
    if info.get("build_system") == "qmake":
        warnings.append({
            "level": "info",
            "msg": "qmake 工程交叉编译需自定义 mkspec（参考 KB: QScintilla 案例）"})
    if qt_check == "conflict":
        warnings.append({
            "level": "warn",
            "msg": "Qt 版本要求 %s 高于 Qt for HarmonyOS 可用版本（%s）"
                   % (qt_min, "/".join(QT_OHOS_AVAILABLE.get(str(qt_major), ())))})

    # ---- 13b) 环境清单交叉核对：CI 安装但构建文件未声明的库名（潜在漏检）
    link_names = {e["name"].lower() for e in link_list}
    link_names.update(m["module"] for m in qt_modules)
    for ed in env_deps:
        cand = re.sub(r"-dev$", "", ed["name"].lower())
        if cand.startswith("lib") and len(cand) > 3:
            cand = cand[3:]
        if (ed["resolved_node"] is None and cand
                and cand not in link_names
                and not cand.startswith(("qt", "kf", "lxqt", "build-essential"))
                and cand not in {"meson", "ninja", "cmake", "git", "g++",
                                 "gcc", "pkg-config", "gettext", "ccache",
                                 "create-dmg", "flatpak", "flatpak-builder",
                                 "fakeroot", "devscripts", "debhelper",
                                 "asciidoctor", "python3"}):
            warnings.append({
                "level": "info",
                "msg": "CI 脚本安装了 %s 但构建文件未声明：可能经变量引用/自"
                       "定义 Find 模块引入（补查），或仅为构建机工具"
                       % ed["name"]})

    report = {
        "project": {
            "name": info["name"], "root": str(root),
            "build_system": info["build_system"], "version": version,
            "sources": len(info["sources"]),
        },
        "qt": {
            "major": qt_major, "min_version": qt_min,
            "check": qt_check,
            "available_on_ohos": list(QT_OHOS_AVAILABLE.get(str(qt_major), []))
            if qt_major else [],
            "modules": qt_modules,
            "kf_components": info.get("kf_components", []),
            "note": "Qt 模块由 Qt for HarmonyOS SDK 提供，"
                    "harmonydeployqt 负责部署",
        },
        "toolchain": toolchain,
        "link_deps": link_list,
        "runtime_deps": list(runtime_book.values()),
        "dynamic_loads": dynamic_loads,
        "test_deps": test_deps,
        "vendored": vendored,
        "env_deps": env_deps,
        "counts": {
            "link": len(link_list),
            "runtime": len(runtime_book),
            "dynamic_loads": len(dynamic_loads),
            # 与文本报告一致：tools 列表 + CMake 最低版本/C++ 标准/编译器
            # 三个固定行（此前按 len(build_tools)+len(tools) 计，tools 已含
            # build_tools 条目，存在重复计数且漏掉固定行）
            "build_tools": (len(toolchain["tools"])
                            + (1 if toolchain["cmake_min"] else 0)
                            + (1 if toolchain["cxx_standard"] else 0)
                            + 1),
            "test": len(test_deps),
            "vendored": len(vendored),
            "env": len(env_deps),
            "qt_modules": len(qt_modules),
        },
        "warnings": warnings,
    }
    return report


def _range_to_req(range_str: Optional[str]) -> Optional[str]:
    """conan 范围串 '[>=1.2 <2]' → 取第一个 '>=x' 约束（近似检查）。"""
    if not range_str:
        return None
    m = re.search(r">=\s*([\w.]+)", range_str)
    return ">= %s" % m.group(1) if m else None


# ---------------------------------------------------------------- 渲染

def render_text(report: Dict) -> str:
    """人读摘要。"""
    p = report["project"]
    q = report["qt"]
    t = report["toolchain"]
    lines: List[str] = []
    lines.append("=== 依赖分析: %s%s ===" % (
        p["name"], " v%s" % p["version"] if p["version"] else ""))
    lines.append("构建系统: %s | 源文件 %d 个" % (p["build_system"], p["sources"]))
    if q.get("major"):
        check = {"satisfied": "✓ 满足", "conflict": "✗ 冲突",
                 "unknown": "? 未知"}.get(q.get("check"), "")
        lines.append("Qt: %s%s | 鸿蒙可用: %s %s" % (
            q["major"], " (>= %s)" % q["min_version"] if q.get("min_version") else "",
            "/".join(q.get("available_on_ohos") or ["?"]), check))
    blocked_qt = [m["module"] for m in q["modules"] if m["status"] == "blocked"]
    if blocked_qt:
        lines.append("Qt 阻塞模块: %s" % ", ".join(blocked_qt))

    def _ver(e):
        parts = []
        if e.get("min_version"):
            parts.append(">= %s" % e["min_version"])
        if e.get("version_req"):
            parts.append(e["version_req"])
        if e.get("version_range"):
            parts.append("[%s]" % e["version_range"])
        return " ".join(parts)

    def _art(e):
        a = e.get("artifact") or {}
        if e.get("kind") == "system-lib":
            return "系统自带"
        if e.get("kind") == "win32-system-lib":
            return "Windows 系统库（鸿蒙不适用）"
        if e.get("kind") == "platform-iface":
            return "平台接口（鸿蒙不支持直连）"
        if a.get("ready"):
            return "产物: %s" % a.get("source")
        if a.get("provided"):
            return "框架提供"
        return "无产物 → 需源码编译"

    # 分组排序：真正的外部包优先，其后 framework/系统库/平台接口
    _kind_rank = {"package": 0, "framework": 1, "system-lib": 2,
                  "win32-system-lib": 3, "platform-iface": 4,
                  "in-tree": 5}
    lines.append("")
    lines.append("── 编译产物依赖 (link) %d 个：目标侧 headers+libs，"
                 "交叉编译/链接时必须存在 ──" % len(report["link_deps"]))
    for e in sorted(report["link_deps"],
                    key=lambda d: (_kind_rank.get(d.get("kind"), 0),
                                   d["name"].lower())):
        req = "" if e["required"] else " [optional]"
        vc = {"satisfied": " ✓", "conflict": " ✗版本冲突",
              "unknown": ""}.get(e.get("version_check"), "")
        lines.append("  • %s %s%s%s (%s)"
                     % (e["name"], _ver(e), req, vc, e["kind"]))
        lines.append("      %s" % _art(e))
        if e.get("available_version"):
            lines.append("      鸿蒙版本: %s%s" % (
                e["available_version"],
                "" if e.get("version_check") != "conflict" else "（低于要求）"))
        if e.get("evidence"):
            lines.append("      证据: %s" % e["evidence"][0])
        if e.get("ohos_note"):
            lines.append("      注: %s" % e["ohos_note"])

    lines.append("")
    lines.append("── 编译器/工具链依赖 (build-tool) %d 个：构建机运行，"
                 "不部署到设备 ──" % report["counts"]["build_tools"])
    if t.get("cmake_min"):
        lines.append("  • CMake >= %s（cmake_minimum_required）" % t["cmake_min"])
    if t.get("cxx_standard"):
        lines.append("  • C++%d（%s）" % (t["cxx_standard"], t["cxx_note"] or ""))
    lines.append("  • 编译器: %s" % t["compiler"])
    for tool in t.get("tools", []):
        lines.append("  • %s（%s）" % (tool["tool"],
                                      "Qt SDK 提供" if tool["provided_by"] == "qt-sdk"
                                      else "构建机准备: " + tool["how"][0]))

    rt = report["runtime_deps"]
    lines.append("")
    lines.append("── 运行时依赖 (runtime) %d 个：设备侧 .so，"
                 "部署到 entry/libs/arm64-v8a/ ──" % len(rt))
    for e in rt[:40]:
        a = e.get("artifact") or {}
        src = ("产物: %s" % a["source"] if a.get("ready")
               else "无产物 → 需随其来源一起源码编译")
        lines.append("  • %s v%s — %s（传递自 %s）"
                     % (e["name"], e.get("version") or "?", src,
                        ", ".join(e.get("needed_by", [])[:3])))
    if len(rt) > 40:
        lines.append("  … 另有 %d 个传递依赖" % (len(rt) - 40))
    for dl in report["dynamic_loads"]:
        lines.append("  • [动态加载] %s（%s）%s" % (
            dl["name"], dl["how"][0],
            "→ " + (dl["artifact"].get("source") or "未匹配到已知包")
            if dl.get("artifact") else ""))

    if report["test_deps"]:
        lines.append("")
        lines.append("── 测试依赖 (test) %d 个：不进发行包 ──"
                     % len(report["test_deps"]))
        for e in report["test_deps"]:
            lines.append("  • %s — %s" % (e["name"], e["source"]))

    if report["vendored"]:
        lines.append("")
        lines.append("── 自带源码 (vendored) %d 个：随项目编译，"
                     "无需外部产物 ──" % len(report["vendored"]))
        for e in report["vendored"]:
            lines.append("  • %s (%s)%s" % (e["name"], e["note"],
                                            " %s" % e["url"] if e.get("url") else ""))

    env = report.get("env_deps", [])
    if env:
        lines.append("")
        lines.append("── 环境依赖 (env, CI/脚本安装) %d 个：构建机环境清单，"
                     "交叉核对信源 ──" % len(env))
        for e in env[:25]:
            res = ("→ %s v%s" % (e["resolved_node"], e["available_version"])
                   if e.get("resolved_node") else "（未匹配到已知包）")
            lines.append("  • %s %s" % (e["name"], res))
        if len(env) > 25:
            lines.append("  … 另有 %d 个" % (len(env) - 25))

    if report["warnings"]:
        lines.append("")
        lines.append("── 警告/提示 %d 条 ──" % len(report["warnings"]))
        for w in report["warnings"]:
            lines.append("  %s %s" % ("[!]" if w["level"] == "warn" else "[i]",
                                      w["msg"]))
    return "\n".join(lines)
