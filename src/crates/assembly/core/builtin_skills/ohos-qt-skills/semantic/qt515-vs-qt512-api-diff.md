---
id: semantic-qt515-vs-qt512-api-diff
type: semantic
domain: tech
tags: [qt, qt5, qt515, qt512, api-diff, ohos, harmonyos, migration, deprecated, widgets, breaking-change, porting]
created: 2026-06-13
updated: 2026-06-13
status: active
audience: public
refs: [semantic-qt-harmonyos-api,semantic-qt-harmonyos-build,semantic-qt-harmonyos-modules,semantic-qt-harmonyos-overview,semantic-qt-harmonyos-qt6-status]
summary: >
  QtWidgets 模块 Qt 5.15.16 vs 5.12.12 (OHOS SDK) 公共 API 完整差异报告：
  1 个新头文件、67 个头文件有差异、~50 个新 API（QStyleOptionTabV4/QCalendar/Markdown/ExclusionPolicy/
  OHOS 专有 QSystemTrayIcon/QFileDialog）、50+ 个废弃 API、Qt6 预备双重签名、迁移风险评估。
---

# QtWidgets: Qt 5.15.16 vs 5.12.12 OHOS SDK 公共 API 差异

> **用途**：在两个 OHOS Qt SDK 版本之间迁移时，快速查找哪些 API 新增/废弃/变更。
> **校验基准**：Qt 5.15.16 (commit 962aa625, 2026-04-19) vs Qt 5.12.12 (commit 613336de, 2026-05-25)

## 总览

| 指标 | 数值 |
|------|:----:|
| 5.15 头文件总数 | 355 |
| 5.12 头文件总数 | 354 |
| 仅 5.15 有（新增） | 2（1 真实 + 1 版本标记） |
| 仅 5.12 有（移除） | 1（版本标记） |
| 共同头文件 | 353 |
| 有差异的共同头文件 | 67 |
| 实质 API 影响 | ~50 个头文件 |

---

## §1 新增头文件（仅 5.15，降级会 break）

| 头文件 | 说明 | 降级风险 |
|--------|------|:--------:|
| `QStyleOptionTabV4` | 转发头文件 → `#include "qstyleoption.h"`。类在 `qstyleoption.h` 中定义 | 低 |
| `5.15.16` | 版本标记文件（非 API） | — |

**结论**：无真实 API 头文件被移除。

---

## §2 新增类

### QStyleOptionTabV4 (qstyleoption.h)

```cpp
class Q_WIDGETS_EXPORT QStyleOptionTabV4 : public QStyleOptionTab
{
public:
    enum StyleOptionVersion { Version = 4 };
    QStyleOptionTabV4();
    int tabIndex = -1;
};
```

- **用途**：扩展 tab 样式选项，增加 `tabIndex` 字段，供自定义样式获取当前绘制的 tab 索引
- **降级风险**：低——已有 `QStyleOptionTab` 代码不受影响

---

## §3 OHOS 专有新增 API（5.15 独有）

这些是 OHOS 平台补丁，5.12 的公共头文件中不存在。

### 3.1 QFileDialog (`Q_OS_OPENHARMONY`)

```cpp
QList<QUrl> selectedUris() const;                         // OHOS-only
static QUrl getOpenFileUri(QWidget *parent, ...);         // OHOS-only
```

**降级风险**：🔴 高——依赖这些 API 的代码在 5.12 上无法编译。

### 3.2 QSystemTrayIcon (`Q_OS_OPENHARMONY`)

```cpp
// 新构造函数：支持亮色/暗色双图标
QSystemTrayIcon(const QIcon &iconLight, const QIcon &iconDark, QObject *parent);

// 新枚举
enum IconTheme { Dark, Light };

// icon 接口签名变化（OHOS 专有）
QIcon icon(IconTheme theme = Light) const;
void setIcon(const QIcon &icon, IconTheme theme = Light);
```

**降级风险**：🔴 高——`icon()`/`setIcon()` 签名在 OHOS 上不同，降级后编译失败。

### 3.3 QWidget (`Q_OS_OPENHARMONY`)

```cpp
#ifdef Q_OS_OPENHARMONY
#define platformUpdate() update()
#else
#define platformUpdate() repaint()
#endif
```

