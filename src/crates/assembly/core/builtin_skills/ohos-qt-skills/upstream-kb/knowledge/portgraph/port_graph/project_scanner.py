"""Qt 工程扫描：复用 vendored 的 qt_scanner，新增平台接口检测与图节点生成。

产物：
- app:<name> 节点（普通属性）
- uses-module 边 -> qtmod:*（Qt 模块）
- runtime 边 -> 已入库包节点 / pkg-unknown:* 幽灵节点（第三方库）
- optional 边 -> 默认构建不含的依赖（OFF 默认 CMake 选项守卫内声明；
  不进入 runtime 闭包/可移植性分析，仅供展示层与人工复核）
- node_interfaces 记录（平台接口使用 + 证据）
"""

from __future__ import annotations

import re
import warnings
from bisect import bisect_right
from pathlib import Path
from typing import Dict, List, Optional

from . import db, kb_seed
from . import qt_scanner
# 宏栈机制移驻 qt_scanner（qt_scanner 的 dynamic_loads 检测同样需要按行
# 平台守卫过滤；此处 re-export 保持模块级名称与既有测试兼容）
from .qt_scanner import (  # noqa: F401
    NON_OHOS_PLATFORM_MACROS, OHOS_OR_GENERAL_MACROS, FEATURE_MACROS,
    _extract_defined_macros, _macro_compiles_on_ohos,
    _expr_compiles_on_ohos, _guard_status, _macro_stack_status,
)

