# ArkUI Structure Rules

Structural constraints on `struct` / `@Component` / `build()` that the ArkUI compiler enforces. These have **no `arkts-*` rule tag** — type-level checks do not catch them and they only surface at build time, so getting them right up front saves a full build round-trip.

Each section is keyed to the exact compiler error message it prevents.

## 1. `build()` has exactly one root node

> Error: `In an '@Entry' decorated component, the 'build' method can have only one root node, which must be a container component.`
> Error: `In an '@Component' decorated component, the 'build' method can have only one root node.`

```ets
// ❌ two sibling roots
build() {
  Text('标题')
  Column() { ... }
}

// ✅ one root container wrapping everything
build() {
  Column() {
    Text('标题')
    ...
  }
}
```

Rules:

- `build()` contains exactly ONE top-level component.
- For `@Entry` pages the root must be a **container** (`Column`, `Row`, `Stack`, `Flex`, `RelativeContainer`, ...), not a leaf like `Text`.
- `if/else` at the root counts as multiple possible roots for `@Entry` — wrap it in a container.
- The same single-root rule applies to each branch of conditional rendering inside `@Builder` functions used as page content.

## 2. Only UI component syntax inside `build()` / `@Builder`

> Error: `Only UI component syntax can be written here.` (code `10905209`)
> Error: `Assignment does not meet UI component syntax.` (code `10905204`)
> Error: `UI component 'Column' cannot be used in this place.`

Inside `build()` and `@Builder` bodies, the ONLY allowed constructs are:

- Component calls with their trailing blocks and chained modifiers
- `if / else if / else`
- `ForEach` / `LazyForEach` / `Repeat`

Everything else is illegal there: `let`/`const` declarations, assignments, `console.log`, `for`/`while` loops, `try/catch`, early `return`, function calls as statements.

```ets
// ❌ statements inside build
build() {
  Column() {
    let label = this.count + ''     // illegal
    console.log('render')           // illegal
    Text(label)
  }
}

// ✅ compute in methods/getters, render in build
get label(): string {
  return `${this.count}`
}

build() {
  Column() {
    Text(this.label)
  }
}
```

Rules:

- Precompute values in class methods, getters, or state; `build()` only renders.
- Conversely, UI component calls (`Column() {...}`, `Text(...)` as UI) may ONLY appear inside `build()` / `@Builder` bodies — never in ordinary methods, event handlers, or at top level. To return UI from a function, decorate it with `@Builder`.
- Loops other than `ForEach` cannot emit UI. Convert `for` loops to a data array + `ForEach`.

## 3. Struct member area: declarations and methods only

> Error: `'HomeTab({ ... })' does not meet UI component syntax.`
> Error: `Declaration or statement expected.` / cascading `';' expected.`

The struct body outside `build()` holds ONLY: decorated/plain field declarations, methods, `@Builder`/`@Styles` methods, and lifecycle callbacks (`aboutToAppear` etc.).

A single malformed edit in the member area (an unclosed brace, a statement, a misplaced component call) cascades: every following `@State` line then reports `does not meet UI component syntax` or parser errors. **When these errors appear in a block, fix the FIRST one — the rest are usually fallout.**

```ets
// ❌ component call in the member area
@Component
struct Index {
  @State medications: MedicationInfo[] = []
  HomeTab({ medications: $medications })   // illegal here — must be inside build()

  build() { ... }
}

// ✅
@Component
struct Index {
  @State medications: MedicationInfo[] = []

  build() {
    Column() {
      HomeTab({ medications: $medications })
    }
  }
}
```

## 4. Custom component instantiation and `@Link` passing

> Error: `'CompName({ ... })' does not meet UI component syntax.`
> Error: `The '@Link' property 'x' cannot be initialized here (forbidden to specify default value for @Link).`

```ets
// Child (V1)
@Component
struct HomeTab {
  @Link medications: MedicationInfo[]      // no initializer on @Link
  @Prop title: string = ''                  // @Prop may have a local default

  build() { ... }
}

// Parent build()
HomeTab({ medications: $medications, title: this.title })
```

Rules:

- Instantiate custom components only inside `build()`/`@Builder`, as `CompName({ ... })` with named arguments.
- V1 `@Link` fields: parent passes `$varName` (two-way binding); the child must NOT give `@Link` an initializer.
- `@Prop` receives plain values (`this.x`); `@BuilderParam` receives a `@Builder` function reference.
- Do not pass fields the child does not declare; argument names must match child member names exactly.

## 5. One decorator family per component (V1 xor V2)

> Error: `The '@State' decorator can only be used in a 'struct' decorated with '@Component'.` (and mirror-image V2 errors)

| | V1 family | V2 family |
|---|---|---|
| Component | `@Component` | `@ComponentV2` |
| Local state | `@State` | `@Local` |
| Parent input | `@Prop` | `@Param` (+ `@Once`) |
| Two-way | `@Link` (`$var` from parent) | `@Param` + `@Event` callback |
| Cross-level | `@Provide` / `@Consume` | `@Provider` / `@Consumer` |
| Observed class | `@Observed` + `@ObjectLink` | `@ObservedV2` + `@Trace` |

Rules:

