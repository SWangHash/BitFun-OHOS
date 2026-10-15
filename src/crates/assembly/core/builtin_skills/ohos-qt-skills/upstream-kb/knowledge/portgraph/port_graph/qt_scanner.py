"""Qt 工程预扫描（vendored，独立于 qt_ohos 包）。

识别构建系统（qmake/CMake）、Qt 模块与版本、源文件清单、语言统计、
第三方包声明（find_package / pkg_check_modules / Conan / vcpkg 清单）。
供 project_scanner 消费。

综合依赖分析增强（deps report 消费）：
- find_package 完整参数（最低版本 / REQUIRED / COMPONENTS / OPTIONAL_COMPONENTS）
- 主机构建工具链（cmake 最低版本 / C++ 标准 / find_program / COMMAND 工具引用）
- 运行时动态加载（dlopen / QLibrary / QPluginLoader 字面量）
- qmake LIBS 链接库、.gitmodules 自带依赖、vendored 目录
"""

from __future__ import annotations

import json
import re
import warnings
from pathlib import Path
from typing import Dict, List, Optional

SOURCE_EXTS = {".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx",
               ".m", ".mm", ".qml", ".qrc", ".ui", ".pro", ".pri"}
TEXT_SCAN_EXTS = {".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp",
                  ".hxx", ".m", ".mm", ".qml"}
BINARY_EXTS = {".so", ".a", ".dll", ".dylib", ".lib", ".dll.a"}
# 排除目录：仅排除确定非源码的（VCS/IDE 缓存/构建产物）。
# 注意：dist 不排除——C++/CMake 项目中常为源控的打包/安装子目录
# （如 corpus_d 的 add_subdirectory(dist)，内含真实依赖声明与
# 选项守卫，e2e 复盘曾因排除 dist 漏掉 if(SYSTEMD) 守卫上下文）。
EXCLUDE_DIRS = {".git", ".hg", ".svn", ".qt-ohos", "node_modules", "__pycache__",
                ".idea", ".vs", ".vscode", ".gradle", "out"}
# dist 不在排除清单：C++ 项目中 dist 多为源控打包/安装目录（corpus_d
# 的 dist/unix/CMakeLists.txt 是真实构建子目录，e2e 复核确认）
# 构建输出目录（build / build-Debug / build.123 / build2）：排除以免扫到生成物；
# 注意 buildscripts / buildtools 是源码目录（corpus_b_core、corpus_b 的依赖清单
# ExtDepsManifest.cmake / SetupQt6.cmake 都在其中），不能按 build 前缀排除
# （e2e corpus_b 复核确认的前缀误排除 bug）。
_BUILD_DIR_RE = re.compile(r"^build(?:[-._].+|\d+)?$")
MAX_FILE_BYTES = 2 * 1024 * 1024

_PRO_QT_RE = re.compile(r"^\s*QT\s*([+\-]?=)\s*(.*)$", re.M)
# 兼容 find_package(Qt6 ${VER} CONFIG REQUIRED COMPONENTS Core Gui ...) 形式
_CMAKE_FINDPKG_QT_RE = re.compile(r"find_package\s*\(\s*Qt(\d)\b([^)]*)\)", re.I)
_CMAKE_FINDPKG_KF_RE = re.compile(r"find_package\s*\(\s*KF(\d)\b([^)]*)\)", re.I)
_KF_LINK_RE = re.compile(r"KF\d::(\w+)")
# 子目标/别名 -> 归一化组件名
_KF_ALIAS = {"configcore": "config", "configgui": "config",
             "kiocore": "kio", "kiowidgets": "kio", "kiofilewidgets": "kio",
             "i18nqml": "i18n", "bookmarkswidgets": "bookmarks"}
_COMPONENTS_RE = re.compile(r"\bCOMPONENTS\s+([^)]*)", re.I)
_CMAKE_KW = {"REQUIRED", "CONFIG", "QUIET", "MODULE", "COMPONENTS",
             "OPTIONAL_COMPONENTS", "EXACT", "NO_MODULE", "NO_POLICY_SCOPE"}


def _orphan_components(rest: str) -> List[str]:
    """无 COMPONENTS 关键字时的尾随组件名（CMake 语义：版本/关键字之后
    的裸名即组件）。

    gen_c 实证：find_package(Qt6 ${V} CONFIG REQUIRED\n Core ...)
    与 find_package(KF6 ${V} REQUIRED\n Bookmarks ...)——合法但无
    COMPONENTS 关键字，旧解析全部漏检（Qt 模块只余 include 启发式命中）。
    OPTIONAL_COMPONENTS 之后的 token 是可选组件，不收（保守不判必需）。
    """
    out: List[str] = []
    seen_kw = False
    seen_comp = False   # 组件区：后续裸名均为组件（Config 与 CONFIG 同形）
    for tok in rest.split():
        t = tok.strip('"')
        if not t:
            continue
        up = t.upper()
        if not seen_comp:
            if "${" in t:
                seen_kw = True
                continue
            if re.fullmatch(r"\d+(\.\d+)*", t):
                seen_kw = True
                continue
            if up == "OPTIONAL_COMPONENTS":
                break
            if up in _CMAKE_KW:
                seen_kw = True
                continue
        if seen_kw and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", t):
            out.append(t)
            seen_comp = True
    return out
# 任意 find_package(<Name> ...) —— 捕获第三方包名（Qt/KF 已单独处理）
_FINDPKG_ANY_RE = re.compile(r"find_package\s*\(\s*([A-Za-z0-9_]+)", re.I)
# pkg_check_modules(<PREFIX> [REQUIRED] <module> [<module> ...])
_PKGCHECK_RE = re.compile(r"pkg_check_modules\s*\(\s*\w+\s+([^)]*)\)", re.I)
_PKGCONF_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]*")
_INCLUDE_QT_RE = re.compile(r"#\s*include\s*<\s*(Qt([A-Za-z0-9]+|))\s*/")
# Conan / vcpkg 清单（版本可为精确号或范围串，如 [>=1.2 <2]，含空格）
_CONAN_TXT_REQ_RE = re.compile(r"^\s*([A-Za-z0-9_.+-]+)(?:/(.+?))?\s*$")
_CONAN_PY_REQ_RE = re.compile(r'"([A-Za-z0-9_.+-]+)/([^"]*)"')
_VCPKG_JSON_DEPS = ("dependencies",)

# ---- 综合依赖分析增强 ----
# cmake_minimum_required(VERSION 3.16[...])
_CMAKE_MIN_RE = re.compile(
    r"cmake_minimum_required\s*\(\s*VERSION\s+([0-9][\d.]*)", re.I)
# set(CMAKE_CXX_STANDARD 17) / target 属性 CXX_STANDARD 17
_CXX_STD_RE = re.compile(r"\bCMAKE_CXX_STANDARD\s+(\d+)")
_CXX_STD_PROP_RE = re.compile(r"\bCXX_STANDARD\s+(\d+)")
# qmake: CONFIG += c++17 / -std=c++17
_QMAKE_CXX_RE = re.compile(
    r"CONFIG\s*\+=\s*[^\n]*?\bc\+\+(\d{2})\b|-std=c\+\+(\d{2})")
# find_package 完整参数串（[^)]* 跨行）
_FINDPKG_FULL_RE = re.compile(
    r"find_package\s*\(\s*([A-Za-z0-9_.-]+)\s*([^)]*)\)", re.I)
_FINDPROG_RE = re.compile(r"find_program\s*\(([^)]*)\)", re.I)
_COMMAND_TOKEN_RE = re.compile(r"\bCOMMAND\s+([^\s)]+)")
# 运行时动态加载（字面量；兼容 QLibrary lib("x") 声明形式）
_DLOPEN_RE = re.compile(r'\bdlopen\s*\(\s*"([^"]+)"')
_QLIBRARY_RE = re.compile(r'\bQLibrary(?:\s+\w+)?\s*\(\s*"([^"]+)"')
_QPLUGINLOADER_RE = re.compile(
    r'\bQPluginLoader(?:\s+\w+)?\s*\(\s*"([^"]+)"')
# qmake LIBS += -lfoo
_QMAKE_LIBS_RE = re.compile(r"^\s*LIBS\s*\+=\s*(.+)$", re.M)
_QMAKE_LINK_FLAG_RE = re.compile(r"(?:^|\s)-l([A-Za-z0-9_.+-]+)")
# 测试设施
_ENABLE_TESTING_RE = re.compile(r"\benable_testing\s*\(")
_ADD_TEST_RE = re.compile(r"\badd_test\s*\(")
# find_package 参数关键字
_FP_KW = {"REQUIRED", "CONFIG", "QUIET", "MODULE", "COMPONENTS",
          "OPTIONAL_COMPONENTS", "EXACT", "NO_MODULE", "NO_POLICY_SCOPE",
          "GLOBAL", "BYPASS_PROVIDER", "REGISTRY_VIEW", "CMAKE_FIND_ROOT_PATH"}

# 已知主机构建工具名（构建机运行，不部署到设备）。
# 命中以下集合或命中特征后缀（*-config/*-scanner 等）的
# COMMAND/find_program token 记为构建工具。
KNOWN_HOST_TOOLS = {
    "cmake", "ninja", "make", "gmake", "mingw32-make", "ninja-build",
    "pkg-config", "pkgconf", "protoc", "grpc_cpp_plugin", "flex", "bison",
    "gperf", "re2c", "ragel", "yasm", "nasm", "python", "python2", "python3",
    "perl", "ruby", "tclsh", "bash", "sh", "doxygen", "dot", "msgfmt",
    "msgmerge", "xgettext", "git", "svn", "hg", "autoconf", "automake",
    "libtoolize", "autoreconf", "autoheader", "aclocal", "ccache", "sccache",
    "clang", "clang++", "gcc", "g++", "cc", "c++", "ld", "ar", "strip",
    "objcopy", "windres", "lupdate", "lrelease", "lconvert", "qmake",
    "qtpaths", "moc", "uic", "rcc", "wayland-scanner", "gdbus-codegen",
    "glib-genmarshal", "glib-mkenums", "lrelease-pro", "lupdate-pro",
}
_HOST_TOOL_SUFFIXES = ("-config", "-scanner", "-codegen", "-genmarshal",
                       "-mkenums", "-probe", "-desktop-file-utils")

# vendored 源码目录名（项目内自带、随项目一起编译的依赖）
VENDORED_DIR_NAMES = ("3rdparty", "thirdparty", "third_party", "third-party",
                      "external", "extern", "ext", "vendor", "deps", "dep",
                      "subprojects", "dependencies")

# ---- 依赖声明全形式检测（deps report 第二轮增强）----
# target_link_libraries(<tgt> [PRIVATE|...] <item>...)：item 可为导入目标
# （Foo::Bar）、裸库名（z/ssl/qtermwidget6）、-lfoo、"-framework X"、路径
_TARGET_LINK_RE = re.compile(r"target_link_libraries\s*\(([^)]*)\)", re.I | re.S)
_ADD_TARGET_RE = re.compile(
    r"\b(?:qt\d+_)?add_(?:library|executable)\s*\(\s*([A-Za-z0-9_.:-]+)")
# macro/函数名定义（body 内调用 add_library 的包装器，如 gen_a 的
# kis_add_library(gen_aui SHARED ...)：其首参即目标名）
_MACRO_DEF_RE = re.compile(
    r"\b(?:macro|function)\s*\(\s*([A-Za-z0-9_.:-]+)", re.I)
_END_BLOCK_RE = re.compile(r"^\s*end(?:macro|function)\b", re.I | re.M)
_TLL_KEYWORDS = {"PRIVATE", "PUBLIC", "INTERFACE", "DEBUG", "OPTIMIZE",
                 "RELEASE", "GENERAL", "OPTIONAL", "LINK_PUBLIC",
                 "LINK_PRIVATE", "LINK_INTERFACE_LIBRARIES"}
_FRAMEWORK_RE = re.compile(r"-framework\s+([A-Za-z]\w*)")
_LFLAG_RE = re.compile(r"(?:^|\s)-l([A-Za-z0-9_.+-]+)")
# find_library(<VAR> [NAMES] name... [PATHS ...])
_FINDLIB_RE = re.compile(r"find_library\s*\(([^)]*)\)", re.I)
_FINDLIB_KW = {"NAMES", "PATHS", "HINTS", "PATH_SUFFIXES", "DOC", "REQUIRED",
               "NAMES_PER_DIR", "NO_CACHE", "VALIDATOR", "CMAKE_FIND_ROOT_PATH",
               "NO_DEFAULT_PATH", "ONLY_CMAKE_FIND_ROOT_PATH"}
# FetchContent_Declare / ExternalProject_Add / CPMAddPackage
_FETCHED_DECLARE_RE = re.compile(
    r"\b(FetchContent_Declare|ExternalProject_Add|CPMAddPackage)\s*"
    r"\(\s*([A-Za-z0-9_.:-]+|GITHUB_REPOSITORY)([^)]*)\)", re.S)
