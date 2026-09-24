# Recipes: Data model, Navigation, Layout

Verified shapes — copy them, do not improvise. Read this file once BEFORE writing code.

---

## 1. Data model + detail page

`Object is possibly 'undefined'` concentrates in one shape: optional fields consumed by a detail page. Kill it at the design level:

```ets
// Model: real initial values, not `?:` everywhere.
export class Capsule {
  id: string = '';
  title: string = '';
  createdAt: number = 0;
  openedAt: number | undefined = undefined; // truly optional state
}

// Detail page: narrow the lookup ONCE, then build() reads plain fields.
@Component
struct CapsuleDetail {
  @State capsule: Capsule = new Capsule();

  aboutToAppear(): void {
    const found: Capsule | undefined = DataStore.find(this.capsuleId);
    if (found !== undefined) {
      this.capsule = found;
    }
  }

  build() {
    Column() {
      Text(this.capsule.title)
      if (this.capsule.openedAt !== undefined) {
        Text(formatTime(this.capsule.openedAt))
      }
    }
  }
}
```

- Static members: reference through CLASS NAME (`Store.items.push(x)`), not `this.x` in static methods.
- Shared types: declare ONCE in the model file, export, import everywhere — never re-declare per page.

### Creating instances with data

**Class-body defaults do NOT make fields optional in an object literal.** Every field must be listed.

```ets
// omits openedAt — fails with 'missing properties'
const seed: Capsule[] = [{ id: '1', title: 'First', createdAt: 0 }];

// Option A: list every field
const seed: Capsule[] = [
  { id: '1', title: 'First', createdAt: 0, openedAt: undefined },
];

// Option B (preferred): static factory
export class Capsule {
  static of(id: string, title: string, createdAt: number): Capsule {
    const c = new Capsule();
    c.id = id; c.title = title; c.createdAt = createdAt;
    return c;
  }
}
```

---

## 2. Navigation and router params

### Router params (the ONE verified shape)

```ets
// model/RouteParams.ets — declared ONCE in a shared file
import { router } from '@kit.ArkUI';

export interface DetailParams {
  capsuleId: string;
}

// Sender: params must be a NAMED interface instance
import { DetailParams } from '../model/RouteParams';
const p: DetailParams = { capsuleId: this.id };
this.getUIContext().getRouter().pushUrl({ url: 'pages/Detail', params: p });

// Receiver: getParams() returns Object — cast, then null-safe access
import { DetailParams } from '../model/RouteParams';
const params = this.getUIContext().getRouter().getParams() as DetailParams;
const id: string = params?.capsuleId ?? '';
```

- Do NOT re-declare the params interface in each page (`arkts-no-decl-merging`).
- `NavPathStack` is a GLOBAL type — importing it from `@kit.ArkUI` fails.
- Pages in `main_pages.json` must have exactly one `@Entry` struct.

### Common wrong fixes for router params (avoid these — each leads to the next error)

1. Bare object literal `{ url: '...', params: { id: x } }` → `arkts-no-untyped-obj-literals`
2. Cast `as Record<string, Object>` → `not assignable to RouterOptions`
3. Import `RouterOptions` from `@system.router` → wrong module, type mismatch with `@ohos.router`
4. Re-declare params interface in each page → `arkts-no-decl-merging`

Skip straight to the verified shape above.

---

## 3. Tabs, List/Grid + ForEach, gradients

### Tabs

```ets
Tabs({ barPosition: BarPosition.End }) {
  TabContent() {
    Column() { Text('Home') }
  }.tabBar('Home')

  TabContent() {
    Column() { Text('Discover') }
  }.tabBar('Discover')
}
.onChange((index: number) => { this.currentTab = index })
```

- `TabContent()` has NO object parameter. Label goes in `.tabBar(...)`.
- Tabs has NO `barActiveColor`/`indicatorColor`/`selectedMode` — custom styling uses a `@Builder` tab bar.

### List/Grid + ForEach

```ets
Grid() {
  ForEach(this.cards, (item: CardItem) => {
    GridItem() { Text(item.title) }
  }, (item: CardItem) => item.id)
}
.columnsTemplate('1fr 1fr')
```

- `ListItem` in `List`, `GridItem` in `Grid`. Key generator must return a stable string.
- `ListItemGroup` header/footer are **constructor parameters**, NOT chained attribute methods:
  ```ets
  // ✅ correct
  ListItemGroup({ header: this.headerBuilder, footer: this.footerBuilder }) {
    ForEach(this.items, (item: MyItem) => {
      ListItem() { Text(item.name) }
    }, (item: MyItem) => item.id)
  }

  // ❌ wrong — '.header' does not exist on ListItemGroupAttribute
  ListItemGroup() { ... }.header(this.headerBuilder)
  ```
  Pass `header` / `footer` as `@Builder` functions via the constructor object. The component has NO `.header()` / `.footer()` modifier methods.
- **Nested ForEach: distinct param names** (`row`/`cell`, not `item`/`item`).
- Multi-column list = `Grid` — `List` has no `columnsTemplate`.

### linearGradient

```ets
Column().linearGradient({
  angle: 135,
  colors: [['#0C0C1D', 0.0], ['#1A1A3E', 0.5], ['#252545', 1.0]]
})
```

- `colors`: array of `[color, stop]` pairs, stops in `[0, 1]`.
- Member names: `LeftTop`/`RightBottom` order (NO `BottomRight`/`TopLeft`).