# 平台接口检测规则: iface_id -> (正则)
# 注意：只检测实际的 API 调用/头文件包含，不检测平台宏引用（Q_OS_WIN/_WIN32 等）
# 因为平台宏引用本身就是条件编译守卫，由宏栈追踪处理
PLATFORM_API_RULES: List[Dict] = [
    {"iface": "iface:win32",
     "re": re.compile(r"#\s*include\s*<\s*(windows|shellapi|shlobj|winuser|"
                      r"wingdi|winbase|winsock2|commctrl|commdlg)\.h\s*>|"
                      r"\b(CreateWindow|SendMessage|PostMessage|GetMessage|"
                      r"LoadLibrary|GetProcAddress|CreateFile|ReadFile|WriteFile|"
                      r"VirtualAlloc|HeapAlloc|RegOpenKey|RegQueryValue|CoCreateInstance|"
                      r"IDispatch|IUnknown|HWND|HDC|HINSTANCE)\b"),
     "pre": ("windows.h", "shellapi", "shlobj", "winuser", "wingdi",
             "winbase", "winsock2", "commctrl", "commdlg", "CreateWindow",
             "SendMessage", "PostMessage", "GetMessage", "LoadLibrary",
             "GetProcAddress", "CreateFile", "ReadFile", "WriteFile",
             "VirtualAlloc", "HeapAlloc", "RegOpenKey", "RegQueryValue",
             "CoCreateInstance", "IDispatch", "IUnknown", "HWND", "HDC",
             "HINSTANCE")},
    {"iface": "iface:x11",
     "re": re.compile(r"#\s*include\s*<\s*(X11|xcb|Xlib)\b"),
     "pre": ("X11", "xcb", "Xlib")},
    {"iface": "iface:wayland",
     "re": re.compile(r"#\s*include\s*<\s*wayland-client"),
     "pre": ("wayland-client",)},
    {"iface": "iface:dbus",
     "re": re.compile(r"#\s*include\s*<\s*dbus/|\bQDBusConnection\b|"
                       r"#\s*include\s*<\s*QtDBus"),
     "pre": ("dbus/", "QDBusConnection", "QtDBus")},
    {"iface": "iface:alsa",
     # 只认真实 ALSA API 前缀：裸 snd_ 会命中任意变量名
     # （gen_j/rizin 实证：生成的 scanner.c 里 snd_last_ch 变量名
     # 曾导致整个应用被误判 blocked）
     "re": re.compile(r"#\s*include\s*<\s*alsa/|\bsnd_(pcm|ctl|mixer|seq|"
                       r"rawmidi|card|config|lib|hwdep|timer|input|output|"
                       r"error)[_\w]*"),
     "pre": ("alsa/", "snd_pcm", "snd_ctl", "snd_mixer", "snd_seq",
             "snd_rawmidi", "snd_card", "snd_config", "snd_lib",
             "snd_hwdep", "snd_timer", "snd_input", "snd_output",
             "snd_error")},
    {"iface": "iface:pulseaudio",
     "re": re.compile(r"#\s*include\s*<\s*pulse/|\bpa_simple|\bpa_mainloop"),
     "pre": ("pulse/", "pa_simple", "pa_mainloop")},
    {"iface": "iface:coreaudio",
     "re": re.compile(r"#\s*include\s*<\s*(CoreAudio|AudioToolbox|"
                      r"CoreAudioTypes|CoreMIDI)\b|\bAudioUnit\b|\bMIDIPortRef\b"),
     "pre": ("CoreAudio", "AudioToolbox", "CoreMIDI", "AudioUnit",
             "MIDIPortRef")},
    {"iface": "iface:cocoa",
     "re": re.compile(r"#\s*(include|import)\s*<\s*(Cocoa|AppKit|Foundation|IOKit)/"
                      r"|\bNS(Window|View|Application|Responder|Object)\b|"
                      r"@interface\b|@implementation\b|^\s*@\w+\b"),
     # "@" 单独作锚：覆盖 ^\s*@\w+ 分支（文本起始），宁误跑不漏检
     "pre": ("Cocoa", "AppKit", "Foundation", "IOKit", "NSWindow", "NSView",
             "NSApplication", "NSResponder", "NSObject", "@")},
    {"iface": "iface:systemd",
     "re": re.compile(r"#\s*include\s*<\s*systemd/|"
                      r"\b(sd_listen_fds|sd_notify|sd_notifyf|sd_watchdog|"
                      r"sd_booted|sd_journal_)\b"),
     "pre": ("systemd/", "sd_listen", "sd_notify", "sd_watchdog",
             "sd_booted", "sd_journal_")},
    {"iface": "iface:dylib",
     "re": re.compile(r"\bdlopen\s*\(|\bLoadLibrary[AW]?\s*\(|"
                      r"\bdlsym\s*\(|\bdlclose\s*\("),
     "pre": ("dlopen", "dlsym", "dlclose", "LoadLibrary")},
    {"iface": "iface:gpu-desktop-gl",
     "re": re.compile(r"#\s*include\s*<\s*GL/gl\.h|\bglBegin\s*\(|\bglClear\s*\(")
     ,
     "pre": ("GL/gl.h", "glBegin", "glClear")},
    {"iface": "iface:fork-exec",
     "re": re.compile(r"\bfork\s*\(\s*\)"),
     "pre": ("fork",)},
]

# 文件级平台隔离：路径中含这些关键词的文件，整个文件是该平台专属的，
# CMake 层面不会在鸿蒙编译 → 文件内接口视为 platform-file-excluded
# （注意：linux 路径不在此列，因为鸿蒙会编译 Linux 通用代码）
NON_OHOS_PLATFORM_PATH_HINTS = (
    ("macos", ("platform/macos", "platform/osx", "platform/apple",
               "platform/darwin", "/macos/", "/osx/", "/apple/",
               "/mac/", "/darwin/")),
    ("windows", ("platform/windows", "platform/win", "/windows/", "/win32/",
                 "/winrt/", "/win/")),
    ("android", ("platform/android", "/android/")),
    ("ios", ("platform/ios", "/ios/")),
)


def _file_platform_excluded(file_rel: str) -> Optional[str]:
    """根据文件路径判断是否为非鸿蒙平台专属文件。"""
    rel = file_rel.lower().replace("\\", "/")
    for plat, hints in NON_OHOS_PLATFORM_PATH_HINTS:
        for hint in hints:
            if hint in rel:
                return plat
    return None

