# TypeScript → ArkTS Rewrite Table

Use this when migrating TypeScript code or diagnosing "runs in TS, errors in ArkTS" issues. For rule-tag details, see `arkts-rules.md`.

## First, remember: many TS constructs need NO change in ArkTS

Template literals, `value as T`, `Record<K,V>` with indexed access, arrow functions, async/await — all legal. Do **not** rewrite them. Full whitelist: [`arkts-rules.md` § Explicitly allowed constructs](arkts-rules.md#explicitly-allowed-constructs).

## Quick rewrite table

The Rule tag column matches linter error messages one-to-one — search the tag in `arkts-rules.md` for details and examples.

| TypeScript construct | ArkTS rewrite | Rule tag |
|---------------------|---------------|----------|
| `var x = 1` | `let x = 1` / `const x = 1` | `arkts-no-var` |
| `let x: any` / `unknown` | Explicit type; when undetermined use `Object` or a union type | `arkts-no-any-unknown` |
| `const { a, b } = obj` | `const a = obj.a; const b = obj.b` | `arkts-no-destruct-decls` |
| `function f({ a }: P)` | `function f(p: P)` then use `p.a` | `arkts-no-destruct-params` |
| `[x, y] = [y, x]` | Introduce a temp variable, assign one by one | `arkts-no-destruct-assignment` |
| `const fn = function() {}` | `const fn = () => {}` | `arkts-no-func-expressions` |
| `const id = <T>(v: T): T => v` | `function id<T>(v: T): T { return v }` | `arkts-no-generic-lambdas` |
| `function inner() {}` inside a function body | `const inner = (): void => {}` or promote to a class method | `arkts-no-nested-funcs` |
| `<string>value` | `value as string` | `arkts-as-casts` |
| `obj as const` | Declare the constant type explicitly | `arkts-no-as-const` |
| `type T = { x: number }` | `interface T { x: number }` | `arkts-no-obj-literals-as-types` |
| `f(p: { x: number })` | Define a named interface as the parameter type | `arkts-no-obj-literals-as-types` |
| `interface I { [key: string]: T }` | `Record<string, T>` | `arkts-no-indexed-signatures` |
| `type C = A & B` | `interface C extends A, B {}` | `arkts-no-intersection-types` |
| `type N = T['prop']` | Use the target type directly | `arkts-no-aliases-by-index` |
| `obj['key']` (non-Record) | `obj.key`; for dynamic keys declare the type as `Record` | `arkts-no-props-by-index` |
| `const o = { a: 1 }` (untyped) | `const o: MyIface = { a: 1 }` or `Record` | `arkts-no-untyped-obj-literals` |
| `Pick` / `Omit` / `ReturnType` etc. | Hand-write a named interface | `arkts-no-utility-types` |
| `delete obj.x` | Add `\| undefined` to the field type, set `obj.x = undefined` | `arkts-no-delete` |
| `'key' in obj` | `obj.key !== undefined` or `instanceof` | `arkts-no-in` |
| `for (const k in obj)` | `for...of` / `Map` / a known key list | `arkts-no-for-in` |
| `v is Cat` (type guard) | `instanceof` check + `as` narrowing | `arkts-no-is` |
| `{ ...obj1, ...obj2 }` | Construct a new object, assign fields explicitly | `arkts-no-spread` |
| `throw 'msg'` | `throw new Error('msg')` | `arkts-limited-throw` |
| `catch (e: Error)` | `catch (e)` then `const err = e as Error` | `arkts-no-types-in-catch` |
| `class C { constructor(public x: number) {} }` | Declare fields in the class body, assign in the constructor | `arkts-no-ctor-prop-decls` |
| `#privateField` | `private privateField` | `arkts-no-private-identifiers` |
| `class D implements Base` (Base is a class) | `extends Base`, or extract an interface | `arkts-implements-only-iface` |
| `function* gen() { yield }` | Return an array/iterator class, or refactor to a plain function | `arkts-no-generators` |
| `fn.bind(this)` | Arrow function capturing this | `arkts-no-func-bind` |
| `/pattern/g` | `new RegExp("pattern", "g")` | `arkts-no-regexp-literals` |
| `Object.assign(t, s)` | Assign fields explicitly or use a constructor | `arkts-limited-stdlib` |
| `obj.hasOwnProperty('k')` | `obj.k !== undefined` | `arkts-limited-stdlib` |
| `globalThis.x` | An explicitly exported singleton / AppStorage | `arkts-no-globalthis` |
| `// @ts-ignore` | Fix the underlying type error; suppression is banned | `arkts-strict-typing-required` |
| `import type { T }` | `import { T }` | `arkts-no-special-imports` |
| `import './polyfill'` | Remove; import the needed symbols explicitly | `arkts-no-side-effects-imports` |
| `import x = require('m')` | `import x from 'm'` | `arkts-no-require` |
| `export = X` | `export default X` | `arkts-no-export-assignment` |
| `const api = SomeNamespace` (namespace as value) | Call `SomeNamespace.member()` directly, or define an explicit object | `arkts-no-ns-as-obj` |
| `router.getParams() as MyInterface` then `new MyInterface()` | `interface`/`type` aliases cannot be instantiated — use `as` cast only; for construction use a `class` | TS2693 |

## Typical composite rewrite examples

### Dynamic object → Record / named type
```typescript
// TypeScript original
function printProperties(obj: any) {
  console.info(obj.name);
}
```
```ets
// ArkTS (official recommendation)
function printProperties(obj: Record<string, Object>) {
  console.info(obj.name as string);
}
// Better when property names are fixed: a named interface
interface Props { name: string }
function printProperties(obj: Props) {
  console.info(obj.name);
}
```

### Structural typing → nominal typing
```typescript
// TypeScript original: identical structure is interchangeable
interface Point { x: number; y: number }
const p = { x: 1, y: 2 };
draw(p);
```
```ets
// ArkTS: the type membership must be declared
const p: Point = { x: 1, y: 2 };
draw(p);
```

### Nested function + this → class method
```typescript
// TypeScript original
function process() {
  function helper() { ... }
  helper();
}
```
```ets
// ArkTS
class Processor {
  process(): void { this.helper() }
  private helper(): void { ... }
}
```

### Interface/type used as a value (TS2693: 'X' only refers to a type)
```typescript
// TypeScript original — interface used where a value is expected
interface ResultParams { taxAmount: string }
const r = ResultParams;           // ❌ TS2693
JSON.parse(str) as ResultParams;  // ✅ cast is fine — interface is a type position
```
```ets
// ArkTS — if you need to construct instances, use a class
export class ResultParams {
  taxAmount: string = '';
}
const r = new ResultParams();     // ✅ class IS a value
r.taxAmount = '5000';

// If only used for casting router params, an interface + `as` is enough:
import { ResultParams } from '../model/ResultParams';
const params = this.getUIContext().getRouter().getParams() as ResultParams;
const amount: string = params?.taxAmount ?? '';
```