**降级风险**：低——内部宏，应用代码一般不直接使用。

---

## §4 新增公共 API（5.15 有，5.12 无）

### 4.1 新方法

| 类 | 新增方法 | 版本 | 降级风险 |
|----|---------|:----:|:--------:|
| `QActionGroup` | `ExclusionPolicy exclusionPolicy() const` | 5.14 | 低 |
| `QActionGroup` | `void setExclusionPolicy(ExclusionPolicy)` | 5.14 | 低 |
| `QCalendarWidget` | `QCalendar calendar() const` | 5.14 | 🟠 中 |
| `QCalendarWidget` | `void setCalendar(QCalendar)` | 5.14 | 🟠 中 |
| `QComboBox` | `void setPlaceholderText(const QString &)` | 5.14 | 低 |
| `QComboBox` | `QString placeholderText() const` | 5.14 | 低 |
| `QDateTimeEdit` | `QCalendar calendar() const` | 5.14 | 🟠 中 |
| `QDateTimeEdit` | `void setCalendar(QCalendar)` | 5.14 | 🟠 中 |
| `QDateTimeEdit` | 构造函数 `(QVariant, QMetaType::Type, ...)` | 5.15 | 低 |
| `QFileDialog` | `static void getOpenFileContent(...)` | 5.14 | 🟠 中 |
| `QFileDialog` | `static void saveFileContent(...)` | 5.14 | 🟠 中 |
| `QFileSystemModel` | `void setOption(Option, bool)` | 5.14 | 低 |
| `QFileSystemModel` | `bool testOption(Option) const` | 5.14 | 低 |
| `QFileSystemModel` | `void setOptions(Options)` / `Options options()` | 5.14 | 低 |
| `QGraphicsItemAnimation` | `QTransform transformAt(qreal) const` | 5.14 | 低 |
| `QGraphicsWidget` | `void setContentsMargins(QMarginsF)` | 5.15 | 低 |
| `QGraphicsWidget` | `void setWindowFrameMargins(QMarginsF)` | 5.15 | 低 |
| `QItemDelegate` | `static QPixmap selectedPixmap(...)` | 5.13 | 低 |
| `QPlainTextEdit` | `bool find(const QRegularExpression &, ...)` | 5.13 | 低 |
| `QPushButton` | `bool hitButton(const QPoint &) const override` | 5.15 | 低 |
| `QShortcut` | 4 个模板构造函数（functor 支持） | 5.14 | 🟠 中 |
| `QSplashScreen` | `QSplashScreen(QScreen *, ...)` | 5.15 | 低 |
| `QTabBar` | `bool isTabVisible(int) const` | 5.14 | 低 |
| `QTabBar` | `void setTabVisible(int, bool)` | 5.14 | 低 |
| `QTableView` | `void sortByColumn(int, Qt::SortOrder)` (as slot) | 5.13 | 低 |
| `QTableWidgetSelectionRange` | `operator=(const &)` | 5.15 | 低 |
| `QTextBrowser` | `QTextDocument::ResourceType sourceType() const` | 5.14 | 低 |
| `QTextBrowser` | `void setSource(const QUrl &, ResourceType)` | 5.14 | 低 |
| `QTextBrowser` | `void doSetSource(const QUrl &, ResourceType)` | 5.14 | 🔴 高 |
| `QTextEdit` | `QString toMarkdown(MarkdownFeatures)` | 5.14 | 🟠 中 |
| `QTextEdit` | `void setMarkdown(const QString &)` | 5.14 | 🟠 中 |
| `QTextEdit` | `bool find(const QRegularExpression &, ...)` | 5.13 | 低 |
| `QTreeView` | `void sortByColumn(int, Qt::SortOrder)` (as slot) | 5.13 | 低 |
| `QTreeView` | `void expandRecursively(const QModelIndex &, int)` | 5.13 | 低 |
| `QWidget` | `QScreen *screen() const` | 5.14 | 低 |
| `QWizard` | `QList<int> visitedIds() const` | 5.15 | 低 |

### 4.2 新枚举