_FETCH_URL_RE = re.compile(r"(?:GIT_REPOSITORY|GITHUB_REPOSITORY|URL)\s+(\S+)")
_FETCH_TAG_RE = re.compile(r"(?:GIT_TAG|GIT_VERSION|VERSION|URL_HASH)\s+(\S+)")
_FETCHED_HOW = {"FetchContent_Declare": "FetchContent",
                "ExternalProject_Add": "ExternalProject",
                "CPMAddPackage": "CPM"}
# qmake: PKGCONFIG += foo
_QMAKE_PKGCONFIG_RE = re.compile(r"^\s*PKGCONFIG\s*\+=\s*(.+)$", re.M)
# meson: dependency('name'[, version: '>=x'[, required: false[, modules: [...]]]])
_MESON_DEP_RE = re.compile(r"dependency\s*\(\s*'([^']+)'([^)]*)\)", re.S)
# meson 项目内定义的依赖（override_dependency）：不是外部包
_MESON_OVERRIDE_RE = re.compile(
    r"meson\s*\.\s*override_dependency\s*\(\s*'([^']+)'")
_MESON_VER_RE = re.compile(r"version:\s*'([^']+)'")
_MESON_OPT_RE = re.compile(r"required:\s*false")
_MESON_MODS_RE = re.compile(r"modules:\s*\[([^\]]*)\]")
_MESON_FINDLIB_RE = re.compile(r"\bcc\s*\.\s*find_library\s*\(\s*'([^']+)'")
_MESON_PROJECT_RE = re.compile(r"project\s*\(([^)]*)\)", re.S)
_MESON_MIN_RE = re.compile(r"meson_version:\s*'>=\s*([\d.]+)'")
_MESON_STD_RE = re.compile(r"cpp_std\s*=\s*'?gnu?\+\+(\d+)")
_MESON_SUBPROJECT_RE = re.compile(r"\bsubproject\s*\(\s*'([^']+)'")
# autotools：PKG_CHECK_MODULES([VAR],[foo >= 1.2]) / AC_CHECK_LIB / AC_SEARCH_LIBS
_PKGCHK_MOD_RE = re.compile(r"PKG_CHECK_MODULES\s*\(\s*\[?\w+\]?\s*,\s*\[([^\]]*)\]", re.S)
_AC_CHECK_LIB_RE = re.compile(r"AC_CHECK_LIB\s*\(\s*\[?([A-Za-z0-9_.+-]+)")
_AC_SEARCH_LIBS_RE = re.compile(r"AC_SEARCH_LIBS\s*\(\s*\[?\w+\]?\s*,\s*\[([^\]]*)\]")
# CI / 安装脚本：apt(-get) install / brew install / pacman -S <pkgs>
_CI_INSTALL_RE = re.compile(
    r"(?:apt(?:-get)?\s+(?:-\S+\s+)*install|brew\s+install|pacman\s+(?:-\S+\s+)*-S)"
    r"[\s\\]+(.+?)(?=$|\n(?:[^\s\\]|\\\s)|\|\||&&)", re.S)

# known third-party hints: name -> (include regexes, link/find names)
THIRD_PARTY_HINTS = {
    "openssl":  (r"#\s*include\s*<\s*openssl/", ("ssl", "crypto", "OpenSSL")),
    "zlib":     (r"#\s*include\s*<\s*zlib\.h", ("z", "ZLIB")),
    "libpng":   (r"#\s*include\s*<\s*png\.h", ("png", "PNG")),
    "libjpeg":  (r"#\s*include\s*<\s*(jpeglib\.h|turbojpeg\.h)", ("jpeg", "JPEG")),
    "sqlite":   (r"#\s*include\s*<\s*sqlite3\.h", ("sqlite3", "SQLite3")),
    "ffmpeg":   (r"#\s*include\s*<\s*(libavcodec|libavformat|libavutil)/",
                 ("avcodec", "avformat", "avutil", "FFMPEG")),
    "curl":     (r"#\s*include\s*<\s*curl/curl\.h", ("curl", "CURL")),
    "boost":    (r"#\s*include\s*<\s*boost/", ("Boost",)),
    "icu":      (r"#\s*include\s*<\s*unicode/", ("icu", "ICU")),
    "freetype": (r"#\s*include\s*<\s*(ft2build\.h|freetype2/)", ("freetype",)),
    "harfbuzz": (r"#\s*include\s*<\s*hb\.h", ("harfbuzz",)),
    "protobuf": (r"#\s*include\s*<\s*google/protobuf/", ("protobuf", "Protobuf")),
    "spdlog":   (r"#\s*include\s*<\s*spdlog/", ("spdlog",)),
    "libuuid":  (r"#\s*include\s*<\s*uuid/uuid\.h", ("uuid",)),
    "glm":      (r"#\s*include\s*<\s*glm/", ("glm",)),
    "opencv":   (r"#\s*include\s*<\s*opencv2/", ("opencv", "OpenCV")),
}


def scan_project(project_root) -> Dict:
    root = Path(project_root).resolve()
    info: Dict = {
        "name": root.name,
        "root": str(root),
        "build_system": "unknown",
        "pro_files": [],
        "cmake_files": [],
        "qrc_files": [],
        "ui_files": [],
        "qt_version_hint": None,
        "qt_modules": [],
        "frameworks": [],
        "kf_components": [],
        "cmake_packages": {"find_package": [], "pkg_check_modules": []},
        "pkg_manifests": {"conan": [], "vcpkg": []},
        "sources": [],
        "language_stats": {},
        "binary_artifacts": [],
        "third_party_hints": [],
        "warnings": [],
        # ---- 综合依赖分析增强 ----
        "find_package_details": [],   # find_package 完整参数（含版本/REQUIRED/组件）
        "toolchain": {},              # cmake/meson 最低版本 / C++ 标准 / 构建工具引用
        "dynamic_loads": [],          # dlopen/QLibrary/QPluginLoader 字面量
        "qmake_libs": [],             # LIBS += -lfoo
        "qmake_pkgconfig": [],        # PKGCONFIG += foo
        "git_submodules": [],         # .gitmodules 条目（自带依赖 + 锁定提交）
        "vendored_dirs": [],          # 3rdparty/ 等自带源码目录
        # ---- 依赖声明全形式检测（第二轮增强）----
        "raw_libs": [],               # 裸链接名（target_link_libraries/find_library/
                                      #   cc.find_library/AC_CHECK_LIB）
        "macos_frameworks": [],       # -framework X
        "fetched_deps": [],           # FetchContent/ExternalProject/CPM 配置期拉取
        "manifest_deps": [],          # 依赖清单函数（require_dep 等）声明的依赖
        "meson_deps": [],             # meson dependency('name', version: ...)
        "meson": {},                  # {version_min, cxx_standard, subprojects}
        "autotools_deps": [],         # PKG_CHECK_MODULES([V],[pkg >= x])
        "env_installs": [],           # CI/脚本 apt/brew/pacman install 的环境依赖
    }

    pro_files, cmake_files = [], []
    meson_files: List[str] = []
    autotools_files: List[str] = []
    sources: List[Dict] = []
    binaries: List[str] = []
    lang_stats: Dict[str, int] = {}

    for path in _walk(root):
        rel = path.relative_to(root).as_posix()
        ext = path.suffix.lower()
        if ext == ".pro" or ext == ".pri":
            pro_files.append(rel)
        elif path.name.lower() in ("cmakelists.txt",) or ext == ".cmake":
            cmake_files.append(rel)
        elif path.name == "meson.build":
            meson_files.append(rel)
        elif path.name in ("configure.ac", "configure.in"):
            autotools_files.append(rel)
        elif ext == ".qrc":
            info["qrc_files"].append(rel)
        elif ext == ".ui":
            info["ui_files"].append(rel)
        elif ext in BINARY_EXTS:
            binaries.append(rel)
        if ext in SOURCE_EXTS and ext not in (".pro", ".pri"):
            try:
                size = path.stat().st_size
            except OSError:
                size = 0
            sources.append({"path": rel, "ext": ext, "size": size})
            lang_stats[ext] = lang_stats.get(ext, 0) + 1

    info["pro_files"] = pro_files
    # 项目自带 .cmake 模块（cmake/Modules 等）与 CMakeLists 一起参与依赖
    # 提取——find_package 常集中在被 include() 的 .cmake 里（如 corpus_d
    # 的 CheckPackages.cmake）
    info["cmake_files"] = cmake_files
    # project() 自身名（供 project_scanner 自引用过滤）
    info["cmake_project_names"] = sorted(
        _cmake_project_names(root, cmake_files))
    info["sources"] = sources
    info["binary_artifacts"] = binaries
    info["language_stats"] = lang_stats

    if pro_files and cmake_files:
        info["build_system"] = "cmake+qmake"
    elif pro_files:
        info["build_system"] = "qmake"
    elif cmake_files:
        info["build_system"] = "cmake"
    elif meson_files:
        info["build_system"] = "meson"
    elif autotools_files:
        info["build_system"] = "autotools"

    modules, qt_version, frameworks, kf_components = _detect_qt(root, info)
    info["qt_modules"] = sorted(modules)
    info["qt_version_hint"] = qt_version
    info["frameworks"] = sorted(frameworks)
    info["kf_components"] = sorted(kf_components)

    info["third_party_hints"] = _detect_third_party(root, sources)

    # 第三方包：CMake find_package/pkg_check_modules + Conan/vcpkg 清单
    info["cmake_packages"] = _detect_cmake_packages(root, info["cmake_files"])
    info["pkg_manifests"] = _detect_pkg_manifests(root)

    # 综合依赖分析增强（deps report 消费）
    info["find_package_details"] = _detect_find_package_details(root, info)
    info["toolchain"] = _detect_toolchain(root, info)
    info["dynamic_loads"] = _detect_dynamic_loads(root, info)
    info["qmake_libs"] = _detect_qmake_libs(root, info)
    info["qmake_pkgconfig"] = _detect_qmake_pkgconfig(root, info)
    info["git_submodules"] = _detect_gitmodules(root)
    info["vendored_dirs"] = _detect_vendored_dirs(root)

    # 依赖声明全形式检测（第二轮增强）
    raw_libs, frameworks_m = _detect_cmake_raw_links(root, info["cmake_files"])
    info["raw_libs"] = raw_libs
    info["macos_frameworks"] = frameworks_m
    info["fetched_deps"] = _detect_fetched_deps(root, info["cmake_files"])
    _cmake_vart = _collect_cmake_vars(root, info["cmake_files"])
    info["wrapper_deps"] = _detect_wrapper_deps(root, info["cmake_files"],
                                                _cmake_vart)
    info["manifest_deps"] = _detect_manifest_deps(root, info["cmake_files"])
    if meson_files:
        _absorb_meson(root, info, meson_files)
    if autotools_files:
        _absorb_autotools(root, info, autotools_files)
    # _walk 跳过 . 开头目录，CI 文件（.github/.ci/顶层 *.sh）需显式收集
    info["env_installs"] = _detect_env_installs(root, _collect_ci_files(root))

    if len(sources) > 4000:
        info["warnings"].append(
            "large project (%d source files); scan may take a while" % len(sources))
    return info


# ---------------------------------------------------------------- internal

def _walk(root: Path):
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            entries = sorted(current.iterdir())
        except (PermissionError, OSError):
            continue
        for entry in entries:
            name = entry.name
            if entry.is_dir():
                if name in EXCLUDE_DIRS or name.startswith("."):
                    continue
                if _BUILD_DIR_RE.match(name):
                    continue
                stack.append(entry)
            elif entry.is_file():
                try:
                    if entry.stat().st_size > MAX_FILE_BYTES:
                        continue
                except OSError:
                    continue
                yield entry


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# Qt 组件列表变量：set(<var> Core Gui ...) / list(APPEND <var> X ...)，
# 供 find_package(Qt6 ... COMPONENTS ${var}) 展开（corpus_b_core 框架 SetupQt6.cmake 形式）
_SET_LISTVAR_RE = re.compile(r"\bset\s*\(\s*(\w+)\s+(.*?)\)", re.S)
_LIST_APPEND_RE = re.compile(r"\blist\s*\(\s*APPEND\s+(\w+)\s+([^)]*)\)", re.S)
_LISTVAR_TOKEN_KW = {"CACHE", "PATH", "STRING", "BOOL", "FILEPATH", "INTERNAL",
                     "FORCE", "ON", "OFF", "REQUIRED"}


def _listvar_tokens(body: str) -> List[str]:
    """set/list(APPEND) 值域里的组件名 token（标识符，剔除关键字/${var}/字面量）。"""
    out = []
    for tok in body.split():
        tok = tok.strip('"\'')
        if (not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", tok)
                or tok.upper() in _LISTVAR_TOKEN_KW):
            continue
        out.append(tok)
    return out


