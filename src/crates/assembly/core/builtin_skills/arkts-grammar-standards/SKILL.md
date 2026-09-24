---
name: arkts-grammar-standards
description: REQUIRED before writing the first .ets file of a session. Load this skill when writing or modifying .ets files, porting TypeScript to ArkTS, or building ArkUI components, layouts, state-driven UI, navigation, or dialogs. Covers ArkTS linter rules (arkts-* rule tags), forbidden syntax, TypeScript-to-ArkTS rewrites, null safety, struct/@Component structural constraints, ArkUI component APIs, Sendable restrictions, and UI quality. Triggers - ArkTS, ArkUI, .ets, HarmonyOS, struct, @Component, @State, Tabs, ForEach, Navigation, arkts-no-*, syntax constraints, TS migration.
---

# ArkTS Grammar Standards

Target: **ArkTSLinter 1.1**. Rules use official `arkts-*` tags matching compiler/linter error messages.

## Legal constructs (do NOT over-restrict)

- Template literals `` `${value}` `` — fully supported
- `value as T` — the ONLY supported assertion syntax (`<T>value` is banned)
- `Record<K, V>` and indexed access — recommended replacement for index signatures

## ⚠ Top-5 traps (hit repeatedly in benchmarks — review BEFORE generating code)

These are the most frequently violated rules from production runs. Every one is documented in the sections below, yet models keep hitting them by defaulting to TypeScript habits. **Scan this list before writing each `.ets` file:**

| # | Trap | ❌ Wrong | ✅ Fix |
|---|------|---------|--------|
| 1 | Destructuring | `const { a, b } = obj` | `const a = obj.a; const b = obj.b;` |
| 2 | Untyped object literal | `const cfg = { timeout: 30 }` | `const cfg: Config = { timeout: 30 }` (declare `interface Config` first) |
| 3 | Prototype / structural typing | `X.prototype.fn = ...` or passing structurally-matching objects | Declare methods in class body; use `extends`/`implements` for type compatibility |
| 4 | Missing export/import | Define `class CartItem` in one file, use it in another without `export`/`import` | Add `export` at declaration; add `import { CartItem } from '...'` in consumer |
| 5 | Wrong kit namespace | `import { audio } from '@kit.MediaKit'` | `audio` → `@kit.AudioKit`; `media` → `@kit.MediaKit`; see kit imports table below |

---

## Core hard constraints (ERROR severity unless marked WARNING)

### Types
- **no `any` 和 `unknown`**（含 `as unknown as T` 双重断言）— 用具体类型、`Object`、或联合类型替代 (`arkts-no-any-unknown`)。常见违规：`undefined as unknown as SomeType` → 改为 `new SomeType()` 或给 `SomeType | undefined` 初始值
- Type/namespace names must be unique within a scope — do not reuse imported type names as local struct/class names (`arkts-unique-names`)
- No structural typing; requires `extends`/`implements` (`arkts-no-structural-typing`)
- Object literals need a type context in EVERY position — including **call arguments** and **callback returns**; outer type does NOT propagate into nested literals (`arkts-no-untyped-obj-literals`)
- `Record`-typed literals require **quoted keys**: `{ 'k': v }` not `{ k: v }`
- Object literal assigned to a **class** type must list **every** field — class defaults do NOT make fields optional → use `static of()` factory (see `references/recipes-core.md` § 1)
- No inline object types; use named `interface` (`arkts-no-obj-literals-as-types`)
- No intersection types `A & B`; use interface inheritance (`arkts-no-intersection-types`)
- No index signatures; use `Record<K,V>` (`arkts-no-indexed-signatures`)
- Utility types: only `Partial`/`Required`/`Readonly`/`Record` (`arkts-no-utility-types`)
- Annotate generic calls and function return types explicitly (`arkts-no-inferred-generic-params`, `arkts-no-implicit-return-types`)

### Null safety (largest source of check errors)
- Any value that can be `undefined` must be narrowed: `?.`, `?? fallback`, or `if (x !== undefined)`
- `T | undefined` cannot be assigned to `T`; supply a fallback — **包括函数实参**: `foo(x)` 中 `x: T | undefined` 不能传给 `param: T`，传参前用 `?? defaultValue` 或 `if` 窄化
- Component state that starts empty: `T | undefined` or a real initial value — no non-null assertions
- Prefer `undefined` over `null`; convert external `null` with `?? undefined`