| 类 | 枚举 | 值 | 版本 |
|----|------|---|:----:|
| `QActionGroup` | `ExclusionPolicy` (enum class) | `None`, `Exclusive`, `ExclusiveOptional` | 5.14 |
| `QFileSystemModel` | `Option` | `DontWatchForChanges`, `DontResolveSymlinks`, `DontUseCustomDirectoryIcons` | 5.14 |
| `QStyle::StandardPixmap` | 7 个新值 | `SP_DialogYesToAllButton`, `SP_DialogNoToAllButton`, `SP_DialogSaveAllButton`, `SP_DialogAbortButton`, `SP_DialogRetryButton`, `SP_DialogIgnoreButton`, `SP_RestoreDefaultsButton` | 5.15 |
| `QStyle::SubElement` | `SE_PushButtonBevel` | 新元素 | 5.15 |
| `QSystemTrayIcon` (OHOS) | `IconTheme` | `Dark`, `Light` | OHOS 专有 |

### 4.3 新增 Q_ENUM 注册

| 类 | 注册的枚举 | 说明 |
|----|-----------|------|
| `QActionGroup` | `ExclusionPolicy` | 新 enum class |
| `QCompleter` | `CompletionMode` | 原来缺少 Q_ENUM |
| `QCompleter` | `ModelSorting` | 原来缺少 Q_ENUM |
| `QFileSystemModel` | `Option` | 新枚举 |
| `QGraphicsScene` | `ItemIndexMethod` | 原来缺少 Q_ENUM |

### 4.4 新增 Q_PROPERTY

| 类 | 属性 | 版本 |
|----|------|:----:|
| `QActionGroup` | `ExclusionPolicy exclusionPolicy` | 5.14 |
| `QComboBox` | `QString placeholderText` | 5.14 |
| `QFileSystemModel` | `Options options` | 5.14 |
| `QTextBrowser` | `QTextDocument::ResourceType sourceType` | 5.14 |
| `QTextEdit` | `QString markdown` | 5.14 |

### 4.5 新增信号

| 类 | 信号 | 版本 | 替代 |
|----|------|:----:|------|
| `QButtonGroup` | `idClicked(int)` | 5.15 | 替代 `buttonClicked(int)` |
| `QButtonGroup` | `idPressed(int)` | 5.15 | 替代 `buttonPressed(int)` |
| `QButtonGroup` | `idReleased(int)` | 5.15 | 替代 `buttonReleased(int)` |
| `QButtonGroup` | `idToggled(int, bool)` | 5.15 | 替代 `buttonToggled(int, bool)` |
| `QComboBox` | `textActivated(const QString &)` | 5.15 | 替代 `activated(const QString &)` |
| `QComboBox` | `textHighlighted(const QString &)` | 5.15 | 替代 `highlighted(const QString &)` |
| `QSpinBox` | `textChanged(const QString &)` | 5.14 | 替代 `valueChanged(const QString &)` |
| `QDoubleSpinBox` | `textChanged(const QString &)` | 5.14 | 替代 `valueChanged(const QString &)` |

### 4.6 新增 Q_DECLARE_MIXED_ENUM_OPERATORS

| 文件 | 声明 | 说明 |
|------|------|------|
| `qframe.h` | `Q_DECLARE_MIXED_ENUM_OPERATORS_SYMMETRIC(int, QFrame::Shape, QFrame::Shadow)` | 启用混合枚举算术 |
| `qsizepolicy.h` | `Q_DECLARE_MIXED_ENUM_OPERATORS(int, QSizePolicy::Policy, QSizePolicy::PolicyFlag)` | 启用混合枚举算术 |

---

## §5 废弃 API（5.12 可用，5.15 标记废弃）

> 所有废弃 API 仍在头文件中保留（`QT_DEPRECATED_SINCE` 守卫内），编译不报错但产生警告。

### 5.1 废弃于 5.13