def _collect_list_vars(root: Path, cmake_files: List[str]) -> Dict[str, str]:
    """累积 set(<var> ...) / list(APPEND <var> ...) 的标识符列表值。

    只保留纯标识符 token（Core/Gui/...），版本号/路径/${var}/CACHE 关键字
    全部剔除，因此不会与 _collect_cmake_vars 的字面量变量冲突。
    同一文件内 set() 重置、list(APPEND) 追加；跨文件取并集（同名变量
    在不同作用域各自定义时，并集与扫描顺序无关，避免 sandbox 等
    非主构建目录的声明因目录遍历顺序而遮蔽主声明）。
    """
    union: Dict[str, List[str]] = {}
    for rel in cmake_files:
        text = _read_text(root / rel)
        local: Dict[str, List[str]] = {}
        for m in _SET_LISTVAR_RE.finditer(text):
            toks = _listvar_tokens(m.group(2) or "")
            if toks:
                local[m.group(1)] = list(toks)
        for m in _LIST_APPEND_RE.finditer(text):
            toks = _listvar_tokens(m.group(2) or "")
            if toks:
                local[m.group(1)] = local.get(m.group(1), []) + toks
        for var, toks in local.items():
            merged = union.setdefault(var, [])
            for t in toks:
                if t not in merged:
                    merged.append(t)
    return {var: " ".join(toks) for var, toks in union.items()}


def _detect_qt(root: Path, info: Dict):
    modules = set()
    qt_version = None

    for rel in info["pro_files"]:
        text = _read_text(root / rel)
        for match in _PRO_QT_RE.finditer(text):
            op, names = match.group(1), match.group(2)
            names = names.replace("\\", " ").split()
            for name in names:
                name = name.strip()
                if not name:
                    continue
                if op.startswith("-"):
                    modules.discard(name.lower())
                else:
                    modules.add(name.lower())

    frameworks = set()
    kf_components = set()
    list_vars = _collect_list_vars(root, info["cmake_files"])
    for rel in info["cmake_files"]:
        text = _read_text(root / rel)
        for match in _CMAKE_FINDPKG_QT_RE.finditer(text):
            qt_version = qt_version or match.group(1)
            rest = _subst_vars(match.group(2) or "", list_vars)
            cm = _COMPONENTS_RE.search(rest)
            comps = cm.group(1) if cm else ""
            for comp in re.split(r"\s+", comps) + _orphan_components(rest):
                comp = comp.strip()
                if comp and comp.isalpha() and comp.upper() not in _CMAKE_KW:
                    modules.add(comp.lower())
        for match in _CMAKE_FINDPKG_KF_RE.finditer(text):
            frameworks.add("KF%s" % match.group(1))
            rest = match.group(2) or ""
            cm = _COMPONENTS_RE.search(rest)
            # _COMPONENTS_RE 截取段可能混入后续关键字，需 _CMAKE_KW 过滤；
            # orphan token 已由区域状态机保证不是关键字，不过滤（否则
            # 与 CONFIG 同形的 KF 组件 Config 会被丢弃——gen_c 实证）
            kw_filtered = [c for c in re.split(r"\s+", cm.group(1))
                           if c and c.isalpha()
                           and c.upper() not in _CMAKE_KW] if cm else []
            kf_tokens = kw_filtered + _orphan_components(rest)
            for comp in kf_tokens:
                comp = comp.strip()
                if comp and comp.isalpha():
                    kf_components.add(_KF_ALIAS.get(comp.lower(), comp.lower()))
        for match in _KF_LINK_RE.finditer(text):
            name = match.group(1).lower()
            kf_components.add(_KF_ALIAS.get(name, name))

    # include-based heuristic (also captures modules missed by build files)
    for src in info["sources"]:
        if src["ext"] not in TEXT_SCAN_EXTS:
            continue
        text = _read_text(root / src["path"])
        for match in _INCLUDE_QT_RE.finditer(text):
            whole, mod = match.group(1), match.group(2)
            if mod:
                modules.add(mod.lower())
            elif whole == "Qt":
                modules.add("core")

    modules.discard("")
    if modules and qt_version is None:
        qt_version = "5"  # HarmonyOS Qt currently ships 5.12 / 5.15
    return modules, qt_version, frameworks, kf_components


def _detect_third_party(root: Path, sources: List[Dict]) -> List[Dict]:
    found: Dict[str, List[str]] = {}
    for src in sources:
        if src["ext"] not in TEXT_SCAN_EXTS:
            continue
        if _is_vendored_path(src["path"]):
            continue  # vendored 三方自己的 include 不算应用依赖证据
        text = _read_text(root / src["path"])
        for name, (pattern, _libs) in THIRD_PARTY_HINTS.items():
            if name in found and len(found[name]) >= 3:
                continue
            if re.search(pattern, text):
                found.setdefault(name, []).append(src["path"])
    return [{"name": name, "evidence": files[:5]} for name, files in
            sorted(found.items())]


# CMake 构建模块/工具链，非运行时依赖，find_package 命中时跳过。
# 与 deps_report.CUILD_TOOL_FINDPKG / CMAKE_BUILTIN_PACKAGES 对齐（避免
# 循环导入在两处维护：图侧跳过 + 报告侧归入 build-tool/system-lib 分类）
_FINDPKG_SKIP = {"ecm", "pkgconfig", "pkgconf", "threads", "sharedmimeinfo",
                 "doxygen", "gettext", "intltool", "i18n", "imported_target",
                 "packagehandlestandardargs", "selectlibrary",
                 "pkg_check_modules",
                 # CMake 内置模块（编译器特性 / musl libc 内置）
                 "openmp", "iconv", "dl",
                 # OpenGL：鸿蒙为 OpenGL ES（EGL/GLESv3_ndk 系统能力，
                 # 非 CMake 内置但同样非外部包；报告侧 CMAKE_BUILTIN 分类）
                 "opengl",
                 # 主机构建工具 / VCS（find_package(Git) 是取版本，非链接 git）
                 "git", "subversion", "mercurial", "ccache", "sccache",
                 "cmake", "ninja", "python", "python3", "flex", "bison",
                 "gperf", "linguisttools"}  # noqa: keep explicit


# vendored / 依赖清单目录的路径段：其内的 CMake 声明属于内嵌三方代码自己
# 或依赖引擎的构建逻辑，不是应用自身的直接依赖（e2e corpus_b 复核确认：
# thirdparty/fluidsynth、KDDockWidgets/python 与 corpus_b_deps/recipes 的
# find_package/pkg_check_modules 污染 depth-1 清单）。
# 注：不含 "ext"（过短，误伤正常目录名）；"*_deps" 后缀匹配依赖引擎子模块
# （corpus_b_deps 等 recipes 集合）。
_VENDORED_PATH_SEGS = frozenset({
    "thirdparty", "3rdparty", "third_party", "third-party",
    "vendor", "vendors", "vendored", "external", "extern",
    "deps", "dep", "dependencies", "subprojects",
})


def _is_vendored_path(rel: str) -> bool:
    """相对路径是否位于 vendored 三方/依赖引擎目录内（依赖提取时跳过）。"""
    for seg in rel.lower().replace("\\", "/").split("/")[:-1]:
        if seg in _VENDORED_PATH_SEGS or seg.endswith("_deps"):
            return True
    return False


# wrapper CMake 文件签名：定义 add_library(external_<X> ...) 导入目标
#（cmake_helpers / desktop-app 约定，corpus_a 全部三方库都走这条路）。
# 这类文件不是 vendored 源码，而是应用外部依赖的声明层：其内的
# find_package / pkg_check_modules 就是应用自身的依赖（例：
# cmake/external/openal/CMakeLists.txt 定义 external_openal 并
# find_package(OpenAL REQUIRED)）。submodule 初始化后 external_X 成为
# 项目内目标，若同时跳过 wrapper 文件，真实依赖会被两条规则叠加藏掉
#（corpus_a 复盘：openal/ada/rnnoise 漏检）。
_WRAPPER_TARGET_RE = re.compile(
    r"add_library\s*\(\s*external_[A-Za-z0-9_.:-]+", re.I)


def _is_wrapper_cmake(root: Path, rel: str, text: str) -> bool:
    """vendored 路径下的 wrapper 声明文件（非 vendored 源码，不跳过）。"""
    return bool(_WRAPPER_TARGET_RE.search(text))

# Windows 系统库（qmake win32 块 / MSVC 链接）：鸿蒙不适用（代码通常被
# 平台守卫包裹）。project_scanner 扫描期按它过滤 win32 链接名（防止
# 同名 Unix 库误连边，如 bcrypt→OpenBSD bcrypt）；deps_report 标注而非
# 当作"需源码编译"的缺口
WIN32_SYSTEM_LIBS = {
    "user32", "kernel32", "gdi32", "shell32", "ole32", "oleaut32", "uuid",
    "advapi32", "ws2_32", "mswsock", "winmm", "dsound", "ddraw", "dxgi",
    "d3d9", "d3d11", "dwmapi", "shlwapi", "comctl32", "comdlg32",
    "imm32", "wininet", "winhttp", "crypt32", "secur32", "netapi32",
    "psapi", "version", "iphlfapi", "powrprof", "setupapi", "strmiids",
    "avifil32", "mfplat", "mfuuid", "strmbase", "strmbasd", "wtsapi32",
    "windowsapp", "delayimp", "opengl32", "glu32", "wintrust", "shcore",
    "winscard", "bcrypt", "hid", "winusb", "cfgmgr32",
    # corpus_b_core 实证：OS_IS_WIN 块内 target_link_libraries 的 4 个缺口
    # （同块的 winmm/ole32/shell32/wintrust 等均已往表内）
    "mmdevapi", "msi", "taskschd", "userenv",
    # libgen_g 实证：WIN32 块异常处理/DirectShow（同块 ole32/strmiids
    # /uuid 已在表内）
    "dbghelp", "imagehlp",
}

# find_package 名为构建工具/解释器（主机侧，非应用运行时依赖）。
# project_scanner 用它过滤运行时边（deps_report 也消费，保证两侧口径一致）。
BUILD_TOOL_FINDPKG = {
    "ecm": "extra-cmake-modules（KDE CMake 模块，主机侧）",
    "pkgconfig": "pkg-config（主机侧）",
    "pkgconf": "pkgconf（主机侧 pkg-config 兼容）",
    "gettext": "gettext 工具链（msgfmt/xgettext，主机侧）",
    "intltool": "intltool（主机侧）",
    "doxygen": "Doxygen 文档生成器（主机侧）",
    "sharedmimeinfo": "update-mime-database（主机侧）",
    "cmake": "CMake",
    "ninja": "Ninja 构建器",
    "python3": "Python 3",
    "python": "Python",
    "pythoninterp": "Python 解释器（CMake FindPythonInterp，主机侧）",
    "pythonlibs": "Python 头文件/库（CMake FindPythonLibs，绑定生成，主机侧）",
    "perl": "Perl 解释器（主机侧，测试/代码生成脚本）",
    "swig": "SWIG 绑定生成器（主机侧，libgen_g bindings 实证）",
    "ruby": "Ruby 解释器（绑定生成/脚本，主机侧）",
    "java": "JDK（CMake FindJava，绑定生成，主机侧）",
    "jni": "JNI 头文件（CMake FindJNI，绑定编译，主机侧）",
    "flex": "flex 词法生成器",
    "bison": "bison 语法生成器",
    "gperf": "gperf 完美哈希生成器",
    "git": "git",
    "ccache": "ccache 编译缓存",
    "sccache": "sccache 编译缓存",
    "linguisttools": "Qt Linguist 工具（lupdate/lrelease，随 Qt SDK）",
    "lxqt2-build-tools": "LXQt CMake 构建模块（主机侧，类似 ECM）",
    "lxqt-build-tools": "LXQt CMake 构建模块（主机侧，类似 ECM）",
}


# pkg_check_modules 专属关键字（IMPORTED_TARGET/GLOBAL 等），非模块名
_PKGCHECK_KW = {"IMPORTED_TARGET", "GLOBAL", "STATIC", "SHARED", "MODULE",
                "OPTIONAL", "SKIP_CMAKE_DIRS", "WITHOUT_CMAKE_PACKAGE"}


# ------------------------------------------------------ CMake 选项守卫分析
#
# 背景（e2e corpus_d 复盘）：find_package(Systemd) 位于
# `if (SYSTEMD)` 内，而 SYSTEMD 由 feature_option_dependent(... OFF ...)
# 声明且默认 OFF——该依赖不参与默认构建，不应记为 runtime 依赖。
# 方案：收集 option/feature_option[_dependent]/cmake_dependent_option 的
# 默认值；逐行追踪 if 栈；OFF 默认选项裸守卫（未被 NOT 修饰）内的
# find_package/pkg_check_modules 标记 optional。Find<Name>.cmake 模块
# 文件内的检测继承 find_package(Name) 的 optional 守卫（模块仅在
# 调用时执行，守卫上下文在调用处）。

# option(NAME "doc" [ON|OFF])——无默认值时 CMake 默认 OFF
_OPTION_RE = re.compile(
    r'^\s*option\s*\(\s*(\w+)\s+"(?:[^"\\]|\\.)*"\s*([A-Za-z0-9_${}.]+)?',
    re.M)
