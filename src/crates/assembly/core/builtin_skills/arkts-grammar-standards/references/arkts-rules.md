# ArkTS Syntax Rules Dictionary

Complete ArkTS linter rule reference. Rules are anchored to official rule tags (`arkts-*`), matching compiler/linter error messages one-to-one.

- Target version: **ArkTSLinter 1.1** (standard ArkTS, not arkts-1.2 strict mode)
- Main difference vs 1.0: Rule 140 narrowed from `arkts-no-func-apply-bind-call` (bans apply/bind/call) to `arkts-no-func-bind` (bans only `Function.bind`)
- Sources: linter rule set + the official "TypeScript to ArkTS Migration Guide" (typescript-to-arkts-migration-guide)

---

## Explicitly allowed constructs

Commonly mis-banned — do not avoid these "defensively". This table is the **single source of truth** for the whitelist (SKILL.md and ts-to-arkts-rewrites.md only carry pointers here).

The following are **fully legal** in ArkTS; use them normally when generating code:

| Construct | Notes |
|-----------|-------|
| Template literals `` `Count: ${count}` `` | Fully supported; `Text(`${this.msg}`)` is idiomatic ArkUI |
| `value as T` assertions | `as` is the **only** supported assertion syntax (`arkts-as-casts` bans the angle-bracket form `<T>value`, not `as`) |
| `Record<K, V>` | Officially supported utility type and the **recommended** replacement for index signatures; indexed access `rec['key']` on a `Record` is allowed (result type includes `undefined`) |
| `Partial<T>` / `Required<T>` / `Readonly<T>` | Officially supported (`Partial<T>`'s T must be a class or interface) |
| Arrow functions (including as passed values) | Recommended style |
| `async` / `await` / `Promise` | Supported |
| Getters / setters | Supported |
| Generic classes, interfaces, functions (`function f<T>()`) | Supported (generic **arrow functions** excepted — see `arkts-no-generic-lambdas`) |
| Array spread: `[...arr1, ...arr2]` | Array spread is supported (object spread — see `arkts-no-spread`) |
| `typeof x` in expression context | Supported (type context `type T = typeof x` is banned — see `arkts-no-type-query`) |
| `new RegExp("pattern")` | Supported (regex **literals** `/pattern/` are banned — see `arkts-no-regexp-literals`) |
| Union types `A \| B`, type aliases (non-object-literal form) | Supported |
| `for...of`, `Map`, `Set` | Supported |

---

## Rule Index

83 rules. Severity: ERROR must be fixed; WARNING should be fixed. Migratable = Yes means a mechanical rewrite exists.

| Ref | Rule Tag | Severity | Migratable | Description |
|-----|----------|----------|------------|-------------|
| 1 | `arkts-identifiers-as-prop-names` | ERROR | Yes | Object property names must be valid identifiers (or string literals) |
| 2 | `arkts-no-symbol` | ERROR | - | `Symbol()` API is not supported (except `Symbol.iterator`) |
| 3 | `arkts-no-private-identifiers` | ERROR | Yes | `#` private fields are not supported; use `private` |
| 4 | `arkts-unique-names` | ERROR | Yes | Type and namespace names must be unique |
| 5 | `arkts-no-var` | ERROR | Yes | Use `let`/`const` instead of `var` |
| 8 | `arkts-no-any-unknown` | ERROR | - | `any` and `unknown` are banned; use explicit types |
| 14 | `arkts-no-call-signatures` | ERROR | - | Replace call-signature types with `class` |
| 15 | `arkts-no-ctor-signatures-type` | ERROR | - | Replace constructor-signature types with `class` |
| 16 | `arkts-no-multiple-static-blocks` | ERROR | - | Only one `static` block per class |
| 17 | `arkts-no-indexed-signatures` | ERROR | - | Index signatures are not supported; use `Record<K,V>` or concrete types |
| 19 | `arkts-no-intersection-types` | ERROR | - | Intersection types `A & B` are not supported; use inheritance |
| 21 | `arkts-no-typing-with-this` | ERROR | - | `this` type annotations are not supported |
| 22 | `arkts-no-conditional-types` | ERROR | - | Conditional types `T extends U ? X : Y` are not supported |
| 25 | `arkts-no-ctor-prop-decls` | ERROR | Yes | Constructor parameter properties are not supported; declare fields in the class body |
| 27 | `arkts-no-ctor-signatures-iface` | ERROR | - | Constructor signatures are not supported in interfaces |
| 28 | `arkts-no-aliases-by-index` | ERROR | - | Indexed access types `T['prop']` are not supported |
| 29 | `arkts-no-props-by-index` | ERROR | Yes | Indexed field access is banned on plain objects (`Record` types excepted) |
| 30 | `arkts-no-structural-typing` | ERROR | - | Structural typing is not supported; use explicit inheritance/implementation |
| 34 | `arkts-no-inferred-generic-params` | ERROR | Yes | Type inference for generic calls is limited; annotate explicitly |
| 37 | `arkts-no-regexp-literals` | ERROR | - | Regex literals are not supported; use `new RegExp()` |
| 38 | `arkts-no-untyped-obj-literals` | ERROR | - | Object literals must correspond to an explicitly declared class/interface/Record |
| 40 | `arkts-no-obj-literals-as-types` | ERROR | - | Object literals cannot be used as type declarations; use `interface` |
| 43 | `arkts-no-noninferrable-arr-literals` | ERROR | - | Array literal element types must be inferrable |
| 46 | `arkts-no-func-expressions` | ERROR | Yes | Replace function expressions with arrow functions |
| 49 | `arkts-no-generic-lambdas` | ERROR | Yes | Replace generic arrow functions with generic function declarations |
| 50 | `arkts-no-class-literals` | ERROR | Yes | Class expressions are not supported; use named class declarations |
| 51 | `arkts-implements-only-iface` | ERROR | - | `implements` only accepts interfaces, not classes |
| 52 | `arkts-no-method-reassignment` | ERROR | - | Reassigning object methods is not supported |
| 53 | `arkts-as-casts` | ERROR | Yes | Type assertions support only `as T`; `<T>value` is banned |
| 54 | `arkts-no-jsx` | ERROR | - | JSX is not supported |
| 55 | `arkts-no-polymorphic-unops` | ERROR | - | Unary `+` `-` `~` work only on numbers |
| 59 | `arkts-no-delete` | ERROR | - | The `delete` operator is not supported |
| 60 | `arkts-no-type-query` | ERROR | - | `typeof` is allowed only in expression contexts |
| 65 | `arkts-instanceof-ref-types` | ERROR | - | `instanceof` supports only reference types (classes) |
| 66 | `arkts-no-in` | ERROR | - | The `in` operator is not supported |
| 69 | `arkts-no-destruct-assignment` | ERROR | Yes | Destructuring assignment is not supported |
| 71 | `arkts-no-comma-outside-loops` | ERROR | - | The comma operator is allowed only inside `for` loops |
| 74 | `arkts-no-destruct-decls` | ERROR | Yes | Destructuring variable declarations are not supported |
| 79 | `arkts-no-types-in-catch` | ERROR | Yes | `catch` clauses cannot carry type annotations |
| 80 | `arkts-no-for-in` | ERROR | - | `for...in` is not supported; use `for...of` |
| 83 | `arkts-no-mapped-types` | ERROR | - | Mapped types are not supported |
| 84 | `arkts-no-with` | ERROR | - | The `with` statement is not supported |
| 87 | `arkts-limited-throw` | ERROR | Yes | `throw` accepts only `Error` and its subclasses |
| 90 | `arkts-no-implicit-return-types` | ERROR | Yes | Function return type inference is limited; annotate explicitly |
| 91 | `arkts-no-destruct-params` | ERROR | - | Parameter destructuring is not supported |
| 92 | `arkts-no-nested-funcs` | ERROR | Yes | Nested function declarations are not supported; use arrow-function values or class methods |
| 93 | `arkts-no-standalone-this` | ERROR | - | `this` cannot be used in standalone functions |
| 94 | `arkts-no-generators` | ERROR | - | Generator functions and `yield` are not supported |
| 96 | `arkts-no-is` | ERROR | - | `is` type guards are not supported; use `instanceof`/`as` |
| 99 | `arkts-no-spread` | ERROR | - | Spread supports only arrays (and array-derived classes); object spread to arbitrary targets is not supported |
| 102 | `arkts-no-extend-same-prop` | ERROR | - | An interface cannot extend multiple interfaces with the same method |
| 103 | `arkts-no-decl-merging` | ERROR | - | Declaration merging is not supported |
| 104 | `arkts-extends-only-class` | ERROR | - | Interfaces cannot extend classes |
| 106 | `arkts-no-ctor-signatures-funcs` | ERROR | - | Constructor function types are not supported |
| 111 | `arkts-no-enum-mixed-types` | ERROR | - | Enum members can only be initialized with compile-time constants of the same type |
| 113 | `arkts-no-enum-merging` | ERROR | - | `enum` declaration merging is not supported |
| 114 | `arkts-no-ns-as-obj` | ERROR | - | Namespaces cannot be used as objects |
| 116 | `arkts-no-ns-statements` | ERROR | - | Non-declaration statements are not supported in namespaces |
| 118 | `arkts-no-special-imports` | ERROR | - | `import type` declarations are not supported |
| 119 | `arkts-no-side-effects-imports` | ERROR | - | Side-effect-only imports `import './module'` are not supported |
| 120 | `arkts-no-import-default-as` | ERROR | Yes | `import { default as x }` is not supported |
| 121 | `arkts-no-require` | ERROR | - | `require` and import assignment are not supported |
| 126 | `arkts-no-export-assignment` | ERROR | - | `export =` is not supported |
| 127 | `arkts-no-special-exports` | ERROR | - | `export type` declarations are not supported |
| 128 | `arkts-no-ambient-decls` | ERROR | - | Ambient module declarations are not supported |
| 129 | `arkts-no-module-wildcards` | ERROR | - | Wildcards in module names are not supported |
| 130 | `arkts-no-umd` | ERROR | - | UMD is not supported |
| 132 | `arkts-no-new-target` | ERROR | - | `new.target` is not supported |
| 134 | `arkts-no-definite-assignment` | WARNING | - | Definite assignment assertions `let x!: number` are not supported |
| 136 | `arkts-no-prototype-assignment` | ERROR | - | Prototype assignment is not supported |
| 137 | `arkts-no-globalthis` | ERROR | - | `globalThis` is not supported |
| 138 | `arkts-no-utility-types` | ERROR | - | Utility types: only Partial/Required/Readonly/Record are supported |
| 139 | `arkts-no-func-props` | ERROR | - | Declaring properties on functions is not supported |
| 140 | `arkts-no-func-bind` | ERROR | - | `Function.bind` is not supported (1.0 also banned apply/call) |
| 142 | `arkts-no-as-const` | ERROR | - | `as const` assertions are not supported |
| 143 | `arkts-no-import-assertions` | ERROR | - | Import assertions are not supported |
| 144 | `arkts-limited-stdlib` | ERROR | - | Standard library APIs are restricted (see details) |
| 145 | `arkts-strict-typing` | ERROR | - | Strict type checking is enforced |
| 146 | `arkts-strict-typing-required` | ERROR | - | Suppressing type checks via comments (`@ts-ignore` etc.) is banned |
| 147 | `arkts-no-ts-deps` | ERROR | - | ArkTS modules cannot depend on TypeScript code |
| 148 | `arkts-no-decorators-except-arkui` | WARNING | - | Only ArkUI decorators are allowed |
| 149 | `arkts-no-classes-as-obj` | ERROR | - | Classes cannot be used as objects |
| 150 | `arkts-no-misplaced-imports` | ERROR | - | `import` must precede all other statements |
| 151 | `arkts-limited-esobj` | WARNING | - | `ESObject` is limited to JS interop scenarios |

---

## Rule Details by Category

### 1. Type system

#### Rule 8: No `any` / `unknown` (`arkts-no-any-unknown`)
```ets
// ❌
let x: any;
const y: unknown = getValue();
// ✅
let x: string;
const y: string = getValue();
// ✅ When the type is genuinely undetermined, use Object or a concrete union type
function process(input: string | number): void {}
```

#### Rule 19: Replace intersection types with inheritance (`arkts-no-intersection-types`)
```ets
// ❌
type Combined = TypeA & TypeB;
// ✅
interface Combined extends TypeA, TypeB {}
```

#### Rule 17: Replace index signatures with `Record` (`arkts-no-indexed-signatures`)
```ets
// ❌
interface Conf { [key: string]: string }
function foo(data: { [key: string]: string }): void {}
// ✅ Official recommended rewrite
function foo(data: Record<string, string>): void {
  data['a'] = 'a';   // indexed access on Record is allowed
}
```

#### Rules 22 / 83 / 28 / 21: Unsupported advanced types
```ets
type A<T> = T extends string ? string : number;       // ❌ conditional type (22)
type B<T> = { readonly [P in keyof T]: T[P] };        // ❌ mapped type (83)
type C = SomeType['name'];                            // ❌ indexed access type (28)
type D = { getThis: () => this };                     // ❌ this type annotation (21)
```

#### Rule 30: No structural typing (`arkts-no-structural-typing`)
ArkTS uses nominal typing: two types with identical structure but no inheritance/implementation relationship are not interchangeable.
```ets
interface Point { x: number; y: number }
interface Point2D { x: number; y: number }
function printPoint(p: Point): void {}
const p2: Point2D = { x: 1, y: 2 };
printPoint(p2);              // ❌ same structure, incompatible types
// ✅ make Point2D extend Point, or just use Point
```

#### Rule 138: Only four utility types supported (`arkts-no-utility-types`)
Official wording: **only `Partial`, `Required`, `Readonly`, and `Record` are supported**.
- `Partial<T>`'s generic parameter T must be a class or interface
- Indexed access on `Record<K, V>` yields a result type that includes `undefined`
- All others (`Pick`, `Omit`, `Exclude`, `ReturnType`, `Awaited`, etc.) are **not supported**

#### Rules 34 / 90: Limited type inference — annotate explicitly
```ets
function identity<T>(value: T): T { return value }
const r = identity(42);              // ❌ generic inference limited (34)
const r: number = identity<number>(42);  // ✅

function add(a: number, b: number) { return a + b }  // ❌ missing return type (90)
function add(a: number, b: number): number { return a + b }  // ✅
```

#### Rules 4 / 103: Type names must be unique — across imports and across files (`arkts-unique-names`, `arkts-no-decl-merging`)

A local declaration must not reuse the name of anything imported by the same file. The high-frequency trap is a page struct named after the model type it displays:
```ets
// pages/FortuneResult.ets
import { FortuneResult } from '../model/BaziCalculator';  // ❌ arkts-unique-names +
@Entry @Component
struct FortuneResult { /* ... */ }                        //    "Import declaration conflicts with local declaration"
// — and every `fortune.score` access then cascades into false "Property 'score' does not exist on type 'FortuneResult'"

// ✅ alias the import (or name the page XxxPage)
import { FortuneResult as FortuneData } from '../model/BaziCalculator';
@Entry @Component
struct FortuneResult {
  @State fortune: FortuneData = new FortuneData();
}
```

The same name must not be declared in two files either — duplicating a shared interface per page fails:
```ets
// pages/Calculator.ets AND pages/Result.ets each declare:
interface ResultParams { taxAmount: string }   // ❌ arkts-no-decl-merging in BOTH files
// ✅ declare ONCE in model/ResultParams.ets, export it, import in both pages
```

### 2. Object literals and property access

#### Rule 38: Object literals need an explicit type context (`arkts-no-untyped-obj-literals`)
```ets
// ❌
const obj = { name: "John", age: 30 };
// ✅ correspond to a class/interface
interface Person { name: string; age: number }
const obj: Person = { name: "John", age: 30 };
// ✅ or correspond to a Record
const dict: Record<string, string> = { 'a': 'x', 'b': 'y' };
```

**Record literals require quoted keys** — an unquoted identifier key triggers this same rule even though the literal has a type context (verified checker behavior):
```ets
const p: Record<string, string> = { pagePath: v };    // ❌ arkts-no-untyped-obj-literals — key not a string literal
const p: Record<string, string> = { 'pagePath': v };  // ✅
```

**Class-typed literals must list every field** — initializers/defaults in the class body do NOT make fields optional in a literal:
```ets
class Capsule {
  id: string = '';
  tags: string[] = [];
  openedAt: number | undefined = undefined;
}
const c: Capsule = { id: '1' };  // ❌ Type '{ id: string; }' is missing the following properties from type 'Capsule': tags, openedAt
const c: Capsule = { id: '1', tags: [], openedAt: undefined };  // ✅ all fields listed, defaults repeated explicitly
```
For seed/mock data prefer a static factory so adding a field later means one change, not N literal fixes (see SKILL.md § Data model recipes).

#### Rule 40: Object literals cannot be type declarations (`arkts-no-obj-literals-as-types`)
```ets
type MyType = { name: string };                       // ❌
function f(p: { x: number; y: number }): void {}     // ❌ inline object type
// ✅
interface MyType { name: string }
function f(p: MyType): void {}
```

#### Rule 29: No indexed access on plain objects (`arkts-no-props-by-index`)
```ets
class Point { x: number = 0; y: number = 0 }
const p = new Point();
const v = p['x'];   // ❌ no indexed access on class instances
const v = p.x;      // ✅ dot access
// ✅ Exception: Record types allow indexed access
const rec: Record<string, number> = { 'x': 1 };
const n: number | undefined = rec['x'];
```

#### Rule 1: Property names must be identifiers or string literals (`arkts-identifiers-as-prop-names`)
```ets
const a = { 1: 'one' };      // ❌ numeric property name
const b = { name: 'ok' };    // ✅
const c: Record<string, string> = { 'key-with-dash': 'ok' };  // ✅ string literal
```

#### Rule 43: Array literal types must be inferrable (`arkts-no-noninferrable-arr-literals`)
```ets
const arr = [new A(), new B()];        // ❌ mixed types without context
const arr: Base[] = [new A(), new B()];  // ✅
```

#### Rules 52 / 136 / 139: No runtime mutation of object structure
```ets
obj.method = () => {};                    // ❌ method reassignment (52)
MyClass.prototype.newMethod = () => {};   // ❌ prototype assignment (136)
myFunction.customProp = 'value';          // ❌ properties on functions (139)
```

### 3. Functions

#### Rule 46: Replace function expressions with arrow functions (`arkts-no-func-expressions`)
```ets
const fn = function(x: number): number { return x * 2 };  // ❌
const fn = (x: number): number => { return x * 2 };       // ✅
```

#### Rule 92: No nested function declarations (`arkts-no-nested-funcs`)
```ets
// ❌
function outer(): void {
  function inner(): void {}   // nested function declaration
  inner();
}
// ✅ Option 1: arrow-function value inside the function
function outer(): void {
  const inner = (): void => {};
  inner();
}
// ✅ Option 2: promote to a top-level function or class method
function inner(): void {}
function outer(): void { inner() }
```

#### Rule 93: No `this` in standalone functions (`arkts-no-standalone-this`)

Applies to standalone functions AND `static` methods — a static method body is treated as standalone, so `this` referring to the class is flagged.

```ets
function fn(): void { console.log(this.value) }  // ❌ standalone function

class Store {
  static items: string[] = [];
  static add(x: string): void { this.items.push(x) }    // ❌ `this` in a static method — same error
  static addOk(x: string): void { Store.items.push(x) } // ✅ reference statics via the class name
}

// ✅ instance methods may use this
class MyClass {
  value: number = 10;
  fn(): void { console.log(this.value) }
}
```

A data-store class with `static` state + `static` helpers (a common pattern) must use the class name in every helper body — one `this.` written there and copy-pasted across helpers multiplies into one error per method.

#### Rule 49: Replace generic arrow functions with generic function declarations (`arkts-no-generic-lambdas`)
```ets
const identity = <T>(value: T): T => value;          // ❌
function identity<T>(value: T): T { return value }   // ✅
```

#### Rules 94 / 140 / 132: Other function restrictions
```ets
function* gen() { yield 1 }          // ❌ generators (94)
const bound = fn.bind(null, 'Hi');   // ❌ Function.bind (140)
new.target                           // ❌ (132)
```

### 4. Classes and interfaces

#### Rule 25: Declare fields in the class body (`arkts-no-ctor-prop-decls`)
```ets
// ❌ constructor parameter properties
class MyClass {
  constructor(public name: string, private age: number) {}
}
// ✅
class MyClass {
  public name: string;
  private age: number;
  constructor(name: string, age: number) {
    this.name = name;
    this.age = age;
  }
}
```

#### Rules 51 / 104: Direction restrictions on inheritance and implementation
```ets
class Base {}
class D1 implements Base {}        // ❌ implements only accepts interfaces (51)
interface I1 extends Base {}       // ❌ interfaces cannot extend classes (104)
class D2 extends Base {}           // ✅
interface IBase {}
class D3 implements IBase {}       // ✅
interface I2 extends IBase {}      // ✅
```

#### Rule 149: Classes cannot be used as objects (`arkts-no-classes-as-obj`)
```ets
class MyClass { static prop: number = 10 }
const obj = MyClass;          // ❌ passing a class as a value
MyClass.newProp = 20;         // ❌ attaching static properties at runtime
```

#### Rules 3 / 16 / 50: Other class restrictions
```ets
class A { #priv: number = 0 }            // ❌ # private fields; use private (3)
class B { static {} static {} }          // ❌ multiple static blocks (16)
const C = class { };                     // ❌ class expressions (50)
```

#### Rules 14 / 15 / 27 / 106: Call/constructor signature types — always rewrite to class
```ets
type Callable = { (x: number): string };          // ❌ (14)
type Ctor = { new (name: string): MyClass };      // ❌ (15)
interface I { new (name: string): I }             // ❌ (27)
type F = Function & { new (s: string): Object };  // ❌ (106)
```

#### Rules 102 / 103 / 113: Declaration-merging restrictions
```ets
interface A { p1: string }
interface A { p2: number }    // ❌ interface declaration merging (103)
enum E { A }
enum E { B = 1 }              // ❌ enum declaration merging (113)
```

#### Rule 111: Enum member initialization restrictions (`arkts-no-enum-mixed-types`)
```ets
enum Mixed { A = 1, B = "s" }      // ❌ mixed types
enum Num { A = 1, B = 2 }          // ✅ all number
enum Str { A = "one", B = "two" }  // ✅ all string
```

### 5. Expressions and statements

#### Rule 53: Assertions support only `as T` (`arkts-as-casts`)
```ets
const s = <string>value;    // ❌ angle-bracket assertion
const s = value as string;  // ✅ as is the only supported assertion syntax
```
Note: `as` itself is legal and idiomatic; do not avoid it out of TypeScript habit.

#### Rule 59: No `delete` (`arkts-no-delete`)
```ets
delete obj.property;        // ❌
// ✅ declare the field type as optional/including undefined, then set undefined
obj.property = undefined;
```

#### Rules 66 / 80: No `in` and `for...in`
```ets
if ('name' in obj) {}            // ❌ (66)
for (const k in obj) {}          // ❌ (80)
// ✅ alternatives
if (obj.name !== undefined) {}   // property presence
if (obj instanceof Person) {}    // type check
for (const item of array) {}     // array iteration
```

#### Rules 69 / 74 / 91: No destructuring of any form
```ets
const { a, b } = obj;                          // ❌ destructuring declaration (74)
[x, y] = [y, x];                               // ❌ destructuring assignment (69)
function greet({ name }: Person): void {}      // ❌ parameter destructuring (91)
// ✅ access each property explicitly
const a = obj.a;
const b = obj.b;
function greet(person: Person): void { console.log(person.name) }
```

#### Rule 87: `throw` only accepts Error (`arkts-limited-throw`)
```ets
throw "error message";           // ❌
throw 42;                        // ❌
throw new Error("message");      // ✅
```

#### Rule 79: `catch` cannot carry a type annotation (`arkts-no-types-in-catch`)
```ets
try {} catch (e: Error) {}   // ❌
try {} catch (e) {           // ✅ narrow with as inside
  const err = e as Error;
  console.log(err.message);
}
```

#### Rule 96: No `is` type guards (`arkts-no-is`)
```ets
function isCat(a: Animal): a is Cat { ... }     // ❌
// ✅ use instanceof + as
if (animal instanceof Cat) {
  const cat = animal as Cat;
}
```

#### Rule 99: Spread supports only arrays (`arkts-no-spread`)
```ets
const merged = { ...obj1, ...obj2 };   // ❌ object spread into object literals is restricted
fn(...someObj);                        // ❌
const arr = [...arr1, ...arr2];        // ✅ array spread
fn(...numArray);                       // ✅ spreading an array into rest parameters
```

#### Rules 55 / 60 / 65 / 71 / 84: Operator restrictions
```ets
const n = +"42";                  // ❌ unary +/-/~ only on numbers (55)
type T = typeof someVar;          // ❌ typeof not allowed in type context (60)
const t = typeof someVar;         // ✅ expression context is fine
v instanceof MyInterface          // ❌ instanceof not for interfaces/primitives (65)
v instanceof MyClass              // ✅
const x = (a, b, c);              // ❌ comma operator outside for loops (71)
with (obj) {}                     // ❌ (84)
```

#### Rule 37: Regex literals (`arkts-no-regexp-literals`)
```ets
const re = /test/g;                 // ❌
const re = new RegExp("test", "g"); // ✅
```

### 6. Standard library restrictions (Rule 144 `arkts-limited-stdlib`)

Banned global functions: `eval`

Banned `Object` static/prototype methods (all unavailable):
`__proto__`, `assign`, `create`, `defineProperty`, `defineProperties`, `freeze`, `seal`,
`fromEntries`, `getOwnPropertyDescriptor(s)`, `getOwnPropertySymbols`, `getPrototypeOf`, `setPrototypeOf`,
`hasOwnProperty`, `is`, `isExtensible`, `isFrozen`, `isPrototypeOf`, `isSealed`, `preventExtensions`, `propertyIsEnumerable`

`Reflect`/`Proxy` metaprogramming APIs are likewise banned. `Symbol` allows only `Symbol.iterator`.

Common replacements:
```ets
Object.assign(target, src)    // ❌ → assign fields explicitly, or use a constructor
Object.keys(obj)              // note: keys/values/entries are available, but prefer named types
obj.hasOwnProperty('k')       // ❌ → obj.k !== undefined
```

#### Rules 137 / 146: Global object and check suppression
```ets
globalThis.someValue = 10;    // ❌ (137) use an explicitly exported singleton / AppStorage
// @ts-ignore / @ts-nocheck   // ❌ (146) comment-based type-check suppression is banned
```

### 7. Module imports and exports

```ets
import { Something } from './m';       // ✅ standard named import
import myDefault from './m';           // ✅ default import
import * as ns from './m';             // ✅ namespace import

import type { T } from './m';          // ❌ (118)
import './module';                     // ❌ side-effect-only import (119)
import { default as x } from './m';    // ❌ (120)
import x = require('m');               // ❌ (121)
export = MyClass;                      // ❌ (126)
export type { T } from './m';          // ❌ (127)
declare module "lib" {}                // ❌ (128)

// imports must precede all other statements (150)
const x = 1;
import { A } from './m';               // ❌
```

### 8. Namespaces

```ets
namespace MyNS {
  export const value = 10;       // ✅ declarations only
  console.log(value);            // ❌ non-declaration statement (116)
}
const ns = MyNS;                 // ❌ namespace used as a value (114)
MyNS.doWork();                   // ✅ calling its exported members directly is allowed
```

### 9. Decorators and ArkUI (Rule 148 `arkts-no-decorators-except-arkui`)

Only ArkUI decorators are allowed:
`@AnimatableExtend` `@Builder` `@BuilderParam` `@Component` `@Concurrent` `@Consume` `@CustomDialog` `@Entry` `@Extend` `@Link` `@LocalStorageLink` `@LocalStorageProp` `@ObjectLink` `@Observed` `@Preview` `@Prop` `@Provide` `@Reusable` `@State` `@StorageLink` `@StorageProp` `@Styles` `@Watch` `@Require` `@Track` (plus concurrency decorators such as @Sendable)

```ets
@Component
struct MyComponent {
  @State count: number = 0;
  @Prop message: string = '';

  build() {
    Text(`${this.message}, count: ${this.count}`)  // ✅ template literals are legal
  }
}
```

Custom decorators (e.g. `@MyDecorator`) are not allowed.

### 10. Sendable concurrency restrictions

`@Sendable` classes are used to pass data across concurrent instances and carry extra restrictions:

| Rule Tag | Restriction |
|----------|-------------|
| `arkts-sendable-class-decorator` | Sendable classes must be annotated with `@Sendable` |
| `arkts-sendable-explicit-field-type` | Fields must have explicit type annotations |
| `arkts-sendable-prop-types` | Field types must themselves be sendable (primitives, Sendable classes, collections containers, etc.) |
| `arkts-sendable-obj-init` | Sendable types cannot be initialized directly from object/array literals |
| `arkts-sendable-definite-assignment` | Definite assignment assertions `!` are banned in Sendable classes |
| `arkts-sendable-imported-variables` | Capturing outer variables in Sendable classes/functions is restricted; only sendable top-level exports may be referenced |
| `arkts-sendable-class-inheritance` | Sendable classes can only extend Sendable classes; non-Sendable classes cannot extend Sendable classes |

```ets
@Sendable
class SharedData {
  count: number = 0;                       // ✅ explicit type + primitive
  items: collections.Array<string> = new collections.Array<string>();  // ✅
  // obj: Record<string, string> = {};     // ❌ non-sendable field type
}
```

### 11. ESObject (Rule 151 `arkts-limited-esobj`)

`ESObject` is only for boundary code interoperating with JS/TS; avoid it in pure ArkTS code.

---

## Project conventions (NOT official linter rules)

The following are coding conventions of this project, **not ArkTS language restrictions**. When citing them, state that they are project conventions:

> Quoted keys in Record literals were previously listed here as Convention 1 — they are in fact **checker-enforced** (unquoted keys fail with `arkts-no-untyped-obj-literals`) and have moved to Rule 38 above.

### Convention 2: Prefer `undefined` over `null`
`undefined` is more compatible with the ArkTS type system; when an external API may return `null`, convert with `?? undefined`:
```ets
const value: string | undefined = externalApi.getValue() ?? undefined;
```

### Convention 3: A `Map` cannot be assigned directly to a `Record`
```ets
const cardInfo: Record<string, Object> = new Map<string, string>();  // ❌ type mismatch
// ✅ convert by iterating
const cardInfo: Record<string, Object> = {};
ocrResult.forEach((value: string, key: string) => {
  cardInfo[key] = value as Object;
});
```

---

## Quick reference: most common errors

| Error / scenario | Solution |
|------------------|----------|
| `Object.assign is not supported` | Assign fields explicitly or use a constructor |
| `Destructuring is not supported` | Access each property explicitly |
| `Nested functions are not supported` | Use arrow-function values inside functions, or promote to class methods / top-level functions |
| `any/unknown is not supported` | Explicit types; when truly undetermined use `Object` or a union type |
| `Object literal must correspond to ...` | Declare an interface/class/Record type for the literal; if it already has a `Record` type, quote the keys |
| `... is missing the following properties from type` | Literal assigned to a class type must list every field — class-body defaults don't make fields optional (SKILL.md § Data model recipes) |
| `Import declaration conflicts with local declaration` | Struct/class named after an import — alias the import (`import { X as XData }`) or rename the struct (Rule 4) |
| `Declaration merging is not supported` | Same interface declared in two files — declare once in a shared model file and import (Rule 103) |
| `Indexed access is not supported` | Switch to dot access; for dynamic keys declare the type as `Record<K,V>` |
| `is not supported (delete)` | Add `\| undefined` to the field type and set `undefined` |
| `for..in is not supported` | Use `for..of` for arrays; for object iteration use `Record` + a known key list, or `Map` |
| `Structural typing is not supported` | Establish an explicit `extends`/`implements` relationship |
| `Use explicit types instead of ...` (generic calls) | Spell out the generic argument or the variable type |
