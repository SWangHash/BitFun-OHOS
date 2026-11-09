# Environment smoke app (env_smoke.py): proves Qt OHOS SDK + OHOS toolchain +
# template + hvigor produce a loadable HAP on this machine. Not an application.
cmake_minimum_required(VERSION 3.5)
project(QtHarmonyApp)

set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

# OHOS toolchain sets CMAKE_FIND_ROOT_PATH_MODE_PACKAGE=ONLY, which hides
# CMAKE_PREFIX_PATH from find_package (KB qt-harmonyos-project-structure.md 4.2).
if(CMAKE_CROSSCOMPILING)
  set(_saved_root_path_mode_package "${CMAKE_FIND_ROOT_PATH_MODE_PACKAGE}")
  set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)
endif()

find_package(QT NAMES Qt5 Qt6 REQUIRED COMPONENTS Core)
find_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Core Gui Widgets)

if(CMAKE_CROSSCOMPILING)
  set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE "${_saved_root_path_mode_package}")
  unset(_saved_root_path_mode_package)
endif()

# Must match APP_LIBRARY_NAME in QtAppConstants.ets: libQtHarmonyApp.so
add_library(QtHarmonyApp SHARED main.cpp)
target_link_libraries(QtHarmonyApp PRIVATE
  Qt${QT_VERSION_MAJOR}::Core
  Qt${QT_VERSION_MAJOR}::Gui
  Qt${QT_VERSION_MAJOR}::Widgets
  Qt${QT_VERSION_MAJOR}::QOhosPlatformIntegrationPlugin
)