_PROJECT_VER_RE = re.compile(
    r"project\s*\([^)]*VERSION\s+([0-9.]+)", re.I | re.S)


def normalize_app_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _detect_platform_interfaces(root: Path, scan_info: Dict) -> List[Dict]:
    """扫描源码，返回 [{iface, hits: [{file, line, guard}], guard_distribution}]。

    guard 取值:
      - unconditional:       无守卫，鸿蒙会编译
      - ohos-active:         含鸿蒙/通用守卫，鸿蒙会编译
      - platform-excluded:   被非鸿蒙平台宏守卫包裹，鸿蒙不编译
      - platform-file-excluded: 所在文件本身是非鸿蒙平台专属文件，CMake 不编译

    接口的整体 guard = 最"危险"的命中点：
      - 只要有一个 unconditional/ohos-active 命中 → 整体 ohos-active
      - 否则全部命中都是 platform-excluded/platform-file-excluded → platform-excluded
    """
    hits: Dict[str, Dict] = {}
    for src in scan_info["sources"]:
        if src["ext"] not in qt_scanner.TEXT_SCAN_EXTS:
            continue
        path = root / src["path"]
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        # 先跑接口规则：无命中则跳过逐行宏栈追踪（多数文件无平台 API
        # 调用，此前对每个源文件全量逐行正则占扫描总耗时的 3/4）
        file_matches: List = []
        for rule in PLATFORM_API_RULES:
            # 字面量锚点前置：无锚点必无匹配（正则分支均含这些必要子串），
            # 35MB 源码实测正则扫描 7s → 锚点过滤后 <1s
            if not any(a in text for a in rule.get("pre", ())):
                continue
            for m in rule["re"].finditer(text):
                file_matches.append((rule, m))
        if not file_matches:
            continue
        file_plat = _file_platform_excluded(src["path"])
        guard_by_line = _macro_stack_status(text)
        lines = text.splitlines()
        # 预计算换行偏移，用二分查找定位行号（O(n log n) 替代 O(n*m)）
        nl_offsets = [i for i, ch in enumerate(text) if ch == "\n"]
        for rule, m in file_matches:
                # 行号 = 前面换行符数量 + 1
                line_no = bisect_right(nl_offsets, m.start()) + 1
                # 文件级平台隔离优先于行级守卫
                if file_plat:
                    guard = "platform-file-excluded"
                else:
                    guard = guard_by_line.get(line_no, "ohos-active")
                h = hits.setdefault(
                    rule["iface"],
                    {"iface": rule["iface"], "hits": [],
                     "guard_counts": {"unconditional": 0, "ohos-active": 0,
                                      "platform-excluded": 0,
                                      "platform-file-excluded": 0}})
                if len(h["hits"]) < 5:
                    h["hits"].append({"file": src["path"], "line": line_no,
                                      "guard": guard,
                                      "snippet": lines[line_no - 1].strip()[:80]})
                h["guard_counts"][guard] = h["guard_counts"].get(guard, 0) + 1

    result = []
    for h in hits.values():
        gc = h["guard_counts"]
        if gc.get("unconditional", 0) > 0 or gc.get("ohos-active", 0) > 0:
            overall = "ohos-active"
        else:
            overall = "platform-excluded"
        result.append({"iface": h["iface"], "hits": h["hits"],
                       "guard": overall, "guard_counts": gc})
    return result


def _resolve_qtmod(conn, key: str, _cache: Optional[Dict] = None) -> Optional[Dict]:
    """扫描出的模块名 -> qtmod 节点（支持 webenginewidgets->webengine 前缀匹配）。

    _cache 用于在同一次扫描中复用已加载的 Qt 模块列表，避免重复全表扫描。
    """
    node = db.get_node(conn, "qtmod:%s" % key)
    if node:
        return node
    if _cache is None or "qtmods" not in _cache:
        rows = conn.execute(
            "SELECT * FROM nodes WHERE kind='qt-module'").fetchall()
        qtmods = [(r["id"][len("qtmod:"):], dict(r)) for r in rows]
        if _cache is not None:
            _cache["qtmods"] = qtmods
    else:
        qtmods = _cache["qtmods"]
    cands = []
    for rkey, rdict in qtmods:
        if key.startswith(rkey) or rkey.startswith(key):
            cands.append((min(len(key), len(rkey)), rdict))
    if cands:
        cands.sort(key=lambda t: -t[0])
        return cands[0][1]
    return None