| 类 | 废弃 API | 替代方案 |
|----|---------|---------|
| `QAbstractItemDelegate` | `elidedText(QFontMetrics, int, TextElideMode, QString)` | `QFontMetrics::elidedText()` |
| `QAbstractItemView` | `setHorizontalStepsPerItem(int)` / `horizontalStepsPerItem()` | 无直接替代 |
| `QAbstractItemView` | `setVerticalStepsPerItem(int)` / `verticalStepsPerItem()` | 无直接替代 |
| `QComboBox` | `autoCompletion()` / `setAutoCompletion(bool)` | `completer()` / `setCompleter()` |
| `QComboBox` | `autoCompletionCaseSensitivity()` / `setAutoCompletionCaseSensitivity(...)` | `completer()->caseSensitivity()` / `completer()->setCaseSensitivity(...)` |
| `QDialog` | `setOrientation(...)` / `orientation()` / `setExtension(...)` / `extension()` / `showExtension(bool)` | `show/hide` on the affected widget |
| `QGraphicsItem` | `matrix()` / `sceneMatrix()` / `setMatrix(...)` / `resetMatrix()` | `transform()` / `sceneTransform()` / `setTransform()` / `resetTransform()` |
| `QGraphicsItemAnimation` | `reset()` | `setStep(0)` |
| `QGraphicsScene` | `isSortCacheEnabled()` / `setSortCacheEnabled(bool)` | 无直接替代 |
| `QItemDelegate` | `selected(QPixmap, QPalette, bool)` | `selectedPixmap()` (static) |
| `QListWidget` | `isItemSelected(...)` / `setItemSelected(...)` | `QListWidgetItem::isSelected()` / `setSelected()` |
| `QListWidget` | `isItemHidden(...)` / `setItemHidden(...)` | `QListWidgetItem::isHidden()` / `setHidden()` |
| `QSplitter` | `operator<<(QTextStream&, const QSplitter&)` / `operator>>(QTextStream&, QSplitter&)` | `saveState()` / `restoreState()` |
| `QTableView` | `sortByColumn(int)` (无 SortOrder) | `sortByColumn(int, Qt::SortOrder)` |
| `QTreeWidget` | `isItemSelected/setItemSelected/isItemHidden/setItemHidden/isItemExpanded/setItemExpanded/isFirstItemColumnSpanned/setFirstItemColumnSpanned` | 对应 `QTreeWidgetItem` 上的方法 |
| `QTreeWidgetItem` | `backgroundColor(int)` / `setBackgroundColor(int, QColor)` | `background()` / `setBackground()` |
| `QTreeWidgetItem` | `textColor(int)` / `setTextColor(int, QColor)` | `foreground()` / `setForeground()` |
| `QTreeView` | `sortByColumn(int)` (无 SortOrder) | `sortByColumn(int, Qt::SortOrder)` |
| `QWidget` | `isEnabledToTLW() const` | `isEnabled()` |

### 5.2 废弃于 5.14

| 类 | 废弃 API | 替代方案 |
|----|---------|---------|
| `QFileDialog::Option` | `DontUseSheet` | 无（非 macOS 不使用） |
| `QGraphicsItem::GraphicsItemChange` | `ItemMatrixChange` | `ItemTransformChange` |
| `QGraphicsItemAnimation` | `matrixAt(qreal)` | `transformAt(qreal)` |
| `QLineEdit` | `getTextMargins(int*, int*, int*, int*)` | `textMargins()` |
| `QWidget` | `getContentsMargins(int*, int*, int*, int*)` | `contentsMargins()` |

### 5.3 废弃于 5.15