- Never mix families inside one struct. `@ComponentV2` + `@State` is a build error; so is `@Component` + `@Local`.
- Follow whichever family the project already uses; do not migrate between families unless explicitly asked.
- State decorators go on struct member declarations only — never on top-level variables, local variables, or plain class fields (use `@Observed`/`@Trace` for classes).

## 6. `@Builder` / `@Styles` / `@Extend` placement

- `@Builder` methods: inside a struct (access `this`) or global. Called from `build()` either directly (`this.myBuilder()`) or passed to `@BuilderParam` / `.tabBar(...)` etc.
- Component syntax does NOT parse inside ordinary closures. Factoring a repeated form section as a regular method taking a content callback fails at parse time:

  ```ets
  // ❌ content is a plain () => void — Row(){...} inside it is a syntax-error cascade
  //    (';' expected / Declaration or statement expected / Cannot find name 'width')
  buildSection(title: string, content: () => void) { ... }
  this.buildSection('提醒时间', () => { Row() { TextInput() } })

  // ✅ each section is a @Builder method; shared chrome via another @Builder or a child
  //    component with @BuilderParam
  @Builder timeSection() { Row() { TextInput() } }
  // child component receiving layout:
  @Component struct FormSection {
    title: string = '';
    @BuilderParam content: () => void;   // receives a @Builder reference
    build() { Column() { Text(this.title); this.content() } }
  }
  // parent build(): FormSection({ title: '提醒时间', content: this.timeSection })
  ```
- A `@Builder` method call returns `void` — you CANNOT chain attributes or events on the call site:

  ```ets
  // ❌ chaining on a @Builder call — error: Property 'onClick' does not exist on type 'void'.
  this.capsuleCard(item)
    .onClick(() => { this.openDetail(item.id) })

  // ✅ option A: pass the handler in as a parameter, attach it to the builder's root component
  @Builder capsuleCard(item: CapsuleItem, onCardClick: () => void) {
    Column() { ... }
    .onClick(onCardClick)
  }
  // call site: this.capsuleCard(item, () => { this.openDetail(item.id) })

  // ✅ option B: wrap the call in a container and attach attributes to the container
  Column() { this.capsuleCard(item) }
  .onClick(() => { this.openDetail(item.id) })
  ```

  (Chaining on a **custom component** instantiation `MyCard({...}).onClick(...)` is legal — the void restriction is specific to `@Builder` calls.)
- `@Styles` can only contain universal attribute settings; component-specific modifiers (e.g. `.fontSize`) belong in `@Extend(Text)`.
- `@Extend` is global-only (outside the struct).
- Pass builder functions by reference (`this.myBuilder`) where a builder param is expected — do not invoke with `()` when passing.

## 7. Build-only traps the type check does NOT catch

Both of these pass `arkts_check`-style type checking and fail only when hvigor compiles — get them right up front or they cost a full build round.

### Button: label parameter XOR child content

> Error: `10905202 ArkTS Compiler Error: The Button component with a label parameter can not have any child.`

```ets
// ❌ label argument AND a child block (observed ×3 in one page — the pattern copy-pastes)
Button('开始游戏') {
  Image($r('app.media.play'))
}

// ✅ either a pure label...
Button('开始游戏')

// ✅ ...or children only, with the text as a child
Button() {
  Row({ space: 6 }) {
    Image($r('app.media.play')).width(20)
    Text('开始游戏').fontColor(Color.White)
  }
}
```

### Nested ForEach: item parameters must have distinct names

> Error (Rollup, at build): `00305015 Identifier '_item' has already been declared`

ForEach lambdas compile into scoped `_item` variables; nesting two ForEach levels whose lambdas both name the parameter `item` collides after transformation. The type checker accepts it — only the build fails.

```ets
// ❌ both levels use `item`
ForEach(this.board, (item: Row15, rowIdx: number) => {
  ForEach(item.cells, (item: Cell) => {   // same name shadows — build error
    ...
  }, (item: Cell) => item.id)
}, (item: Row15) => item.id)

// ✅ name each level after its element
ForEach(this.board, (row: Row15, rowIdx: number) => {
  ForEach(row.cells, (cell: Cell) => {
    ...
  }, (cell: Cell) => cell.id)
}, (row: Row15) => row.id)
```

## 8. Callback type traps

Callback signatures that commonly trip up code because their parameter types are wider than expected:

| Callback | Signature | Trap |
|----------|-----------|------|
| `.onAreaChange()` | `(oldValue: Area, newValue: Area) => void` | `Area.width`/`height` type is `Length` (= `number \| string \| Resource`), not `number` — use `Number(newValue.width)` or `newValue.width as number` to convert |
| `.onSizeChange()` | `(oldValue: SizeOptions, newValue: SizeOptions) => void` | `SizeOptions` width/height is `Length \| undefined` — same conversion needed |

## 9. Page-level requirements

- Exactly one `@Entry` struct per page `.ets` file; the file must be registered in `main_pages.json` (or routed via Navigation) to be reachable.
- `@Entry` struct name and file naming should follow the project's existing pages.
- Lifecycle methods (`aboutToAppear`, `onPageShow`, ...) are ordinary methods in the member area — they may contain arbitrary statements (rules in § 2 apply only to `build()`/`@Builder`).