### Functions and classes
- No `function(){}` as values; use arrow functions (`arkts-no-func-expressions`)
- No nested function declarations (`arkts-no-nested-funcs`)
- `async` 函数/方法必须显式标注返回类型 `Promise<T>` — 省略报 error；无返回值写 `Promise<void>`
- No `this` in standalone or **`static`** methods — use class name for static members (`arkts-no-standalone-this`)
- No constructor parameter properties (`arkts-no-ctor-prop-decls`)
- 同一作用域不允许同名函数声明（Duplicate function implementation）— ArkTS 不支持函数重载声明，每个函数名只能有一个实现
- No `#` private fields; use `private` (`arkts-no-private-identifiers`)
- `implements` only interfaces; interfaces cannot extend classes
- No generators/`yield`, class expressions, `Function.bind`

### Exports and imports (common source of "Cannot find name" / "not exported")
- Every type, class, interface, or enum defined in one file and used in another **must be `export`-ed** at declaration — forgetting `export` causes `Module '...' declares 'X' locally, but it is not exported`
- Every custom type used in a file **must be explicitly `import`-ed** at the top — `Cannot find name 'X'` almost always means a missing import
- After creating a model/type file, immediately note its exports (e.g. `EXPORTS: CartStore.ets → CartItem, CartStore`); before writing any file that uses those types, verify the import statement matches
- **"No overload matches this call"** — means wrong argument type or count to an SDK API. Common causes: passing an enum value from the wrong enum (e.g. `EdgeEffect.Spring` where `ScrollAlign.Start` is expected), passing `string` where a typed enum is expected, wrong callback signature. Fix: check the cookbook/enum tables above for the exact expected types

### Statements and expressions
- No destructuring of any kind (`arkts-no-destruct-decls/-assignment/-params`)
- All `import` statements must be at the top of the file, before any other statements (`arkts-no-misplaced-imports`)
- Every custom type, interface, or enum used in a file must be explicitly imported at the top — do not assume cross-file visibility
- No `delete`, `in`, `for...in`, `with`
- No indexed access `obj['k']` on non-Record; use dot access (`arkts-no-props-by-index`)
- `throw` only `Error`+subclasses; `catch (e)` no type annotation. System API errors: type as `BusinessError` from `@kit.BasicServicesKit`
- No `is` type guards; use `instanceof` + `as`
- Object spread restricted (array spread OK) (`arkts-no-spread`)
- No regex literals; use `new RegExp()` (`arkts-no-regexp-literals`)
- No `@ts-ignore` (`arkts-strict-typing-required`)

### Standard library and modules
- Banned: `eval`, `Object.assign/create/freeze/defineProperty`, `Reflect`/`Proxy`, `Symbol()` (except `.iterator`), `globalThis`
- No `import type`, side-effect imports, `require`, `export =`

### ArkUI structure
- `@Component` + `struct` + mandatory `build()` with **exactly one root** container
- `build()`/`@Builder`: only UI syntax — component calls, `if/else`, `ForEach` — no statements/variables
- Component syntax ONLY valid inside `build()`/`@Builder` — a plain closure with `Row() {...}` fails; use `@Builder` + `@BuilderParam` (see [`references/arkui-structure-rules.md` § 6](references/arkui-structure-rules.md))
- `@Builder` returns `void` — do NOT chain `.onClick(...)` on the call site
- `Button('label')` XOR children — never both (build error 10905202)
- Nested `ForEach`: each level needs DISTINCT item param names (`row`/`cell`, not `item`/`item`)
- Pick ONE decorator family: V1 (`@Component`/`@State`/`@Prop`/`@Link`) or V2 (`@ComponentV2`/`@Local`/`@Param`)
- **Member names must not collide with universal attributes** — `@State opacity`, `tabIndex`, `backgroundColor`, `width`, `height`, `scale` etc. fail. Use domain-specific names (`circleOpacity`, `currentTab`, `cardBgColor`)
- **Struct name ≠ imported type name** — alias the import or name the page `XxxPage`
- **One declaration per type** — shared types in ONE model file, imported everywhere (`arkts-no-decl-merging`)
- Custom decorators: WARNING-severity — still fix (`arkts-no-decorators-except-arkui`)
- Deprecated global APIs (`router.pushUrl`, `promptAction.showToast`, `animateTo`, `vp2px`) — use `this.getUIContext()` methods
- Every `main_pages.json` page needs exactly one `@Entry`; child components must NOT be listed
- `module.json5` `user_grant` permissions: both `reason` (existing `$string:` resource) and `usedScene` required