| 类 | 废弃 API | 替代方案 |
|----|---------|---------|
| `QApplication` | `globalStrut` 属性 / `setGlobalStrut()` / `globalStrut()` | 无（未使用） |
| `QButtonGroup` | 信号 `buttonClicked(int)` | `idClicked(int)` |
| `QButtonGroup` | 信号 `buttonPressed(int)` | `idPressed(int)` |
| `QButtonGroup` | 信号 `buttonReleased(int)` | `idReleased(int)` |
| `QButtonGroup` | 信号 `buttonToggled(int, bool)` | `idToggled(int, bool)` |
| `QComboBox::SizeAdjustPolicy` | `AdjustToMinimumContentsLength` | `AdjustToContents` 或 `AdjustToContentsOnFirstShow` |
| `QComboBox` | 信号 `activated(const QString &)` | `textActivated(const QString &)` |
| `QComboBox` | 信号 `highlighted(const QString &)` | `textHighlighted(const QString &)` |
| `QComboBox` | 信号 `currentIndexChanged(const QString &)` | `currentIndexChanged(int)` + `itemText(index)` |
| `QDirModel` | **整个类**（构造函数） | `QFileSystemModel` |
| `QDockWidget::DockWidgetFeature` | `AllDockWidgetFeatures` | 显式组合标志 |
| `QFileDialog::FileMode` | `DirectoryOnly` | `setOption(ShowDirsOnly, true)` |
| `QGraphicsView` | `matrix()` / `setMatrix(...)` / `resetMatrix()` | `transform()` / `setTransform()` / `resetTransform()` |
| `QMacCocoaViewContainer` | **整个类** | `QWindow::fromWinId` + `createWindowContainer` |
| `QMacNativeWidget` | **整个类** | `QWidget::winId` |
| `QSpinBox` | 信号 `valueChanged(const QString &)` | `textChanged(const QString &)` |
| `QDoubleSpinBox` | 信号 `valueChanged(const QString &)` | `textChanged(const QString &)` |
| `QSplashScreen` | 构造函数 `QSplashScreen(QWidget *, ...)` | `QSplashScreen(QScreen *, ...)` |
| `QStyle::PixelMetric` | `PM_DefaultTopLevelMargin` / `PM_DefaultChildMargin` / `PM_DefaultLayoutSpacing` | 无 |
| `QStyle::SubElement` | `SE_DialogButtonBoxLayoutItem` | 无 |
| `QTextBrowser` | 信号 `highlighted(const QString &)` | `highlighted(const QUrl &)` |
| `QWizard` | `visitedPages()` | `visitedIds()` |

---

## §6 签名变更 / 行为差异

### 6.1 签名变更

| 类 | 变更 | 说明 |
|----|------|------|
| `QAction` | `#ifndef QT_NO_SHORTCUT` → `#if QT_CONFIG(shortcut)` | 配置系统现代化，效果相同 |
| `QDateTimeEdit` | 新构造函数用 `QMetaType::Type` 替代 `QVariant::Type` | 旧构造函数在 `QT_VERSION < 6.0.0` 守卫内保留 |
| `QInputDialog::getDouble()` | 统一为单签名，`step` 作为默认参数 | 旧双重载形式在版本守卫内保留 |
| `QMainWindow::toolBarArea` | `QToolBar *` → `const QToolBar *`（Qt6 模式） | const 修正 |
| `QTableWidgetSelectionRange` | 新增 `operator=` | 之前无赋值运算符 |
| `QWidget::insertActions` | `const QAction *before` → `QAction *before`（Qt6 模式） | const 修正 |
| `QWidget::nativeEvent` | `long *result` → `qintptr *result`（Qt6 模式） | 64 位安全 |
| `QWizard::nativeEvent` | 同上 `long *` → `qintptr *`（Qt6 模式） | 64 位安全 |
| `QSizePolicy` | `Q_DECL_NOTHROW` → `noexcept`（全部方法） | 现代化，二进制兼容 |

### 6.2 Q_PROPERTY DESIGNABLE 属性移除

| 类 | 属性 | 旧 | 新 |
|----|------|----|----|
| `QAction` | `checked` | `DESIGNABLE isCheckable` | （移除） |
| `QAbstractButton` | `checked` | `DESIGNABLE isCheckable` | （移除） |
| `QGroupBox` | `checked` | `DESIGNABLE isCheckable` | （移除） |
| `QWidget` | `windowTitle`/`windowIcon`/`windowIconText`/`windowOpacity`/`windowModified`/`windowFilePath` | `DESIGNABLE isWindow` | （移除） |
| `QToolBar` | `movable`/`allowedAreas`/`orientation` | `DESIGNABLE (qobject_cast<...>)` | （移除） |

**影响**：低——仅影响 Qt Designer 行为，不影响运行时代码。

### 6.3 枚举值重排

| 枚举 | 变更 | 影响 |
|------|------|------|
| `QGraphicsItem::GraphicsItemChange` | `ItemVisibleChange` 显式 `= 2` | 二进制兼容，值不变 |
| `QComboBox::SizeAdjustPolicy` | `AdjustToMinimumContentsLengthWithIcon = AdjustToContentsOnFirstShow + 2` | 显式赋值，向后兼容 |
| `QStyle::SubElement` | `SE_LabelLayoutItem = SE_DateTimeEditLayoutItem + 2`（为废弃值留间隔） | 二进制兼容 |
| `QStyle::PixelMetric` | `PM_ToolBarIconSize = PM_SpinBoxSliderHeight + 4`（为废弃值留间隔） | 二进制兼容 |