# feature_option(NAME "doc" <default>)
_FEATURE_OPTION_RE = re.compile(
    r'^\s*feature_option\s*\(\s*(\w+)\s+"(?:[^"\\]|\\.)*"\s*'
    r'([A-Za-z0-9_${}.]+)',
    re.M)
# feature_option_dependent(NAME "doc" <default> "COND" <fallback>) /
# cmake_dependent_option(同形)：第一个非字符串实参是默认值
_DEPENDENT_OPTION_RE = re.compile(
    r'^\s*(?:feature_option_dependent|cmake_dependent_option)\s*\('
    r'\s*(\w+)\s+"(?:[^"\\]|\\.)*"\s*([A-Za-z0-9_${}.]+)',
    re.M)

_CMAKE_IF_RE = re.compile(r'^\s*if\s*\((.*)\)\s*$', re.I)
_CMAKE_ELSEIF_RE = re.compile(r'^\s*elseif\s*\((.*)\)\s*$', re.I)
_CMAKE_ELSE_RE = re.compile(r'^\s*else\s*\(\s*\)\s*$', re.I)
_CMAKE_ENDIF_RE = re.compile(r'^\s*endif\s*\(\s*\)\s*$', re.I)
_CMAKE_FUNC_RE = re.compile(r'^\s*(?:function|macro)\s*\(', re.I)
_CMAKE_ENDFUNC_RE = re.compile(r'^\s*end(?:function|macro)\b', re.I)
# 条件中被 NOT 修饰的 token：`NOT X` 表示 X 为假时进入，非正向守卫
_NOT_TOKEN_RE = re.compile(r'(?i)\bNOT\s+(\w+)')

# 平台条件 if 帧：其他平台 token（鸿蒙不适用）与 OHOS 兼容 token。
# 帧内声明仅在那些平台构建，默认鸿蒙构建不含 → required=False。
# 同时含两类 token 时不判排除（UNIX AND NOT APPLE 是 OHOS 活跃块）；
# 被 NOT 修饰的 token 不算（NOT WIN32 是 OHOS 活跃块）。
_OTHER_PLATFORM_TOKENS = frozenset({
    "APPLE", "DARWIN", "COCOA", "IOS", "TVOS", "WATCHOS",
    "WIN32", "WINDOWS", "MSVC", "MINGW", "MSYS", "CYGWIN",
    "FREEBSD", "OPENBSD", "NETBSD", "HAIKU", "SOLARIS", "ANDROID",
})
_OHOS_ACTIVE_TOKENS = frozenset({"UNIX", "LINUX", "POSIX", "OHOS",
                                  "HARMONY"})


def _frame_platform_excluded(cond: str) -> Optional[str]:
    """if 条件是否为其他平台专属（鸿蒙不适用）。返回条件串或 None。

    实证：gen_c if(HAIKU) tll network、if(SYSTEM_NAME MATCHES
    "FreeBSD") tll util、gen_b mobile if(ANDROID) tll -lsoftokn3、
    corpus_c FindQREncode if(WIN32 AND NOT MINGW) find_library(qrencoded)。
    """
    stripped = _NOT_TOKEN_RE.sub(" ", cond)
    toks = {t.upper() for t in re.findall(r"\w+", stripped)}
    if not (toks & _OTHER_PLATFORM_TOKENS):
        return None
    if toks & _OHOS_ACTIVE_TOKENS:
        return None
    return cond.strip()


def _cmake_platform_line_map(text: str) -> Dict[int, Optional[str]]:
    """逐行追踪 CMake if 栈，返回 {行号: 内层排除帧的条件串或 None}。

    与 _cmake_optional_line_map 同构：else/elseif 保守不判排除；
    function/macro 体内不判（调用点上下文不可靠）。
    """
    result: Dict[int, Optional[str]] = {}
    stack: List[Optional[str]] = []
    func_depth = 0
    for lineno, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        m = _CMAKE_IF_RE.match(s)
        if m:
            stack.append(_frame_platform_excluded(m.group(1)))
        elif _CMAKE_ELSEIF_RE.match(s) and stack:
            # elseif 分支的条件可直接评估（if(Darwin) ... elseif(Windows)
            # 两分支均为其他平台专属；corpus_d src/base 实证）；
            # 仅 else（补集，含 OHOS）保守不判
            em = _CMAKE_ELSEIF_RE.match(s)
            stack[-1] = _frame_platform_excluded(em.group(1))
        elif _CMAKE_ELSE_RE.match(s) and stack:
            stack[-1] = None
        elif _CMAKE_ENDIF_RE.match(s) and stack:
            stack.pop()
        elif _CMAKE_FUNC_RE.match(s):
            func_depth += 1
        elif _CMAKE_ENDFUNC_RE.match(s) and func_depth:
            func_depth -= 1
        cur = None
        if func_depth == 0:
            for fr in stack:
                if fr:
                    cur = fr
                    break
        result[lineno] = cur
    return result


def _collect_option_defaults(cmake_texts: List[str]) -> Dict[str, bool]:
    """收集 CMake 选项声明的默认值 → {选项名: 默认是否为真}。

    跨文件合并（选项定义与 if 守卫常不在同一文件）；首个定义优先。
    默认值含 ${VAR} 等非字面量时不记录（无法判定）。
    """
    out: Dict[str, bool] = {}
    for rx in (_OPTION_RE, _FEATURE_OPTION_RE, _DEPENDENT_OPTION_RE):
        for text in cmake_texts:
            for m in rx.finditer(text):
                name, val = m.group(1), (m.group(2) or "OFF").upper()
                if name in out:
                    continue
                if val in ("ON", "TRUE", "1"):
                    out[name] = True
                elif val in ("OFF", "FALSE", "0"):
                    out[name] = False
    return out


# 对鸿蒙目标恒真的平台条件（Q_OS_OHOS 隐含 Q_OS_LINUX）：
# 含这些析取项的 if 分支在 OHOS 构建下必然激活，不能标 optional
_PLATFORM_TRUE_DISJUNCTS = frozenset({
    "LINUX", "UNIX", "NOT WIN32", "NOT APPLE", "NOT MSVC", "NOT IOS",
    "NOT MACOS", "NOT WINDOWS",
})
_PLATFORM_TRUE_RE = re.compile(
    r"CMAKE_SYSTEM_NAME\s+(?:STREQUAL|MATCHES)\s+\"?Linux", re.I)


def _disjunct_always_true(d: str) -> bool:
    """单个 OR 析取项对鸿蒙目标是否恒真。"""
    d = d.strip().upper()
    if d in _PLATFORM_TRUE_DISJUNCTS:
        return True
    if _PLATFORM_TRUE_RE.search(d):
        return True
    # 去括号后再试（(NOT WIN32) 形式）
    inner = d.strip("() ").strip()
    return inner in _PLATFORM_TRUE_DISJUNCTS