### Concurrency
- `@Sendable` has its own restrictions — see `references/arkts-rules.md` § 10

---

## Component cookbook ( do not guess signatures)

> Verified against SDK `.d.ts`, OpenHarmony **API 23** (6.1.0.105).

### Constructors

| Component | Constructor | Notes |
|-----------|-------------|-------|
| `Column`/`Row` | `Column({ space: 12 })` | spacing in constructor |
| `Flex` | `Flex({ direction, justifyContent, alignItems })` | `alignItems` takes `ItemAlign`; `space` is `{ main: LengthMetrics.vp(8) }` not a number |
| `Stack` | `Stack({ alignContent: Alignment.TopStart })` | **alignment via constructor ONLY — `.justifyContent()` and `.alignItems()` DO NOT EXIST on Stack, will cause compile error** |
| `List` | `List({ space: 8 })` | children must be `ListItem`/`ListItemGroup` |
| `Grid` | `Grid()` + `.columnsTemplate('1fr 1fr')` | children must be `GridItem` |
| `Tabs` | `Tabs({ barPosition: BarPosition.End, controller })` | children must be `TabContent` |
| `TabContent` | `TabContent()` | NO object param; label via `.tabBar(...)` |
| `Swiper` | `Swiper()` | `.autoPlay(true)`, `.indicator(true)` |
| `TextInput` | `TextInput({ placeholder, text: this.value })` | `.onChange((value: string) => {})` |
| `DatePicker` | `DatePicker({ start, end, selected })` | use `.onDateChange((value: Date) => {})` |
| `Progress` | `Progress({ value, total, type: ProgressType.Linear })` | |
| `Canvas` | `Canvas(this.context)` | context = `new CanvasRenderingContext2D(new RenderingContextSettings(true))` — Settings 类叫 **`RenderingContextSettings`** 不叫 `CanvasRenderingContext2DSettings` |

### Kit imports (wrong kit = compile error)

| Symbol | Correct kit |
|--------|------------|
| `router`, `promptAction`, `window` | `@kit.ArkUI` |
| `BusinessError` | `@kit.BasicServicesKit` |
| `hilog` | `@kit.PerformanceAnalysisKit` |
| `UIAbility`, `AbilityConstant`, `Want` | `@kit.AbilityKit` |
| `image` | `@kit.ImageKit` |
| `media` (AVPlayer, AVRecorder) | `@kit.MediaKit` |
| `audio` (AudioCapturer, AudioRenderer) | `@kit.AudioKit` (NOT `@kit.MediaKit`) |
| `preferences` | `@kit.ArkData` |
| `NavPathStack`, UI enums | **global, no import** |
| `display` | `@kit.ArkUI` |

### Modifier ownership (STRICT — unlisted modifiers DO NOT EXIST on that component)

- `Text`: `.fontSize()`, `.fontColor()`, `.fontWeight()`, `.fontStyle(FontStyle.Italic)`, `.textAlign()`, `.maxLines()`, `.textOverflow({ overflow: TextOverflow.Ellipsis })`
- `Image`: `.objectFit(ImageFit.Cover)`
- `Column`: `.alignItems(HorizontalAlign.X)` + `.justifyContent(FlexAlign.X)` — NO `.fontColor()`, NO `.flexWrap()`
- `Row`: `.alignItems(VerticalAlign.X)` + `.justifyContent(FlexAlign.X)` — NO `.fontColor()`, NO `.flexWrap()`
- `Stack`: alignment via `Stack({ alignContent: Alignment.X })` constructor ONLY — **NO `.justifyContent()`, NO `.alignItems()`**
- `Flex`: layout via `Flex({ direction, justifyContent, alignItems, wrap })` constructor — use Flex instead of Row/Column when you need wrap
- Universal (all components): `.width()`, `.height()`, `.backgroundColor()`, `.borderRadius()`, `.padding()`, `.margin()`, `.onClick()`