### 6.4 QStyleOption operator= 现代化

全部 `QStyleOption*` 类将手写 `operator=` 替换为 `= default`：
`QStyleOptionTabWidgetFrame`、`QStyleOptionTabBarBase`、`QStyleOptionHeader`、`QStyleOptionButton`、`QStyleOptionTab`、`QStyleOptionToolBar`、`QStyleOptionProgressBar`、`QStyleOptionFocusRect`、`QStyleOptionFrame`、`QStyleOptionViewItem`。

**影响**：低——二进制兼容，`= default` 语义与手写版完全一致。

### 6.5 QActionGroup: `exclusive` → `ExclusionPolicy`

`bool exclusive` 属性被替换为 `ExclusionPolicy exclusionPolicy`。`setExclusive(bool)` 和 `isExclusive()` 仍可用，但 `exclusionPolicy` 新增 `ExclusiveOptional` 模式。

**迁移**：🟠 中——使用 `setExclusive(false)` 的代码应迁移到 `setExclusionPolicy(ExclusionPolicy::None)`。

---

## §7 被移除的 API（5.12 有，5.15 无）

**无公共 API 被真正移除**——所有废弃 API 仍在 `QT_DEPRECATED_SINCE` 守卫内可用。

以下被"移除"的含义是它们被置于废弃守卫之后：

| 类 | 说明 |
|----|------|
| `QDirModel` | 整个类在 `QT_DEPRECATED_SINCE(5,15)` 守卫内——只有当废弃功能启用时才可编译 |
| `QMacCocoaViewContainer` | 整个类在 `QT_DEPRECATED_SINCE(5,15)` 守卫内 |
| `QMacNativeWidget` | 整个类在 `QT_DEPRECATED_SINCE(5,15)` 守卫内 |
| `QGraphicsTextItem` | 3 个 `Q_PRIVATE_SLOT` 声明移除（内部清理） |

---

## §8 Qt6 预备代码（QT_VERSION 守卫）

以下 API 有基于 `QT_VERSION < QT_VERSION_CHECK(6,0,0)` 的双重签名：

| 类 | 模式 |
|----|------|
| `QDateTimeEdit` | 构造函数：`QVariant::Type` (Qt5) vs `QMetaType::Type` (Qt6) |
| `QInputDialog::getDouble` | 双重载 (Qt5) vs 单签名带默认 `step` (Qt6) |
| `QMainWindow::toolBarArea` | 非 const (Qt5) vs const (Qt6) 参数 |
| `QWidget::nativeEvent` | `long *result` (Qt5) vs `qintptr *result` (Qt6) |
| `QWizard::nativeEvent` | 同上 |
| `QWidget::insertActions` | 非 const (Qt5) vs const (Qt6) 第一参数 |
| `QTextBrowser::setSource` | virtual (Qt5) vs virtual + 默认 ResourceType (Qt6) |
| `QCommandLinkButton` | `sizeHint/heightForWidth/minimumSizeHint` protected (Qt5) vs public (Qt6) |

---

## §9 其他变更（非 API 影响）

| 变更类型 | 涉及文件 | 说明 |
|---------|---------|------|
| `Q_QDOC` → `Q_CLANG_QDOC` | qmenu.h, qtoolbar.h | 文档系统内部宏替换 |
| `Q_OS_OSX` → `Q_OS_MACOS` | qmenu.h | 平台宏现代化 |
| `Q_DECL_EQ_DELETE` → `= delete` | qwhatsthis.h, qtooltip.h | C++11 风格现代化 |
| `Q_DECL_NOTHROW` → `noexcept` | qsizepolicy.h | C++11 风格现代化 |
| `QGraphicsTextItem` 移除 3 个 `Q_PRIVATE_SLOT` | qgraphicsitem.h | 内部清理 |
| `qgraphicsitem_cast` 中 `0` → `nullptr` | qgraphicsitem.h | C++11 风格 |
| `QT_FEATURE_paint_debug` 从 config 中移除 | qtwidgets-config.h | OHOS 构建配置差异 |
| `QMainWindow::tabifyDockWidget` 增加 `QT_CONFIG(tabbar)` 守卫 | qmainwindow.h | 配置条件编译 |