_SET_VER_PART_RE = re.compile(r'VERSION_(MAJOR|MINOR|PATCH)\s+"?(\d+)"?')


def _detect_version(root: Path) -> Optional[str]:
    for cmake in ("CMakeLists.txt", "version.cmake"):
        p = root / cmake
        if not p.exists():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        m = _PROJECT_VER_RE.search(text)
        if m:
            return m.group(1)
        parts = {}
        for pm in _SET_VER_PART_RE.finditer(text):
            parts.setdefault(pm.group(1), pm.group(2))
        if "MAJOR" in parts:
            return ".".join(parts[k] for k in ("MAJOR", "MINOR", "PATCH")
                            if k in parts)
    return None


def _link_kf_components(conn, app_id: str, components: List[str]) -> None:
    """把 KDE Frameworks 组件建成 framework 子项目节点并连边，供引擎递归分析。

    app -> kf:组件（runtime）；kf:组件 -> qtmod:*（uses-module）/
    kf:子组件（runtime）；kf:组件 的平台接口写入 node_interfaces。
    用 BFS 展开组件间的子框架依赖，避免整体判 blocked。
    """
    seen = set()
    queue = [(app_id, c) for c in components]
    while queue:
        parent_id, comp = queue.pop(0)
        kf_id = "kf:%s" % comp
        db.upsert_edge(conn, parent_id, kf_id, "runtime")
        if comp in seen:
            continue
        seen.add(comp)
        db.upsert_node(
            conn, kf_id, "framework", "KF %s" % comp, "scan", "unknown",
            description="KDE Frameworks 组件（子项目，递归分析）",
            port_evidence="按其 Qt 模块/平台接口/子框架依赖递归判定")
        deps = kb_seed.KF_DEPS.get(comp, {"qt": ["core"], "kf": [], "ifaces": []})
        for q in deps.get("qt", []):
            if db.get_node(conn, "qtmod:%s" % q):
                db.upsert_edge(conn, kf_id, "qtmod:%s" % q, "uses-module")
        for ifc in deps.get("ifaces", []):
            db.add_node_interface(conn, kf_id, ifc)
        for k2 in deps.get("kf", []):
            queue.append((kf_id, k2))


def _fold_dep_name(n: str) -> str:
    """依赖名折叠：小写、去非字母数字（分隔符/大小写差异归一）。"""
    return re.sub(r"[^a-z0-9]+", "", (n or "").lower())


def _submodule_folds(git_submodules: List[Dict]) -> set:
    """git 子模块名折叠集合（name/path 末段/url 末段）：用于识别 vendored 依赖。"""
    folds = set()
    for gm in git_submodules or []:
        cands = [gm.get("name") or ""]
        path = gm.get("path") or ""
        cands.append(path.rsplit("/", 1)[-1])
        url = (gm.get("url") or "").rstrip("/")
        last = url.rsplit("/", 1)[-1]
        if last.endswith(".git"):
            last = last[:-4]
        cands.append(last)
        for c in cands:
            f = _fold_dep_name(c)
            if len(f) >= 3:
                folds.add(f)
    return folds