### Fabricated modifiers (DO NOT exist)

| ❌ Invented | ✅ Real |
|------------|--------|
| `.bgColor()` | `.backgroundColor()` |
| `.textSize()`/`.textColor()` | `.fontSize()`/`.fontColor()` |
| `.italic(true)`/`.bold()` | `.fontStyle(FontStyle.Italic)`/`.fontWeight(FontWeight.Bold)` |
| `.radius()` | `.borderRadius()` |
| `List({ gap })` | `List({ space })` |
| `.width('match_parent')` | `.width('100%')` |
| `.onClick((e: GestureEvent) =>)` | param is `ClickEvent` |
| `.justifyContent()`/`.alignItems()` on **Stack** | `Stack({ alignContent })` constructor only |
| `.flexWrap()` on Row/Column | `Flex({ wrap: FlexWrap.Wrap })` |
| `.columnsTemplate()` on **List** | `Grid` only |
| `.alignList()` on **List** | 不存在 |
| `.maxHeight(x)` | `.constraintSize({ maxHeight: x })` |
| `.barActiveColor()` etc. on Tabs | none exist; custom `@Builder` tab bar |
| `.onSizeChange((w, h) =>)` | sig: `(oldValue: SizeOptions, newValue: SizeOptions) => void` |

### Hallucinated names

| ❌ Wrong | ✅ Correct |
|---------|-----------|
| `Switch(...)` | `Toggle({ type: ToggleType.Switch, isOn })` |
| `TouchInfo` | `TouchEvent` |
| `ListAlign` | `ListItemAlign` |
| `TextAlign.CENTER` | `TextAlign.Center` |
| `Alignment.TopCenter` | `Alignment.Top` |
| `media.AvPlayerFdSrc` | 不存在；AVPlayer 用 `media.AVFileDescriptor` 或 url 字符串 |
| `picker.AudioSelectResult` | 不存在；AudioViewPicker.select() 返回 `Promise<Array<string>>` |
| `CanvasRenderingContext2DSettings` | `RenderingContextSettings` |
| `ScrollEdgeEffect` | 不存在；List/Scroll 边缘效果枚举叫 `EdgeEffect`（成员: `Spring` `Fade` `None`）|
| `ScrollAlign` confused with `EdgeEffect` | `ScrollAlign` 用于 `scrollToIndex()`（`Start` `Center` `End` `Auto`）；`EdgeEffect` 用于 `.edgeEffect()`——两者不可混用 |
| `NavigationTitleMode.Min` | `NavigationTitleMode.Mini` |
| `Preferences.getString(key)` / `.putString(key, val)` | 不存在；统一用 `getSync(key, default)` / `putSync(key, value)` — 见 `references/kit-api-quick-ref.md` § 8 |
| `.alignList(ListItemAlign.X)` on List | 不存在；List 无此属性 |
| `vp2px()` / `px2vp()` | 已废弃；用 `display.getDefaultDisplaySync().densityPixels` 换算 — 见 `references/kit-api-quick-ref.md` § 8 |

### Enum members (exact — do not guess)