def _split_top_level_or(cond: str) -> List[str]:
    """按括号外顶层的 OR 切分条件（不处理 AND 混合的复杂嵌套，
    切不开时返回整串，退回旧行为）。"""
    parts, depth, cur, i = [], 0, "", 0
    up = cond.upper()
    while i < len(cond):
        c = cond[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif depth == 0 and up[i:i + 3] == " OR":
            nxt = cond[i:i + 4]
            if nxt[-1] in (" ", "\t") or i + 3 == len(cond):
                parts.append(cur)
                cur = ""
                i += 3
                while i < len(cond) and cond[i] in " \t":
                    i += 1
                continue
        cur += c
        i += 1
    parts.append(cur)
    return parts if len(parts) > 1 else [cond]


def _frame_positively_guarded(cond: str, off_options: Dict[str, bool]) -> bool:
    """if 条件是否含 OFF 默认选项的裸正向引用（未被 NOT 修饰）。

    `if (SYSTEMD)` → True（SYSTEMD 默认 OFF）；
    `if (NOT SYSTEMD)` / `if (DBUS)`（默认 ON）→ False。
    OR 析取语义（corpus_a 复盘）：`if (X OR LINUX)` 在鸿蒙下
    因 LINUX 恒真必然激活，不能标 optional——仅当全部析取项都是
    OFF 选项正向引用（或含 OFF 选项且无恒真项）时才标 optional。
    """
    if not off_options:
        return False
    disjuncts = _split_top_level_or(cond)
    guarded = False
    for d in disjuncts:
        if _disjunct_always_true(d):
            return False
        stripped = _NOT_TOKEN_RE.sub(" ", d)
        for tok in re.findall(r"\w+", stripped):
            if off_options.get(tok) is False:
                guarded = True
    return guarded


def _cmake_optional_line_map(text: str,
                             off_options: Dict[str, bool]) -> Dict[int, bool]:
    """逐行追踪 CMake if 栈，返回 {行号: 是否处于 OFF 默认选项守卫内}。

    - 任一活动 if 帧正向守卫 OFF 默认选项 → 帧内代码默认不参与构建；
    - else/elseif 分支保守视为不守卫（可能含回退逻辑）；
    - function/macro 体内的声明在调用点生效，守卫上下文不可靠 → 不标记。
    """
    result: Dict[int, bool] = {}
    stack: List[bool] = []   # 每帧：是否 OFF 选项正向守卫
    func_depth = 0
    for lineno, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        if _CMAKE_IF_RE.match(s):
            stack.append(_frame_positively_guarded(
                _CMAKE_IF_RE.match(s).group(1), off_options))
        elif _CMAKE_ELSEIF_RE.match(s) and stack:
            stack[-1] = False   # 保守：else/elseif 分支不判定为守卫
        elif _CMAKE_ELSE_RE.match(s) and stack:
            stack[-1] = False
        elif _CMAKE_ENDIF_RE.match(s) and stack:
            stack.pop()
        elif _CMAKE_FUNC_RE.match(s):
            func_depth += 1
        elif _CMAKE_ENDFUNC_RE.match(s) and func_depth:
            func_depth -= 1
        result[lineno] = (func_depth == 0 and any(stack))
    return result


def _cmake_guard_context(root: Path,
                         cmake_files: List[str]) -> Dict[str, Dict[int, bool]]:
    """构建 {文件: {行号: optional 守卫}} 上下文（选项默认值跨文件合并）。"""
    texts = {rel: _read_text(root / rel) for rel in cmake_files}
    option_defaults = _collect_option_defaults(list(texts.values()))
    off_options = {k: v for k, v in option_defaults.items() if v is False}
    return {rel: _cmake_optional_line_map(text, off_options)
            for rel, text in texts.items()}


def _find_module_optional_files(cmake_files: List[str],
                                optional_names: set) -> set:
    """Find<Name>.cmake 模块文件（Name 的 find_package 被 optional 守卫时
    整个模块继承 optional——模块内的 pkg_check_modules 只在调用时执行）。"""
    if not optional_names:
        return set()
    wanted = {"find%s.cmake" % n for n in optional_names}
    return {rel for rel in cmake_files
            if Path(rel).name.lower() in wanted}


def _cmake_project_names(root: Path, cmake_files: List[str]) -> set:
    """根 CMakeLists.txt 的 project() 项目名（小写）：
    find_package(<自身项目名>) 是自引用（如 gen_j 插件样例
    find_package(gen_j REQUIRED)），不是外部依赖（曾误解析到
    同名无关包 cmdpkgs:gen_j）。

    只收根目录 CMakeLists.txt：vendored 子目录里
    project(fakevim)（gen_f src/libraries 布局）声明的是子项目
    自己的名字，其存在不代表宿主 find_package(fakevim) 是自引用。
    """
    names = set()
    rx = re.compile(r"\bproject\s*\(\s*([A-Za-z][A-Za-z0-9_-]*)")
    for rel in cmake_files:
        if Path(rel).parts[:-1] or Path(rel).name != "CMakeLists.txt":
            continue          # 仅根 CMakeLists.txt
        for m in rx.finditer(_read_text(root / rel)):
            names.add(m.group(1).lower())
    return names


def _detect_cmake_packages(root: Path, cmake_files: List[str]) -> Dict:
    """从 CMake 中提取第三方包：find_package(*) 和 pkg_check_modules。

    Qt/KF 已由 _detect_qt 专门处理，这里只返回其它包。
    返回 {find_package: [必需名...], find_package_optional: [可选名...],
          pkg_check_modules: [必需名...], pkg_check_modules_optional: [...],
          pkg_modules: [{name, version_req, optional?}...]}（含版本约束）。

    optional = 声明点位于 OFF 默认 CMake 选项的 if 守卫内（默认构建不含）。
    同一包既有 optional 又有必需声明点时，必需优先（保守）。
    """
    findpkgs, pkgmods = set(), set()
    findpkgs_opt, pkgmods_opt = set(), set()
    findpkgs_plat, pkgmods_plat = set(), set()
    pkg_details: Dict[str, Dict] = {}
    vart = _collect_cmake_vars(root, cmake_files)
    guards = _cmake_guard_context(root, cmake_files)
    skip_prefixes = ("qt", "kf")
    # project() 自身名：find_package(<项目名>) 是自引用，跳过
    self_names = _cmake_project_names(root, cmake_files)

    def _line_of(text: str, pos: int) -> int:
        return text.count("\n", 0, pos) + 1

    # pass 1: find_package（先收集，供 Find<Name>.cmake 模块继承判定）
    for rel in cmake_files:
        text = _strip_cmake_comments(_read_text(root / rel))
        text = _strip_cmake_comments(_read_text(root / rel))
        if _is_vendored_path(rel):
            if not _is_wrapper_cmake(root, rel, text):
                continue
            # wrapper 文件：external_X 被应用无条件链接，内部守卫
            # （DESKTOP_APP_USE_PACKAGED 等）只切换获取方式（find_package
            # vs 预编译路径），不是是否使用 → 不套 optional 守卫
            gmap = {}
        else:
            gmap = guards.get(rel, {})
        pmap = _cmake_platform_line_map(text)
        for m in _FINDPKG_ANY_RE.finditer(text):
            name = m.group(1).lower()
            if (name.startswith(skip_prefixes) or name in _CMAKE_KW
                    or name in _FINDPKG_SKIP
                    or name in self_names
                    or name.replace(".", "").isdigit()):
                continue
            if gmap.get(_line_of(text, m.start())):
                findpkgs_opt.add(name)
            elif pmap.get(_line_of(text, m.start())):
                findpkgs_plat.add(name)
            else:
                findpkgs.add(name)

    # Find<Name>.cmake 模块文件：其内全部检测继承 optional 守卫
    opt_files = _find_module_optional_files(
        cmake_files, findpkgs_opt - findpkgs)

    # pass 2: pkg_check_modules
    for rel in cmake_files:
        text = _strip_cmake_comments(_read_text(root / rel))
        text = _strip_cmake_comments(_read_text(root / rel))
        if _is_vendored_path(rel):
            if not _is_wrapper_cmake(root, rel, text):
                continue
            gmap = {}   # wrapper：同 pass 1，不套 optional 守卫
        else:
            gmap = guards.get(rel, {})
        pmap = _cmake_platform_line_map(text)
        file_opt = (rel in opt_files) and not _is_vendored_path(rel)
        for m in _PKGCHECK_RE.finditer(text):
            line_opt = file_opt or gmap.get(_line_of(text, m.start()))
            line_plat = pmap.get(_line_of(text, m.start()))
            # pkg-config spec 可带版本约束："glib-2.0 >= 2.50" / glib-2.0>=2.50
            # 替换 set() 变量；无法解析的 ${宏参} 整体剔除，避免混入包名
            specs = _subst_vars(m.group(1), vart).replace("\\\n", " ")
            specs = re.sub(r"\$\{\w+\}", " ", specs)
            _absorb_pkg_spec(specs, pkg_details, optional=line_opt,
                             platform=line_plat)
            for tok in _PKGCONF_NAME_RE.findall(specs):
                tok = tok.lower()
                if (tok.upper() in _CMAKE_KW or tok in _FINDPKG_SKIP
                        or tok.upper() in _PKGCHECK_KW
                        or tok.startswith(("qt", "kf"))
                        or tok.replace(".", "").isdigit()):
                    continue
                if line_opt:
                    pkgmods_opt.add(tok)
                    pkg_details.setdefault(
                        tok, {"name": tok, "version_req": None,
                              "optional": True})
                elif line_plat:
                    pkgmods_plat.add(tok)
                    pkg_details.setdefault(
                        tok, {"name": tok, "version_req": None,
                              "platform": line_plat})
                else:
                    pkgmods.add(tok)
                    pkg_details.setdefault(tok, {"name": tok,
                                                 "version_req": None})

    # 必需优先：同一包 optional/platform 声明点与必需声明点并存时按必需处理
    findpkgs_opt -= findpkgs
    pkgmods_opt -= pkgmods
    findpkgs_plat -= findpkgs
    pkgmods_plat -= pkgmods
    for name in pkgmods:
        d = pkg_details.get(name)
        if d:
            d.pop("optional", None)
            d.pop("platform", None)
    # 带约束的 spec 覆盖裸名（保留版本要求；platform 块内的 spec
    # 归入 pkgmods_plat，不入必需名单）
    pkgmods.update(k for k, d in pkg_details.items()
                   if not d.get("optional") and not d.get("platform"))
    pkgmods_opt.update(k for k, d in pkg_details.items()
                       if d.get("optional"))
    pkgmods_plat.update(k for k, d in pkg_details.items()
                        if d.get("platform") and not d.get("optional")
                        and k not in pkgmods)
    pkgmods_plat -= pkgmods
    return {"find_package": sorted(findpkgs),
            "find_package_optional": sorted(findpkgs_opt),
            "find_package_platform": sorted(findpkgs_plat),
            "pkg_check_modules": sorted(pkgmods),
            "pkg_check_modules_optional": sorted(pkgmods_opt),
            "pkg_check_modules_platform": sorted(pkgmods_plat),
            "pkg_modules": sorted(pkg_details.values(),
                                  key=lambda d: d["name"])}


_PKG_SPEC_VER_RE = re.compile(
    r"([A-Za-z0-9][A-Za-z0-9._+-]*)\s*(>=|<=|==|=|<|>|!=)\s*([0-9][\w.]*)")


def _absorb_pkg_spec(spec: str, out: Dict[str, Dict],
                     optional: bool = False,
                     platform: Optional[str] = None) -> None:
    """吸收一条 pkg-config spec（可含版本约束）到 out。"""
    m = _PKG_SPEC_VER_RE.search(spec)
    if not m:
        return
    name = m.group(1).lower()
    out[name] = {"name": name,
                 "version_req": "%s %s" % (m.group(2), m.group(3))}
    if optional:
        out[name]["optional"] = True
    elif platform:
        out[name]["platform"] = platform


def _detect_pkg_manifests(root: Path) -> Dict:
    """解析 Conan / vcpkg 清单，获取精确的包名+版本+传递依赖。

    返回 {conan: [{name, version?}], vcpkg: [names]}。
    """
    conan = []
    vcpkg = []
    # conanfile.txt [requires] 段
    for rel in ("conanfile.txt",):
        p = root / rel
        if p.is_file():
            in_requires = False
            for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
                s = line.strip()
                if s.startswith("["):
                    in_requires = s.lower().startswith("[requires]")
                    continue
                if in_requires and s and not s.startswith("#"):
                    m = _CONAN_TXT_REQ_RE.match(s)
                    if m:
                        conan.append({"name": m.group(1),
                                      "version": m.group(2)})
    # conanfile.py requires 列表
    for rel in ("conanfile.py",):
        p = root / rel
        if p.is_file():
            for m in _CONAN_PY_REQ_RE.finditer(
                    p.read_text(encoding="utf-8", errors="replace")):
                conan.append({"name": m.group(1),
                              "version": m.group(2)})
    # vcpkg.json dependencies
    for rel in ("vcpkg.json",):
        p = root / rel
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8", errors="replace"))
                for dep in data.get("dependencies", []):
                    if isinstance(dep, str):
                        vcpkg.append({"name": dep})
                    elif isinstance(dep, dict) and "name" in dep:
                        ver = (dep.get("version>=") or dep.get("version==")
                               or dep.get("version"))
                        vcpkg.append({"name": dep["name"], "version": ver})
            except json.JSONDecodeError:
                pass
    # conan.lock 精确版本
    conan_lock = root / "conan.lock"
    if conan_lock.is_file():
        try:
            lock = json.loads(conan_lock.read_text(encoding="utf-8", errors="replace"))
            seen = {c["name"] for c in conan}
            for ref in lock.get("requires", []):
                if isinstance(ref, str) and "/" in ref:
                    name, ver = ref.split("/", 1)
                    if name not in seen:
                        conan.append({"name": name, "version": ver})
                        seen.add(name)
        except (json.JSONDecodeError, AttributeError):
            pass
    return {"conan": conan,
            "vcpkg": sorted(vcpkg, key=lambda d: d["name"])}


# ------------------------------------------------ 综合依赖分析增强


def _looks_like_host_tool(tok: str) -> bool:
    """token 是否为已知主机构建工具名（或命中特征后缀）。"""
    t = tok.strip("\"'")
    if not t or t != t.strip() or "$" in t:
        return False
    if t in KNOWN_HOST_TOOLS:
        return True
    return t.endswith(_HOST_TOOL_SUFFIXES) or t.startswith("glib-")


def _parse_findpkg_args(name: str, rest: str, rel: str,
                        line: int) -> Dict:
    """解析 find_package(<Name> [ver] [REQUIRED] [COMPONENTS ...]
    [OPTIONAL_COMPONENTS ...]) 参数。"""
    tokens = rest.replace("\\\n", " ").split()
    version = None
    required = False
    exact = False
    components: List[str] = []
    optional_components: List[str] = []
    mode = None
    seen_kw = False    # 已过版本/关键字位置（其后的裸名是组件）
    seen_comp = False  # 已开始收集组件：后续裸名均为组件，不再按关键字
                        # 解释（KF 组件名 Config 与 CONFIG 同形，gen_c 实证）
    for tok in tokens:
        tok2 = tok.strip('"')
        up = tok2.upper()
        if up == "COMPONENTS":
            mode = "c"
            seen_kw = True
            continue
        if up == "OPTIONAL_COMPONENTS":
            mode = "o"
            seen_kw = True
            continue
        if not seen_comp and up in _FP_KW:
            if up == "REQUIRED":
                required = True
            elif up == "EXACT":
                exact = True
            mode = None
            seen_kw = True
            continue
        if version is None and re.fullmatch(r"\d+(\.\d+)*", tok2):
            # 版本可带引号：find_package(Poppler "24.08.0" ...)（gen_b）
            version = tok2
            seen_kw = True
            continue
        if "${" in tok or "$ENV" in tok:
            mode = None
            seen_kw = True
            continue
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", tok2):
            continue
        if mode == "o":
            optional_components.append(tok2)
        elif seen_kw or mode == "c":
            # CMake 语义：版本/关键字之后的裸名即组件，无需 COMPONENTS
            # 关键字（gen_c: find_package(Qt6 ${V} CONFIG REQUIRED\n Core ...)）
            components.append(tok2)
            mode = "c"
            seen_comp = True
    return {"name": name, "name_lower": name.lower(), "version": version,
            "required": required, "exact": exact,
            "components": components, "optional_components": optional_components,
            "file": rel, "line": line}


# 自定义依赖包装函数：function/macro(...pkg_check_modules(${pkg} ${arg_PACKAGE})...)
# 形式的间接声明，调用处 search_dependency(NAME PACKAGE <pkg名> ...) 提取
_FUNC_DEF_RE = re.compile(r"^\s*(?:function|macro)\s*\(\s*(\w+)", re.M)
_WRAP_PACKAGE_RE = re.compile(r"\bPACKAGE\s+\"?([A-Za-z0-9_.+-]+)\"?")
_WRAP_LIBRARY_RE = re.compile(r"\bLIBRARY\s+\"?([A-Za-z0-9_.+-]+)\"?")
_WRAP_MINVER_RE = re.compile(r"MINIMUM_VERSION\s+(?:\$\{(\w+)\}|\"?([\w.]+)\"?)")
_WRAP_FRAMEWORK_RE = re.compile(r"\bFRAMEWORK\s+\"?([A-Za-z0-9_]+)\"?")


def _detect_wrapper_deps(root: Path, cmake_files: List[str],
                         vart: Dict[str, str]) -> List[Dict]:
    """项目自定义包装函数（如 gen_n 的 search_dependency）里的依赖声明。

    识别条件：函数名由项目 function()/macro() 定义，且调用参数中带
    PACKAGE <pkg-config 名> / LIBRARY <库名> / MINIMUM_VERSION <版本> /
    FRAMEWORK <macOS 框架> 关键字。返回包装出的依赖清单。
    """
    texts = {rel: _read_text(root / rel) for rel in cmake_files}
    funcs: set = set()
    for text in texts.values():
        for m in _FUNC_DEF_RE.finditer(text):
            funcs.add(m.group(1))
    if not funcs:
        return []
    out: List[Dict] = []
    seen: set = set()
    for rel, text in texts.items():
        if _is_vendored_path(rel):
            continue  # 依赖引擎/内嵌三方目录内的调用不是应用依赖
        for fn in sorted(funcs):
            for cm in re.finditer(r"\b%s\s*\(([^)]*)\)" % re.escape(fn), text):
                args = _strip_cmake_comments(cm.group(1))
                pm = _WRAP_PACKAGE_RE.search(args)
                if not pm:
                    continue
                name = pm.group(1)
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                vm = _WRAP_MINVER_RE.search(args)
                version = None
                if vm:
                    version = (vart.get(vm.group(1)) if vm.group(1)
                               else vm.group(2))
                lm = _WRAP_LIBRARY_RE.search(args)
                fm = _WRAP_FRAMEWORK_RE.search(args)
                out.append({
                    "name": name, "wrapper": fn,
                    "library": lm.group(1) if lm else None,
                    "framework": fm.group(1) if fm else None,
                    "version": version, "evidence": [rel]})
    return out


# 依赖清单函数名（corpus_b_deps 引擎等）：require_dep(name [STATIC|SYSTEM|REBUILD]) /
# require_source_dep(name)（源码自带）/ require_tool(name)（主机构建工具）。
# 要求函数在项目扫描到的 CMake 中有 function()/macro() 定义（避免同名普通
# 调用误匹配），首个参数为依赖名。
_MANIFEST_FN_RE = re.compile(
    r"(?i)^(?:require|add|use|need)[_-]?"
    r"(?:source[_-]?)?(?:dep|deps|dependency|dependencies|tool|package)s?$")
_MANIFEST_ARG_KW = {"STATIC", "SYSTEM", "REBUILD", "REQUIRED", "OPTIONAL",
                    "ON", "OFF"}


def _detect_manifest_deps(root: Path, cmake_files: List[str]) -> List[Dict]:
    """自定义依赖清单函数的调用（如 corpus_b_deps 引擎的 require_dep）。

    返回 [{name, mode(link|source|tool), conditional, condition,
           evidence: [file:line]}]。函数定义可位于依赖引擎子模块
    （vendored 路径），但只扫描应用侧文件里的调用。
    """
    texts = {rel: _read_text(root / rel) for rel in cmake_files}
    funcs = {m.group(1) for text in texts.values()
             for m in _FUNC_DEF_RE.finditer(text)
             if _MANIFEST_FN_RE.match(m.group(1))}
    if not funcs:
        return []
    out: List[Dict] = []
    seen: set = set()
    for rel, raw in texts.items():
        if _is_vendored_path(rel):
            continue
        text = _strip_cmake_comments(raw)
        # 轻量 if/endif 追踪：记录调用是否位于条件块内（不求值，仅标注）。
        # events: [(pos, cond)]，cond 为 if 条件文本，endif 为 None
        events = [(m.start(), m.group(1)) for m in re.finditer(
            r"(?im)^\s*(?:if\s*\((.*?)\)|endif\b)", text)]
        for fn in sorted(funcs, key=len, reverse=True):
            for cm in re.finditer(
                    r"\b%s\s*\(\s*([A-Za-z0-9_][A-Za-z0-9_.+-]*)"
                    % re.escape(fn), text):
                name = cm.group(1)
                if name.upper() in _MANIFEST_ARG_KW or name.startswith("$"):
                    continue
                fnl = fn.lower()
                mode = ("tool" if "tool" in fnl
                        else "source" if "source" in fnl else "link")
                key = (mode, name.lower())
                if key in seen:
                    continue
                seen.add(key)
                # 调用点之前重建 if 栈，取栈顶为所在条件
                stack: List[str] = []
                for pos, cond in events:
                    if pos >= cm.start():
                        break
                    if cond is None:
                        if stack:
                            stack.pop()
                    else:
                        stack.append(cond.strip())
                cond = stack[-1] if stack else None
                line = text.count("\n", 0, cm.start()) + 1
                out.append({"name": name, "mode": mode,
                            "conditional": cond is not None,
                            "condition": cond,
                            "evidence": ["%s:%d" % (rel, line)]})
    return out


def _collect_cmake_vars(root: Path, cmake_files: List[str]) -> Dict[str, str]:
    """收集 set(<var> <字面量>) 定义的简单变量（版本号等），供
    find_package(${var}) 的版本解析做近似替换（忽略 CMake 作用域）。"""
    vart: Dict[str, str] = {}
    for rel in cmake_files:
        for m in re.finditer(r"^\s*set\s*\(\s*(\w+)\s+\"?([\w.]+)\"?\s*\)",
                             _read_text(root / rel), re.M):
            vart.setdefault(m.group(1), m.group(2))
    return vart


def _subst_vars(text: str, vart: Dict[str, str]) -> str:
    """把 ${var} 替换为 set() 表中的字面量值；未知变量原样保留。"""
    return re.sub(r"\$\{(\w+)\}",
                  lambda m: vart.get(m.group(1), m.group(0)), text)


def _detect_find_package_details(root: Path, info: Dict) -> List[Dict]:
    """提取全部 find_package 调用的完整参数（跨行），含 Qt/KF 调用。

    附 optional 标志（OFF 默认选项守卫内的声明，默认构建不含）。
    """
    vart = _collect_cmake_vars(root, info["cmake_files"])
    guards = _cmake_guard_context(root, info["cmake_files"])
    self_names = _cmake_project_names(root, info["cmake_files"])
    out: List[Dict] = []
    for rel in info["cmake_files"]:
        if _is_vendored_path(rel):
            continue
        text = _strip_cmake_comments(_read_text(root / rel))
        gmap = guards.get(rel, {})
        pmap = _cmake_platform_line_map(text)
        for m in _FINDPKG_FULL_RE.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            detail = _parse_findpkg_args(m.group(1),
                                         _subst_vars(m.group(2) or "", vart),
                                         rel, line)
            if detail["name"].lower() in self_names:
                continue    # project() 自引用（如 gen_j 插件样例）
            if gmap.get(line):
                detail["optional"] = True
            elif pmap.get(line):
                detail["platform"] = pmap.get(line)
            out.append(detail)
    return out


def _detect_toolchain(root: Path, info: Dict) -> Dict:
    """主机构建工具链要求：cmake 最低版本 / C++ 标准 / 工具引用 / 测试设施。

    工具引用来源：find_program 参数 + execute_process/add_custom_command
    的 COMMAND 首 token（仅记已知工具名或命中特征后缀的工具，避免噪音）。
    """
    tools: Dict[str, List[str]] = {}

    def add(tool: str, how: str) -> None:
        tools.setdefault(tool, [])
        if how not in tools[tool]:
            tools[tool].append(how)

    cmake_min = None
    cxx_std = None
    has_testing = False
    for rel in info["cmake_files"]:
        text = _read_text(root / rel)
        m = _CMAKE_MIN_RE.search(text)
        if m:
            v = m.group(1).rstrip(".")
            if cmake_min is None or _ver_key(v) > _ver_key(cmake_min):
                cmake_min = v
        for rx in (_CXX_STD_RE, _CXX_STD_PROP_RE):
            m = rx.search(text)
            if m:
                v = int(m.group(1))
                if cxx_std is None or v > cxx_std:
                    cxx_std = v
        if _ENABLE_TESTING_RE.search(text) or _ADD_TEST_RE.search(text):
            has_testing = True
        for pm in _FINDPROG_RE.finditer(text):
            for tok in pm.group(1).split():
                t = tok.strip('"')
                if not t or "$" in t or t.upper() in _FP_KW:
                    continue
                # 第一个纯大写 token 是接收变量名，跳过
                if t == t.upper():
                    continue
                if _looks_like_host_tool(t):
                    add(t, "%s: find_program" % rel)
        for cm in _COMMAND_TOKEN_RE.finditer(text):
            t = cm.group(1).strip('"')
            if "$" in t:
                continue
            if _looks_like_host_tool(t):
                add(t, "%s: COMMAND" % rel)
    for rel in info["pro_files"]:
        text = _read_text(root / rel)
        for m in _QMAKE_CXX_RE.finditer(text):
            v = int(m.group(1) or m.group(2))
            if cxx_std is None or v > cxx_std:
                cxx_std = v
    return {"cmake_min": cmake_min, "cxx_standard": cxx_std,
            "tools": tools, "has_testing": has_testing}


def _ver_key(v):
    """版本号 → 可比较元组（'1.2.3b' → (1,2,3)）。"""
    if not v:
        return ()
    parts = re.findall(r"\d+", str(v))
    return tuple(int(p) for p in parts)


# 平台宏分类（用于宏栈追踪）
NON_OHOS_PLATFORM_MACROS = {
    "_WIN32", "WIN32", "_WIN64", "Q_OS_WIN", "Q_OS_WIN32", "Q_OS_WINRT",
    "__APPLE__", "Q_OS_MAC", "Q_OS_MACOS", "Q_OS_MACX", "Q_OS_DARWIN",
    "__MACH__", "Q_OS_AIX", "Q_OS_SOLARIS", "Q_OS_BSD", "Q_OS_FREEBSD",
    "Q_OS_ANDROID", "Q_OS_IOS", "Q_OS_TVOS", "Q_OS_WATCHOS",
    "Q_OS_QNX", "Q_OS_VXWORKS", "Q_OS_INTEGRITY",
}
OHOS_OR_GENERAL_MACROS = {
    "Q_OS_LINUX", "__linux__", "linux", "Q_OS_UNIX", "Q_OS_OHOS",
    "Q_OS_POSIX", "_POSIX_SOURCE", "__USE_POSIX",
}
# 功能宏（由 CMake/qmake 注入）保守视为"可能在鸿蒙编译"
FEATURE_MACROS = {
    "HAVE_X11", "USE_DBUS", "USE_PULSEAUDIO", "USE_ALSA", "USE_COREAUDIO",
    "HAVE_DBUS", "HAVE_ALSA", "HAVE_PULSEAUDIO", "HAVE_SYSTEMD",
    "USE_OPENGL", "HAVE_OPENGL", "PLATFORM_LINUX", "PLATFORM_OHOS",
}

_IFDEF_RE = re.compile(r"#\s*ifdef\s+(\w+)")
_IFNDEF_RE = re.compile(r"#\s*ifndef\s+(\w+)")
_IF_DEFINED_RE = re.compile(r"#\s*if\s+(.+)$")
_DEFINED_RE = re.compile(r"defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)")
_ELSE_RE = re.compile(r"#\s*else\b")
_ELIF_RE = re.compile(r"#\s*elif\s+(.+)$")
_ENDIF_RE = re.compile(r"#\s*endif\b")


def _extract_defined_macros(expr: str) -> List[str]:
    """从 #if 表达式中提取 defined(X) 宏名。"""
    return [m[0] or m[1] for m in _DEFINED_RE.findall(expr)]


def _macro_compiles_on_ohos(macro: str) -> bool:
    """单个宏在鸿蒙构建时是否为真（保守估计）。

    - 鸿蒙/通用宏 → True（确定为真或保守视为真）
    - 非鸿蒙平台宏 → False（确定为假）
    - 未知宏 → True（保守，可能由构建系统注入）
    """
    if macro in NON_OHOS_PLATFORM_MACROS:
        return False
    return True  # ohos/general/feature/unknown 都保守视为真


def _expr_compiles_on_ohos(expr: str) -> Optional[bool]:
    """对 #if/#elif 表达式做粗略求值，判断在鸿蒙是否为真。

    仅处理 defined(X) 与 && / || / ! 的组合；无法解析时返回 None（保守视为真）。
    """
    # 提取所有 defined(X) → 布尔值
    def repl(m):
        name = m.group(1) or m.group(2)
        return "1" if _macro_compiles_on_ohos(name) else "0"
    simplified = _DEFINED_RE.sub(repl, expr)
    # 也处理裸宏名（如 #if Q_OS_WIN）——保守视为宏名即条件
    for tok in re.findall(r"\b[A-Z_]\w*\b", simplified):
        if tok in ("1", "0", "defined", "true", "false"):
            continue
        simplified = simplified.replace(tok,
            "1" if _macro_compiles_on_ohos(tok) else "0")
    try:
        # 用 Python 求值（&& → and, || → or, ! → not）
        py = simplified.replace("&&", " and ").replace("||", " or ")
        py = re.sub(r"!(?=[01(])", " not ", py)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return bool(eval(py, {"__builtins__": {}}, {}))
    except Exception:
        return None


def _guard_status(active_macros: List[str]) -> str:
    """根据活动宏判断接口命中行的编译守卫状态（遗留兼容接口）。

    注意：#if 表达式可能是 AND/OR 混合，无法精确求值。
    新代码应使用帧级 compiles_on_ohos 追踪，此函数仅保留用于简单场景。
    """
    if not active_macros:
        return "unconditional"
    if all(m in NON_OHOS_PLATFORM_MACROS for m in active_macros):
        return "platform-excluded"
    return "ohos-active"


def _macro_stack_status(text: str) -> Dict[int, str]:
    """逐行宏栈追踪，返回 {line_no: guard_status}。

    每个栈帧记录 (compiles_on_ohos: Optional[bool])。
    行的编译状态 = 所有帧 compiles_on_ohos 的 AND：
      - 任意帧为 False → platform-excluded（确定不编译）
      - 所有帧为 True → ohos-active（确定编译）
      - 含 None（无法判断）→ ohos-active（保守）
      - 无帧 → unconditional
    """
    result: Dict[int, str] = {}
    # 栈元素: compiles_on_ohos (True/False/None)
    stack: List[Optional[bool]] = []

    def current_guard() -> str:
        if not stack:
            return "unconditional"
        if any(f is False for f in stack):
            return "platform-excluded"
        return "ohos-active"

    for lineno, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        # 快路径：绝大多数行不是预处理指令，不影响宏栈
        if not s.startswith("#"):
            result[lineno] = current_guard()
            continue
        m = _IFDEF_RE.match(s)
        if m:
            stack.append(_macro_compiles_on_ohos(m.group(1)))
            result[lineno] = current_guard()
            continue
        m = _IFNDEF_RE.match(s)
        if m:
            # ifndef MACRO: 在鸿蒙编译当且仅当 MACRO 在鸿蒙为假
            val = _macro_compiles_on_ohos(m.group(1))
            stack.append(None if val is None else (not val))
            result[lineno] = current_guard()
            continue
        m = _IF_DEFINED_RE.match(s)
        if m:
            stack.append(_expr_compiles_on_ohos(m.group(1)))
            result[lineno] = current_guard()
            continue
        if _ELSE_RE.match(s) and stack:
            val = stack[-1]
            stack[-1] = None if val is None else (not val)
            result[lineno] = current_guard()
            continue
        m = _ELIF_RE.match(s)
        if m and stack:
            stack[-1] = _expr_compiles_on_ohos(m.group(1))
            result[lineno] = current_guard()
            continue
        if _ENDIF_RE.match(s) and stack:
            stack.pop()
            result[lineno] = current_guard()
            continue
        result[lineno] = current_guard()
    return result



def _detect_dynamic_loads(root: Path, info: Dict) -> List[Dict]:
    """源码中的运行时动态加载目标（仅字符串字面量，变量拼接无法静态确定）。

    非鸿蒙平台守卫（#if defined(Q_OS_WIN) 等）内的加载不编译，
    不计入（gen_h 复盘：singleapplication.cpp 的 QLibrary("kernel32")
    在 Q_OS_WIN 块内被误报为运行时动态加载）。
    """
    targets: Dict[str, List[str]] = {}
    # 子串预过滤：三个目标 API 名至少出现一个才跑正则（大仓库实测占
    # 扫描总耗时 1/3，多数文件不含任何动态加载）；宏栈追踪同样仅对
    # 预过滤命中的稀有文件执行，不损性能
    prefilter = ("dlopen", "QLibrary", "QPluginLoader")
    for src in info["sources"]:
        if src["ext"] not in TEXT_SCAN_EXTS:
            continue
        text = _read_text(root / src["path"])
        if not any(k in text for k in prefilter):
            continue
        guard = _macro_stack_status(text)
        for rx, how in ((_DLOPEN_RE, "dlopen"), (_QLIBRARY_RE, "QLibrary"),
                        (_QPLUGINLOADER_RE, "QPluginLoader")):
            for m in rx.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                if guard.get(line) == "platform-excluded":
                    continue
                t = m.group(1).strip()
                if not t or "$" in t or "://" in t or t.startswith("/"):
                    continue
                targets.setdefault(t, []).append("%s (%s)" % (src["path"], how))
    return [{"name": t, "how": hows[:3]} for t, hows in sorted(targets.items())]


def _detect_qmake_libs(root: Path, info: Dict) -> List[Dict]:
    """qmake LIBS += -lfoo 的目标侧链接库。"""
    libs: Dict[str, List[str]] = {}
    for rel in info["pro_files"]:
        for m in _QMAKE_LIBS_RE.finditer(_read_text(root / rel)):
            for lm in _QMAKE_LINK_FLAG_RE.finditer(m.group(1)):
                libs.setdefault(lm.group(1), []).append(rel)
    return [{"name": n, "evidence": ev[:3]} for n, ev in sorted(libs.items())]


def _detect_gitmodules(root: Path) -> List[Dict]:
    """.gitmodules：vendored 依赖（submodule 锁定到具体提交）。"""
    p = root / ".gitmodules"
    if not p.is_file():
        return []
    mods: List[Dict] = []
    cur: Dict = {}

    def flush():
        if cur.get("path") or cur.get("url"):
            mods.append(cur)

    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if s.startswith("[submodule"):
            flush()
            nm = re.search(r'"(.*)"', s)
            cur = {"name": nm.group(1) if nm else ""}
        elif "=" in s and cur:
            k, v = (x.strip() for x in s.split("=", 1))
            cur[k] = v
    flush()
    return mods


def _detect_vendored_dirs(root: Path) -> List[str]:
    """3rdparty/ 等自带源码目录（根目录与一级子目录范围内识别）。"""
    out = set()
    bases = [root] + [p for p in root.iterdir()
                      if p.is_dir() and not p.name.startswith(".")]
    for base in bases:
        for name in VENDORED_DIR_NAMES:
            d = base / name
            if not d.is_dir():
                continue
            # 至少含一个子目录或构建文件，才算 vendored 依赖集合
            if any(s.is_dir() for s in d.iterdir()) or (d / "CMakeLists.txt").is_file():
                out.add(d.relative_to(root).as_posix())
    return sorted(out)


# ------------------------------------------------ 依赖声明全形式检测（第二轮）


def _norm_lib_name(name: str) -> str:
    """裸链接名归一：去掉 .lib/.so/.a/.dylib 等文件后缀。"""
    return re.sub(r"\.(lib|so|a|dylib)(\.\d+)*$", "", name)


def _add_raw_lib(out: Dict[str, Dict], name: str, how: str, rel: str,
                 ext_target: bool = False,
                 platform: Optional[str] = None) -> None:
    n = _norm_lib_name(name).strip('"\'')
    if not n or not re.fullmatch(r"[A-Za-z0-9_.+-]+", n):
        return
    e = out.setdefault(n.lower(), {"name": n, "hows": [], "evidence": []})
    if ext_target:
        # 名字来自 ns::external_<name> 导入目标（如 desktop-app::external_zlib）：
        # 真正的 find_package 位于外部构建模块（cmake_helpers 等），
        # 链接名是唯一可见的声明——标记为高置信外部依赖
        e["ext_target"] = True
    # 平台块上下文：仅全部声明点都在其他平台 if 块内时标记；
    # 任一非平台块声明点即清除（跨平台库必需）
    if platform:
        if not e.get("unguarded"):
            e["platform_block"] = platform
    else:
        e["unguarded"] = True
        e.pop("platform_block", None)
    if how not in e["hows"]:
        e["hows"].append(how)
    if rel not in e["evidence"] and len(e["evidence"]) < 3:
        e["evidence"].append(rel)


def _detect_qmake_pkgconfig(root: Path, info: Dict) -> List[Dict]:
    """qmake: CONFIG += link_pkgconfig + PKGCONFIG += foo 的 pkg-config 依赖。"""
    out: List[Dict] = []
    seen = set()
    for rel in info["pro_files"]:
        for m in _QMAKE_PKGCONFIG_RE.finditer(_read_text(root / rel)):
            for tok in _PKGCONF_NAME_RE.findall(m.group(1)):
                if tok.lower() not in seen:
                    seen.add(tok.lower())
                    out.append({"name": tok, "evidence": [rel]})
    return out


_CMT_RE = re.compile(r"#[^\n]*")


def _strip_cmake_comments(text: str) -> str:
    """去掉 # 行注释（多行调用参数里的注释文字会污染裸名提取）。"""
    return _CMT_RE.sub(" ", text)


def _detect_cmake_raw_links(root: Path, cmake_files: List[str]):
    """CMake 中不经 find_package 声明的直接链接：

    - target_link_libraries 裸名（排除项目内 add_library/add_executable 目标、
      导入目标 Foo::Bar、${VAR}/生成器表达式、关键字与链接 flag）
    - -lfoo 链接 flag（含引号内的多 flag 串）
    - "-framework X"（macOS 框架）
    - find_library(VAR [NAMES] name...) 的库名候选
    返回 (raw_libs, macos_frameworks)。
    """
    raw: Dict[str, Dict] = {}
    frameworks: Dict[str, List[str]] = {}
    texts: Dict[str, str] = {}
    all_texts: Dict[str, str] = {}   # 含 vendored：供目标定义收集
    defined = set()
    lib_macros = set()      # body 内调用 add_library 的 macro/函数名
    for rel in cmake_files:
        text = _strip_cmake_comments(_read_text(root / rel))
        all_texts[rel] = text
        if _is_vendored_path(rel):
            # 链接声明（target_link_libraries 等）不收集：vendored 三方
            # 自己的链接不算应用依赖；但其目标定义仍参与收集（见下）
            continue
        texts[rel] = text
        # 包装器检测：macro/function 定义块内出现 add_library( =>
        # 调用 <wrapper>(<target> ...) 也定义项目内目标
        for dm in _MACRO_DEF_RE.finditer(text):
            body = text[dm.end():]
            em = _END_BLOCK_RE.search(body)
            if em and "add_library(" in body[:em.start()]:
                lib_macros.add(dm.group(1).lower())
    # set(<var> <字面量>) 变量表：解析 add_library(${VAR} ...) 的目标名
    vart: Dict[str, str] = {}
    for text in all_texts.values():
        for m in re.finditer(
                r"^\s*set\s*\(\s*(\w+)\s+\"?([\w.]+)\"?\s*\)",
                text, re.M):
            vart.setdefault(m.group(1), m.group(2))
    # 目标定义收集（含 vendored 文件）：vendored 源码内
    # add_library(fluidsynth) 定义的是项目内目标，应用侧
    # target_link_libraries(fluidsynth) 链的是内部目标而非外部包
    wrapper_defined = set()   # wrapper 文件里定义的 external_* 目标
    for rel, text in all_texts.items():
        is_wrapper = (_is_vendored_path(rel)
                      and _WRAPPER_TARGET_RE.search(text))
        for m in _ADD_TARGET_RE.finditer(text):
            tgt = m.group(1)
            if tgt.startswith("${"):
                # add_library(${VAR} ...)：用 set(VAR x) 变量表解析目标名
                tgt = vart.get(tgt[2:-1].strip(), "")
            if tgt:
                defined.add(tgt.lower())
                if is_wrapper and tgt.lower().startswith("external_"):
                    wrapper_defined.add(tgt.lower())
        if lib_macros:
            for mw in lib_macros:
                for m in re.finditer(
                        r"\b%s\s*\(\s*([A-Za-z0-9_.:-]+)" % re.escape(mw),
                        text, re.I):
                    defined.add(m.group(1).lower())
    for rel, text in texts.items():
        pmap = _cmake_platform_line_map(text)
        for m in _TARGET_LINK_RE.finditer(text):
            args = _strip_cmake_comments(m.group(1))
            args = args.replace("\\\n", " ").replace('"', " ")
            line = text.count("\n", 0, m.start()) + 1
            plat = pmap.get(line)
            for fw in _FRAMEWORK_RE.finditer(args):
                frameworks.setdefault(fw.group(1), []).append(rel)
            # 框架段不参与裸名/链接 flag 提取
            args = _FRAMEWORK_RE.sub(" ", args)
            body = args.split(None, 1)
            if len(body) < 2:
                continue
            for lm in _LFLAG_RE.finditer(args):
                _add_raw_lib(raw, lm.group(1), "target_link_libraries -l", rel,
                             platform=plat)
            for tok in body[1].split():
                t = tok.strip()
                if not t or t.startswith("$") or t.upper() in _TLL_KEYWORDS \
                        or t.startswith("-"):
                    continue
                if "::" in t:
                    # 导入目标 ns::name：external_ 前缀是 cmake_helpers 等
                    # 外部包装层的通用约定——剥前缀后的名字是高置信外部库
                    # 声明（corpus_a 全部三方库都走这条路，find_package 不可见）。
                    # PkgConfig::X 已由 pkg_check_modules 覆盖；Qt6::/项目内
                    # lib_* 目标不是外部包声明，跳过。
                    ns, _, tgt = t.partition("::")
                    tgt = tgt.strip('"')
                    tl = tgt.lower()
                    if (ns.lower() == "pkgconfig"
                            or not re.fullmatch(r"[A-Za-z0-9_.+-]+", tgt)
                            or not tl.startswith("external_")
                            or (tl in defined and tl not in wrapper_defined)
                            or (tgt.lower() in defined
                                and tl not in wrapper_defined)
                            or tl[len("external_"):].startswith(("qt", "kf"))):
                        continue
                    base = tgt[len("external_"):]
                    _add_raw_lib(raw, base,
                                 "target_link_libraries external-target", rel,
                                 ext_target=True, platform=plat)
                    continue
                if ("/" in t or "\\" in t):
                    continue
                _add_raw_lib(raw, t, "target_link_libraries", rel,
                             platform=plat)
        for m in _FINDLIB_RE.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            plat = pmap.get(line)
            toks = _strip_cmake_comments(m.group(1)).replace("\\\n", " ").split()
            # 首参数是接收结果的变量名，无条件跳过；NAMES 后是库名候选，
            # PATHS/HINTS/PATH_SUFFIXES/DOC 后是路径/描述（跳过）
            skip_value_kw = {"PATHS", "HINTS", "PATH_SUFFIXES", "DOC",
                             "VALIDATOR"}
            in_skip = False
            for i, tok in enumerate(toks):
                if i == 0:
                    continue
                t = tok.strip('"')
                up = t.upper()
                if up in _FINDLIB_KW or up == "NAMES":
                    in_skip = up in skip_value_kw
                    continue
                if in_skip or "$" in t:
                    continue
                if re.search(r"_(LIBRARY|LIBRARIES|LIB|LIBS)$", t):
                    continue
                # 全大写+下划线的 token 是 CMake 变量/关键字（如 gen_a
                # FindQUAZIP.cmake 误入参数列表的 WIN32_DEBUG_POSTFIX），
                # 不是库名候选；单字符 token（如上面关键字后的取值 d）
                # 也几乎不可能是磁盘上的库名
                if re.fullmatch(r"[A-Z][A-Z0-9_]*_+[A-Z0-9_]*", t) or len(t) == 1:
                    continue
                _add_raw_lib(raw, t, "find_library", rel, platform=plat)
    for name in defined:      # 项目内目标不算外部依赖
        raw.pop(name, None)
    fw_list = [{"name": k, "evidence": v[:3]} for k, v in sorted(frameworks.items())]
    return (sorted(raw.values(), key=lambda d: d["name"]),
            fw_list)


def _detect_fetched_deps(root: Path, cmake_files: List[str]) -> List[Dict]:
    """FetchContent_Declare / ExternalProject_Add / CPMAddPackage：
    configure 阶段拉取的源码依赖（GIT_REPOSITORY/URL + GIT_TAG/VERSION）。

    不跳过 vendored 路径：thirdparty/CMakeLists.txt 常是宿主自己写的
    拉取胶水（gen_i 实证：CPM 声明全在 thirdparty/，跳过导致
    ads/QSimpleUpdater 等自带声明丢失，链接名无从归并为 in-tree）。
    """
    out: List[Dict] = []
    seen = set()
    for rel in cmake_files:
        text = _strip_cmake_comments(_read_text(root / rel))
        for m in _FETCHED_DECLARE_RE.finditer(text):
            cmd, name, args = m.group(1), m.group(2), m.group(3)
            um = _FETCH_URL_RE.search(args)
            tm = _FETCH_TAG_RE.search(args)
            url = um.group(1).strip('",') if um else None
            if name in ("GITHUB_REPOSITORY", "GIT_REPOSITORY", "URL"):
                name = url.split("/")[-1] if url else name
            elif name == "NAME":
                # CPMAddPackage(NAME <name> ...)：首 token 是关键字 NAME，
                # 实际包名在其后（gen_i 实证：曾把字面量 NAME 当包名）
                nm = re.match(r"\s*\"?([A-Za-z0-9_.:+-]+)", args)
                if not nm or nm.group(1).startswith("$"):
                    # CPM 实现文件内部的 CPMAddPackage(NAME ${Name})：
                    # 无法静态解析，跳过（曾产生垃圾条目 "NAME"）
                    continue
                name = nm.group(1)
            name = name.strip('",')
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append({"name": name, "how": _FETCHED_HOW[cmd], "url": url,
                        "tag": tm.group(1).strip('",') if tm else None,
                        "file": rel})
    return out


def _meson_internal_names(root: Path, meson_files: List[str]) -> set:
    """meson 项目内部定义/自带的依赖名集合（折叠口径：小写、去非字母
    数字、去 lib 前缀）：

    - meson.override_dependency('name', ...) —— 项目自身 library() 定义
      的依赖（rizin 的 rz_core/rz_util 等，gen_j 实证：曾整批误报
      need_port，实际由 vendored rizin 子模块随项目编译）
    - <meson 项目根>/subprojects/ 下的目录名与 .wrap 文件名 —— meson
      自带子项目（zydis/softfloat/ptrace-wrap 等）
    """
    internal: Dict[str, str] = {}

    def fold(n: str) -> str:
        f = re.sub(r"[^a-z0-9]+", "", (n or "").lower())
        if f.startswith("lib") and len(f) > 3:
            f = f[3:]
        return f

    for rel in meson_files:
        text = _read_text(root / rel)
        for m in _MESON_OVERRIDE_RE.finditer(text):
            internal.setdefault(fold(m.group(1)), m.group(1))
    # subprojects 目录（meson 项目根的 ./subprojects/）
    roots = set()
    for rel in meson_files:
        parts = Path(rel).parts
        if "subprojects" in parts:
            # 子项目自身的 meson.build：取 subprojects/ 后的目录名
            i = parts.index("subprojects")
            if i + 1 < len(parts) and parts[i + 1] != "packagefiles":
                internal.setdefault(fold(parts[i + 1]), parts[i + 1])
            roots.add(str(Path(*parts[:i])))
        else:
            roots.add(str(Path(*parts[:-1])))
    for r in roots:
        sp = root / r / "subprojects"
        if not sp.is_dir():
            continue
        try:
            entries = list(sp.iterdir())
        except OSError:
            continue
        for e in entries:
            nm = e.name[:-5] if e.name.endswith(".wrap") else e.name
            if nm and nm != "packagefiles":
                internal.setdefault(fold(nm), nm)
    return set(internal)


def _absorb_meson(root: Path, info: Dict, meson_files: List[str]) -> None:
    """meson.build：dependency('name', version:) / cc.find_library /
    meson_version / cpp_std / subproject() / qt5|qt6 modules。

    结果合并进 info（meson_deps / meson / raw_libs / qt_modules）。
    内部依赖（override_dependency/subprojects 自带）标 internal=True，
    供 deps_report 归 in-tree 而非 need_port（gen_j/rizin 实证）。
    """
    meson_info: Dict = {"version_min": None, "cxx_standard": None,
                        "subprojects": [], "internal_deps": []}
    deps: Dict[str, Dict] = {}
    internal = _meson_internal_names(root, meson_files)

    def _fold(n: str) -> str:
        f = re.sub(r"[^a-z0-9]+", "", (n or "").lower())
        if f.startswith("lib") and len(f) > 3:
            f = f[3:]
        return f

    for rel in meson_files:
        text = _read_text(root / rel)
        # vendored 三方子树自己的 meson 声明不算应用依赖（与 CMake 检测器
        # 同口径；corpus_a 复盘：ThirdParty/xdg-desktop-portal 的
        # libgeoclue/pipewire 泄漏进应用 depth-1）
        vendored = _is_vendored_path(rel)
        if not meson_info["version_min"]:
            pm = _MESON_PROJECT_RE.search(text)
            if pm:
                vm = _MESON_MIN_RE.search(pm.group(1))
                if vm:
                    meson_info["version_min"] = vm.group(1)
                sm = _MESON_STD_RE.search(pm.group(1))
                if sm:
                    meson_info["cxx_standard"] = int(sm.group(1))
        for sp in _MESON_SUBPROJECT_RE.finditer(text):
            sp_name = sp.group(1).rstrip("-_+.")
            if sp_name and sp_name not in meson_info["subprojects"]:
                meson_info["subprojects"].append(sp_name)
        for m in _MESON_DEP_RE.finditer(text):
            if vendored:
                continue
            name, args = m.group(1), m.group(2)
            # meson 字符串插值（'libpcre2-@0@'）：剥占位符，否则
            # "libpcre2-@0@" 之类垃圾名入报告（rizin/meson.build 实证）
            name = name.replace("@0@", "").rstrip("-_.")
            if not name:
                continue
            if name in ("qt5", "qt6"):
                info["qt_version_hint"] = info.get("qt_version_hint") or name[2]
                mm = _MESON_MODS_RE.search(args)
                if mm:
                    for mod in re.findall(r"'(\w+)'", mm.group(1)):
                        if mod.lower() not in info["qt_modules"]:
                            info["qt_modules"].append(mod.lower())
                continue
            e = deps.setdefault(name, {"name": name, "version": None,
                                       "required": True, "evidence": [rel]})
            vm = _MESON_VER_RE.search(args)
            if vm and not e["version"]:
                e["version"] = vm.group(1)
            if _MESON_OPT_RE.search(args):
                e["required"] = False
            if _fold(name) in internal:
                e["internal"] = True
        for fl in _MESON_FINDLIB_RE.finditer(text):
            if vendored:
                continue    # vendored 三方子树自己的声明不算应用依赖
            if _fold(fl.group(1)) in internal:
                continue    # 项目内部库（override_dependency 定义）
            _merge_raw_lib(info["raw_libs"], fl.group(1),
                           "cc.find_library", rel)
    meson_info["internal_deps"] = sorted(internal)
    info["meson"] = meson_info
    info["meson_deps"] = sorted(deps.values(), key=lambda d: d["name"])


def _merge_raw_lib(raw_libs: List[Dict], name: str, how: str, rel: str) -> None:
    """把裸库名合并进 info["raw_libs"]（按小写名去重）。"""
    n = _norm_lib_name(name).strip('"\'')
    if not n or not re.fullmatch(r"[A-Za-z0-9_.+-]+", n):
        return
    for e in raw_libs:
        if e["name"].lower() == n.lower():
            if how not in e["hows"]:
                e["hows"].append(how)
            if rel not in e["evidence"] and len(e["evidence"]) < 3:
                e["evidence"].append(rel)
            return
    raw_libs.append({"name": n, "hows": [how], "evidence": [rel]})


def _absorb_autotools(root: Path, info: Dict,
                      autotools_files: List[str]) -> None:
    """configure.ac：PKG_CHECK_MODULES（含版本约束）/
    AC_CHECK_LIB / AC_SEARCH_LIBS（裸库名）。"""
    deps: Dict[str, Dict] = {}
    for rel in autotools_files:
        text = _read_text(root / rel)
        # vendored 三方子树自己的 configure.ac 不算应用依赖（与 CMake
        # 检测器同口径；corpus_a 复盘：ThirdParty/nimf 的
        # anthy/gtk+/m17n 泄漏进应用 depth-1）
        if _is_vendored_path(rel):
            continue
        for m in _PKGCHK_MOD_RE.finditer(text):
            # 模块列表以逗号或空白分隔；单个 spec 可为 "name" 或
            # "name >= ver"
            for chunk in re.split(r",\s*", m.group(1)):
                for sm in re.finditer(
                        r"([A-Za-z0-9_.+-]+)"
                        r"(?:\s*(>=|<=|==|=|<|>)\s*([\w.]+))?", chunk):
                    nm, op, ver = sm.group(1), sm.group(2), sm.group(3)
                    e = deps.setdefault(
                        nm.lower(), {"name": nm, "version_req": None,
                                     "evidence": [rel]})
                    if op and ver and not e["version_req"]:
                        e["version_req"] = "%s %s" % (op, ver)
        for m in _AC_CHECK_LIB_RE.finditer(text):
            _merge_raw_lib(info["raw_libs"], m.group(1), "AC_CHECK_LIB", rel)
        for m in _AC_SEARCH_LIBS_RE.finditer(text):
            for lib in re.split(r"[\s,]+", m.group(1)):
                if lib and re.fullmatch(r"[A-Za-z0-9_.+-]+", lib):
                    _merge_raw_lib(info["raw_libs"], lib, "AC_SEARCH_LIBS", rel)
    info["autotools_deps"] = sorted(deps.values(), key=lambda d: d["name"])


def _collect_ci_files(root: Path) -> List[str]:
    """CI / 安装脚本文件：.github/、.ci/ 递归 + 顶层 *.sh。

    _walk 跳过 . 开头目录，这里显式收集。
    """
    out: List[str] = []
    for base in (root / ".github", root / ".ci"):
        if not base.is_dir():
            continue
        for p in base.rglob("*"):
            if p.is_file() and p.suffix.lower() in (".yml", ".yaml", ".sh"):
                out.append(p.relative_to(root).as_posix())
    for p in root.glob("*.sh"):
        out.append(p.relative_to(root).as_posix())
    return out


def _detect_env_installs(root: Path, ci_files: List[str]) -> List[Dict]:
    """CI / 安装脚本声明的环境依赖（apt/brew/pacman install 的包名清单）。

    这是构建机环境清单（混合构建工具与链接库），作为构建文件分析的
    交叉核对信源；发行版包名（libfoo-dev）需映射回库名使用。
    """
    out: Dict[str, Dict] = {}
    # 含前导 '-' 的 token 也捕获（apt install -y 的 -y 不能因首字符截断
    # 而被误读成包名 y，gen_e CI 实证）
    tok_re = re.compile(r"-?[A-Za-z0-9][A-Za-z0-9_.@+-]*")
    skip = {"sudo", "update", "install", "install-recommends", "upgrade",
            "dist-upgrade"}
    for rel in ci_files:
        text = _read_text(root / rel).replace("\\\n", " ")
        for m in re.finditer(r"(?:apt(?:-get)?|brew|pacman)\b[^\n]*", text):
            seg = m.group(0)
            pm = re.search(r"(?:\binstall\b|\s-S)\s+(.*)", seg)
            if not pm:
                continue
            tail = re.split(r"\|\||&&", pm.group(1))[0]
            for tok in tok_re.findall(tail):
                t = tok.lower()
                if tok.startswith("-") or t in skip:
                    continue
                e = out.setdefault(t, {"name": tok.split("=")[0],
                                       "evidence": []})
                if rel not in e["evidence"] and len(e["evidence"]) < 3:
                    e["evidence"].append(rel)
        if len(out) > 60:
            break
    return sorted(out.values(), key=lambda d: d["name"])