def _resolve_pkg_node(conn, name: str) -> tuple:
    """包名 -> (节点, 别名)：直接名失败后按 kb_seed.PKG_ALIASES 重试。

    避免同库异名产生 pkg-unknown 幽灵节点（fetch-deps 会误报 need_port，
    而别名指向的 bottle 实际存在）。
    """
    node = kb_seed.resolve_package(conn, name)
    alias_used = None
    if node is None:
        aliases = kb_seed.PKG_ALIASES.get(name.lower())
        if isinstance(aliases, str):
            aliases = [aliases]
        for alias in aliases or []:
            node = kb_seed.resolve_package(conn, alias.lower())
            if node:
                alias_used = alias
                break
    return node, alias_used


def _link_third_party(conn, app_id: str, info: Dict) -> Dict:
    """把 CMake find_package/pkg_check_modules + Conan/vcpkg 清单 + 依赖清单
    函数（require_dep 等）发现的第三方包连边到已知包节点；未匹配的记为
    unknown 包节点。require_source_dep（源码自带）→ vendored 边；
    require_tool（主机构建工具）不连边。

    集三轮实测增强（e2e corpus_a/corpus_b/corpus_d 复核驱动）：
    - find_package 命中的构建工具/解释器（python3 等）不建运行时边——
      那是构建期依赖，deps_report 侧归 build-tool 分类；
    - target_link_libraries 的 ns::external_<name> 导入目标名（剥前缀后
      在 raw_libs 里，ext_target=True）：能解析则连边，不能解析且非
      vendored 子模块则建幽灵节点（高置信声明，如 corpus_a 的全部三方库）；
    - 同库异名归并：find_package 的 CamelCase 压平名（LibtorrentRasterbar →
      libtorrentrasterbar）与 pkg-config 连字符名（libtorrent-rasterbar）按
      去分隔符键分组，组内选代表名，避免同库产生重复幽灵节点/重复下载；
    - OFF 默认 CMake 选项守卫内的声明（默认构建不含）连 optional 边，
      不进入 runtime 闭包/可移植性分析。

    返回 {linked: [...], unknown: [...], optional: [...], vendored: [...]}。
    """
    # 构建工具/平台接口名不建包节点也不建幽灵（python3/ecm/gettext 是
    # 主机侧工具，systemd/alsa 是平台接口，由 analyze/deps 分类覆盖；
    # 此前 pkg-unknown:python3 幽灵被 fetch-deps 计入 need_port）
    from . import deps_report as _dr      # 函数内 import 避免循环依赖
    _skip = (_dr.BUILD_TOOL_FINDPKG.keys() | _dr.INTERFACE_BOUND_PACKAGES.keys()
             | _dr.QT_TOOL_NAMES)
    cp = info.get("cmake_packages", {})
    # find_package 构建工具（python3/cmake/...）不是应用运行时依赖
    names: List[str] = [n for n in cp.get("find_package", [])
                        if n not in qt_scanner.BUILD_TOOL_FINDPKG]
    names.extend(n for n in cp.get("find_package_optional", [])
                 if n not in qt_scanner.BUILD_TOOL_FINDPKG)
    names.extend(cp.get("pkg_check_modules", []))
    names.extend(cp.get("pkg_check_modules_optional", []))
    pm = info.get("pkg_manifests", {})
    for c in pm.get("conan", []):
        names.append(c["name"])
    for v in pm.get("vcpkg", []):        # vcpkg 条目可为 str 或 {name, version}
        names.append(v["name"] if isinstance(v, dict) else v)
    # 合并源码 #include 发现的第三方库（去重保序）
    for h in info.get("third_party_hints", []):
        if h["name"] not in names:
            names.append(h["name"])
    # 依赖清单函数（require_dep）：与 find_package 同等参与解析
    manifest = info.get("manifest_deps", [])
    for md in manifest:
        if md["mode"] == "link" and md["name"] not in names:
            names.append(md["name"])
    # project() 自引用（如 gen_j 插件样例 find_package(gen_j)）：
    # 不是外部依赖，避免误解析到同名无关包（cmdpkgs:gen_j 实证）
    self_names = {n.lower() for n in info.get("cmake_project_names", [])}
    if self_names:
        names = [n for n in names if n.lower() not in self_names]

    # optional 名单：全部声明点都在 OFF 默认选项守卫内的包
    # （scanner 层已保证必需优先：任一必需声明点即不入 optional 名单）
    optional_names = set(cp.get("find_package_optional", []))
    optional_names.update(cp.get("pkg_check_modules_optional", []))
    optional_names.update(spec["name"] for spec in
                          cp.get("pkg_modules", []) if spec.get("optional"))

    def _resolve(name: str, dashless_index: Dict[str, str]):
        # 与 deps_report._resolve 共享解析阶梯（别名优先 → 原名 → lib
        # 前缀变体 → 去版本后缀）：扫描期不再因缺少 lib 前缀剥离而建
        # pkg-unknown 幽灵节点（libsparsehash/gstreamer-1.0 实证）
        node = kb_seed.resolve_pkg_name(conn, name)
        alias_used = None
        canon = kb_seed.PKG_ALIASES.get(name.lower())
        if node is not None:
            # 标记经别名表归并的解析（libavcodec → ffmpeg）
            if canon and canon.lower() == (node.get("name") or "").lower():
                alias_used = canon
        else:
            # 兜底：去分隔符匹配（CamelCase 压平名 → 连字符包名）
            node = kb_seed.resolve_package_dashless(conn, name, dashless_index)
            if node:
                alias_used = "dashless"
        return node, alias_used

    def _emit(name: str, node, alias_used=None, via=None, merged=None,
              edge_type="runtime"):
        """解析结果落图：node 为 None 时建幽灵节点（用别名表规范名，
        使同库异名 botan3/botan-3 归并到同一幽灵而非双份 need_port）。"""
        if node is not None:
            target_id = node["id"]
            status = node["port_status"]
        else:
            # 幽灵节点用别名表规范名（同库异名 botan3/botan-3 归并到
            # 同一幽灵，而非双份 need_port）
            canon = kb_seed.PKG_ALIASES.get(name.lower())
            if canon and canon.lower() != name.lower():
                name = canon
            target_id = "pkg-unknown:%s" % normalize_app_name(name)
            status = "unknown"
            db.upsert_node(
                conn, target_id, "package", name, "scan", "unknown",
                description="扫描发现的第三方库，未匹配到已知包源",
                port_evidence="不在 Harmonybrew/cmd-pkgs 已知清单")
        db.upsert_edge(conn, app_id, target_id, edge_type)
        item = {"hint": name, "node": target_id, "status": status}
        if alias_used:
            item["alias"] = alias_used
        if via:
            item["via"] = via
        if merged:
            item["merged_from"] = merged
        if edge_type == "optional":
            item["optional"] = True
            optional.append(item)
        elif node is not None:
            linked.append(item)
        else:
            unknown.append(item)

    linked, unknown, optional = [], [], []
    seen = set()
    # git 子模块折叠名（提前算：主名单与裸链接名共用）——
    # find_package(Rizin) 而仓库自带 rizin/ 子模块（默认 bundled 构建）
    # 不建幽灵：源码随项目（gen_j 实证）
    submodule_folds = _submodule_folds(info.get("git_submodules", []))

    # ---- 主名单：同库异名分组（组内代表名 = 能解析到已知包的 >
    #      带分隔符的（pkg-config/hb 命名口径）> 首个出现的）。
    #      分组键取别名表规范化后的去分隔符键：ddjvuapi→djvulibre、
    #      usb-1.0→libusb 这类同库异名凭别名归入同组，不再产生重复
    #      未知条目（gen_b 双 djvulibre 幽灵实证）
    dashless_index = kb_seed.build_dashless_index(conn)
    groups: Dict[str, List[str]] = {}
    order: List[str] = []
    for name in names:
        canon = kb_seed.PKG_ALIASES.get(name.lower()) or name
        key = kb_seed._dashless_key(canon)
        if key not in groups:
            groups[key] = []
            order.append(key)
        if name not in groups[key]:
            groups[key].append(name)
        seen.add(name.lower())

    for key in order:
        members = groups[key]
        dashed = [n for n in members if re.search(r"[-_.]", n)]
        rep, rep_node, rep_alias = None, None, None
        for cand in dashed + [m for m in members if m not in dashed]:
            node, alias = _resolve(cand, dashless_index)
            if node:
                rep, rep_node, rep_alias = cand, node, alias
                break
        if rep is None:
            rep = dashed[0] if dashed else members[0]
        merged = [m for m in members if m != rep]
        # 任一成员必需 → 必需（保守：可选声明点与必需声明点并存时按必需）
        edge_type = ("runtime" if any(m not in optional_names
                                      for m in members) else "optional")
        # 构建工具/平台接口名（python3/ecm/systemd）且无可解析产物时
        # 不建节点也不建幽灵（由 analyze/deps 分类覆盖）；可解析的
        # （如 alsa → cmdpkgs:alsa-lib）正常连边；可选声明的幽灵保留
        # optional 边（不入闭包，仅信息呈现）
        if (rep_node is None and edge_type == "runtime"
                and rep.lower() in _skip):
            continue
        # 未解析且名折 Git 子模块（默认 bundled 随项目编译）：不建幽灵
        if rep_node is None and _fold_dep_name(rep) in submodule_folds:
            continue
        _emit(rep, rep_node, rep_alias, merged=merged, edge_type=edge_type)

    # ---- 裸链接名（含 ns::external_<name> 导入目标，剥前缀后标记
    #      ext_target）：能解析则连边；external-target 高置信声明
    #      在未解析且非 vendored 子模块时建幽灵节点
    for rl in info.get("raw_libs", []):
        name = rl["name"]
        # 其他平台 if 块内的裸链接声明（gen_c if(HAIKU) network、gen_b
        # mobile if(ANDROID) -lsoftokn3 等）：默认鸿蒙构建不含，不连边
        if rl.get("platform_block"):
            continue
        if name.lower() in seen:
            continue
        # 同库异名：压平名/别名同库的条目已在主名单分组处理时跳过
        canon = kb_seed.PKG_ALIASES.get(name.lower()) or name
        if kb_seed._dashless_key(canon) in groups:
            continue
        seen.add(name.lower())
        # Windows 系统库（通常位于 win32 平台块）：跳过，防止同名 Unix
        # 库误连边（bcrypt → OpenBSD bcrypt）
        if name.lower() in qt_scanner.WIN32_SYSTEM_LIBS:
            continue
        node, alias_used = _resolve(name, dashless_index)
        if node:
            _emit(name, node, alias_used,
                  via="external-target" if rl.get("ext_target") else None)
        elif rl.get("ext_target"):
            # vendored 子模块（.gitmodules 声明，随项目编译）不建幽灵：
            # 依赖由项目源码自足，不是需获取/移植的外部包
            if _fold_dep_name(name) in submodule_folds:
                continue
            if len(name) >= 3:
                _emit(name, None)

    # require_source_dep：源码自带依赖 → vendored 边（随项目编译，
    # fetch-deps 标 role=vendored，不进入 need_port）
    vendored = []
    for md in manifest:
        if md["mode"] != "source":
            continue
        name = md["name"]
        node, alias_used = _resolve(name, dashless_index)
        if node:
            vid = node["id"]
            status = node["port_status"]
        else:
            vid = "pkg-unknown:%s" % normalize_app_name(name)
            status = "unknown"
            db.upsert_node(
                conn, vid, "package", name, "scan", "unknown",
                description="依赖清单声明的源码自带依赖（require_source_dep），"
                            "随项目源码编译",
                port_evidence="不在 Harmonybrew/cmd-pkgs 已知清单（vendored，"
                              "无需外部产物）")
        db.upsert_edge(conn, app_id, vid, "vendored")
        item = {"hint": name, "node": vid, "status": status,
                "evidence": md["evidence"][:1]}
        if alias_used:
            item["alias"] = alias_used
        vendored.append(item)
    return {"linked": linked, "unknown": unknown, "optional": optional,
            "vendored": vendored}