| Enum | Members |
|------|---------|
| `GradientDirection` | `Left` `Top` `Right` `Bottom` `LeftTop` `LeftBottom` `RightTop` `RightBottom` `None` |
| `Alignment` | `TopStart` `Top` `TopEnd` `Start` `Center` `End` `BottomStart` `Bottom` `BottomEnd` |
| `HorizontalAlign` | `Start` `Center` `End` |
| `VerticalAlign` | `Top` `Center` `Bottom` |
| `FlexAlign` | `Start` `Center` `End` `SpaceBetween` `SpaceAround` `SpaceEvenly` |
| `TextAlign` | `Start` `Center` `End` `JUSTIFY` |
| `ItemAlign` | `Auto` `Start` `Center` `End` `Baseline` `Stretch` |
| `FontWeight` | `Lighter` `Normal` `Regular` `Medium` `Bold` `Bolder` (or 100–900) |
| `BarPosition` | `Start` `End` |
| `ImageFit` | `Contain` `Cover` `Auto` `Fill` `ScaleDown` `None` |
| `TextOverflow` | `None` `Clip` `Ellipsis` `MARQUEE` |
| `FlexDirection` | `Row` `RowReverse` `Column` `ColumnReverse` |
| `Visibility` | `Visible` `Hidden` `None` |
| `Curve` | `Linear` `Ease` `EaseIn` `EaseOut` `EaseInOut` `FastOutSlowIn` `Friction` `Sharp` `Smooth` |
| `ButtonType` | `Normal` `Capsule` `Circle` |
| `ToggleType` | `Checkbox` `Switch` `Button` |
| `ProgressType` | `Linear` `Ring` `Eclipse` `ScaleRing` `Capsule` |
| `InputType` | `Normal` `Password` `Email` `Number` `PhoneNumber` |
| `SliderChangeMode` | `Moving` `Begin` `End` `Click` |
| `EdgeEffect` | `Spring` `Fade` `None` |
| `ScrollAlign` | `Start` `Center` `End` `Auto` |
| `BarState` | `Off` `Auto` `On` |
| `BarMode` | `Scrollable` `Fixed` |
| `NavigationMode` | `Stack` `Split` `Auto` |
| `NavigationTitleMode` | `Full` `Mini` `Free` |
| `ScrollDirection` | `Vertical` `Horizontal` `None` |
| `Axis` | `Vertical` `Horizontal` |
| `BorderStyle` | `Dotted` `Dashed` `Solid` |
| `PlayMode` | `Normal` `Reverse` `Alternate` `AlternateReverse` |

Traps: `.renderMode()` takes `ImageRenderMode` not `ImageRenderingMode`; `DataPanelType` is `Circle`/`Line` not `Close`/`Ring`; `TextInputStyle` has no `Normal`; `SliderChangeMode` 没有 `Flick` — 用 `.Click`。Do not pass strings where an enum is expected.

### System resources (`$r('sys.…')`)

Never guess `sys.media.*`/`sys.symbol.*`/`sys.color.*` names — they usually don't exist. Default to text/emoji glyphs or app resources you create.

---

## Write workflow

> The cookbook tables and recipe files above are **verified against SDK `.d.ts`**. Trust them — do NOT re-derive or search for confirmation of signatures already listed here.

1. **Read `references/recipes-core.md` BEFORE writing the first file** — covers data models, navigation, layout in one read
2. Create shared model/constant files FIRST, then pages. **Write each file immediately** — do not plan all files in thinking before writing any. After each model file note: `EXPORTS: RouteParams.ets → DetailParams`
3. **Preflight check (BEFORE writing each `.ets` file)** — review the "Top-5 traps" table above. Specifically:
   - Will this file use destructuring? → rewrite to individual assignments
   - Does this file create object literals? → every one needs a type annotation (`interface`/`class`/`Record`)
   - Does this file use types from other files? → verify each is `export`-ed at source and `import`-ed here
   - Does this file import from `@kit.*`? → verify the kit name against the kit imports table (especially `audio` vs `media`)
4. Verify every type/enum/helper reference is actually declared and exported in the source file
5. Review per file: after each `.ets` file, check constraints and fix before starting the next file. When unsure about a modifier, enum, or constructor → check the cookbook tables above. When calling `@kit.*` namespace members → check `references/kit-api-quick-ref.md`

---

## Reference files (read on demand — only when the specific scenario arises)

| When you need... | Read |
|---|---|
| Data models, navigation, layout (Tabs/List/Grid) | `references/recipes-core.md` (read BEFORE first file) |
| Form input, DatePicker/TextPicker, dialogs/toasts | `references/recipes-forms.md` |
| System kit calls: file IO, permissions, photo picker, image, eventHub, media playback, audio recording | `references/kit-api-quick-ref.md` |
| Canvas game loop, touch handling, screen size | `references/kit-api-quick-ref.md` § 8 |
| `does not meet UI component syntax` / structural build errors / callback type traps | `references/arkui-structure-rules.md` |
| Error message contains an `arkts-xxx` rule tag | `references/arkts-rules.md` |
| Migrating TypeScript/Android code | `references/ts-to-arkts-rewrites.md` |
| Sendable / concurrency | `references/arkts-rules.md` § 10 |
| UI quality review before finalizing | `references/ui-quality-checklist.md` |