---

## §10 迁移风险评估

### 10.1 降级 5.15 → 5.12（Breaking Changes）

| 风险级别 | 受影响的 API | 说明 |
|:--------:|------------|------|
| 🔴 高 | `QSystemTrayIcon` OHOS API（`IconTheme`、双图标构造函数） | 5.12 完全不存在，OHOS tray icon 代码编译失败 |
| 🔴 高 | `QFileDialog` OHOS API（`selectedUris()`、`getOpenFileUri()`） | OHOS 文件选择器扩展不存在 |
| 🔴 高 | `QTextBrowser::doSetSource()` | 5.12 中不存在 |
| 🔴 高 | `QCalendar` 方法（`QCalendarWidget`/`QDateTimeEdit`） | `QCalendar` 类在 5.12 公共 API 中不存在 |
| 🟠 中 | `QTextEdit` Markdown API（`toMarkdown`/`setMarkdown`/`markdown` 属性） | 5.12 不可用 |
| 🟠 中 | `QFileSystemModel::Options` 枚举和方法 | 5.12 不可用 |
| 🟠 中 | `QShortcut` 模板构造函数 | 5.12 不可用 |
| 🟠 中 | `QStyleOptionTabV4` | 5.12 不可用 |
| 🟠 中 | `QActionGroup::ExclusionPolicy` 枚举 | 5.12 不可用 |
| 🟡 低 | `QWidget::screen()` | 5.12 不可用 |
| 🟡 低 | `QTabBar::isTabVisible()`/`setTabVisible()` | 5.12 不可用 |
| 🟡 低 | `QTreeView::expandRecursively()` | 5.12 不可用 |
| 🟡 低 | `QFileDialog::getOpenFileContent()`/`saveFileContent()` | 5.12 不可用 |
| 🟡 低 | `QComboBox::placeholderText` | 5.12 不可用 |
| 🟡 低 | `QStyle` 新 `SP_*` 标准图标 | 5.12 不可用 |
| 🟡 低 | `QGraphicsWidget::setContentsMargins(QMarginsF)` 重载 | 5.12 不可用 |
| 🟡 低 | 新信号（`textActivated`/`textHighlighted`/`idClicked` 等） | 旧信号名仍可用，新信号名无法编译 |

### 10.2 升级 5.12 → 5.15

| 风险级别 | 说明 |
|:--------:|------|
| 🟡 低 | 所有 5.12 API 均保留（可能废弃但仍可编译） |
| 🟡 低 | 约 50+ API 会产生废弃警告——代码仍可编译 |
| 🟡 低 | `QDirModel` 产生废弃警告——应迁移到 `QFileSystemModel` |
| ℹ️ 信息 | OHOS 专有 API 是鸿蒙目标的额外奖励 |

---

## 参考来源

| 来源 | 说明 |
|------|------|
| 🛠️ SDK 头文件比对 | `<LOCAL_PATH>` vs `<LOCAL_PATH>` |
| 🛠️ diff 分析 | 67 个差异头文件逐一 diff，提取 `class`/`Q_PROPERTY`/`Q_ENUM`/`Q_SIGNALS`/`QT_DEPRECATED_SINCE` 等模式 |
| 🛠️ 校验基准 | Qt 5.15.16 tqtc/harmonyos-5.15.16 (962aa625) vs Qt 5.12.12 tqtc/harmonyos-5.12.12 (613336de) |

## Qt 框架版本（校验基准）

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |

---

## 相关上下文

- [[qt-harmonyos-overview]] — Qt 鸿蒙化总览（版本信息、QPA 架构）
- [[qt-harmonyos-modules]] — 模块适配状态速查
- [[qt-harmonyos-build]] — 构建指南（5.12/5.15 编译配置差异）
- [[qt-harmonyos-api]] — API 兼容性差异
- [[qt-harmonyos-qt6-status]] — Qt6 鸿蒙化状态（Qt5→Qt6 差异参考）
- 技术栈 — 技术栈概览（Qt 版本路径）