def scan_project(conn, project_root, info: Dict = None) -> Dict:
    """扫描 Qt 工程并写入图。返回摘要。

    info: 可传入 qt_scanner.scan_project 的结果复用（避免大仓库重复扫描）。
    """
    root = Path(project_root).resolve()
    info = info or qt_scanner.scan_project(root)
    db.init_db(conn)

    app_id = "app:%s" % normalize_app_name(info["name"])
    version = _detect_version(root)
    # 记录项目根路径：deps / fetch-deps 等命令按应用名回溯源码位置
    db.set_meta(conn, "root_%s" % app_id, str(root))
    db.upsert_node(
        conn, app_id, "app", info["name"], "scan", "unknown",
        version=version,
        description="Qt %s 应用，构建系统 %s，%d 个源文件" % (
            info.get("qt_version_hint") or "?", info["build_system"],
            len(info["sources"])),
        port_evidence="已扫描，待可移植性分析")

    # 清理旧的出边与接口记录（重扫幂等）
    conn.execute("DELETE FROM edges WHERE src=?", (app_id,))
    conn.execute("DELETE FROM node_interfaces WHERE node_id=?", (app_id,))

    # Qt 模块边
    modules_linked, modules_missing = [], []
    resolve_cache: Dict = {}
    for mod in info["qt_modules"]:
        node = _resolve_qtmod(conn, mod, _cache=resolve_cache)
        if node:
            db.upsert_edge(conn, app_id, node["id"], "uses-module")
            modules_linked.append({"module": mod, "node": node["id"],
                                   "status": node["port_status"]})
        else:
            modules_missing.append(mod)

    # 第三方库依赖边（find_package/pkg_check_modules/Conan/vcpkg/include/
    # require_dep；require_source_dep → vendored 边）
    tp = _link_third_party(conn, app_id, info)
    deps_linked, deps_unknown = tp["linked"], tp["unknown"]
    deps_optional = tp.get("optional", [])

    # KDE Frameworks 组件 → 作为子项目节点递归分析（不再整体判 blocked）
    _link_kf_components(conn, app_id, info.get("kf_components", []))

    # 平台接口使用
    ifaces = _detect_platform_interfaces(root, info)
    for h in ifaces:
        gc = h["guard_counts"]
        guard_label = {
            "unconditional": "无条件编译",
            "ohos-active": "含鸿蒙/通用守卫（会编译）",
            "platform-excluded": "被非鸿蒙平台守卫包裹（不编译）",
        }[h["guard"]]
        hit_desc = "; ".join(
            "%s:%d[%s] %s" % (hit["file"], hit["line"], hit["guard"],
                               hit["snippet"])
            for hit in h["hits"][:3])
        excluded_total = (gc.get("platform-excluded", 0)
                          + gc.get("platform-file-excluded", 0))
        evidence = (
            "[%s] guard=%s "
            "(%d 处无条件 / %d 处鸿蒙可编译 / %d 处宏守卫排除 / %d 处文件级排除)"
            " | %s" % (
                guard_label, h["guard"],
                gc.get("unconditional", 0), gc.get("ohos-active", 0),
                gc.get("platform-excluded", 0),
                gc.get("platform-file-excluded", 0), hit_desc))
        db.add_node_interface(conn, app_id, h["iface"], evidence=evidence)

    db.set_meta(conn, "scan_%s_at" % app_id, db.now())
    conn.commit()
    return {
        "app_id": app_id, "name": info["name"], "version": version,
        "build_system": info["build_system"],
        "qt_version_hint": info.get("qt_version_hint"),
        "sources": len(info["sources"]),
        "modules_linked": modules_linked, "modules_missing": modules_missing,
        "deps_linked": deps_linked, "deps_unknown": deps_unknown,
        "deps_vendored": tp["vendored"],
        "deps_optional": deps_optional,
        "interfaces": ifaces,
    }
