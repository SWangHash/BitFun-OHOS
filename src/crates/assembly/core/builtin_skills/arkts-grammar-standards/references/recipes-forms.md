# Recipes: TextInput/forms, DatePicker, dialogs and toasts

Verified shapes — copy them, do not improvise. Read this file BEFORE writing the first file with form input, a picker, or a dialog/toast.

## TextInput, Button, and state refresh

```ets
@Component
struct RegisterForm {
  @State userName: string = ''
  @State errorText: string = ''

  build() {
    Column({ space: 12 }) {
      TextInput({ placeholder: '请输入用户名', text: this.userName })
        .onChange((value: string) => {
          this.userName = value
        })

      Button('注册')
        .onClick(() => {
          this.errorText = this.userName.length === 0 ? '请填写完整信息' : '注册成功'
        })

      Text(this.errorText)
        .fontColor(this.errorText === '注册成功' ? Color.Green : Color.Red)
    }
  }
}
```

- Sync input back to state in `.onChange(...)`. Do NOT use `$$this.x` two-way binding in generated code — the standalone type check does not understand the `$$` sugar and reports `Cannot find name '$$this'` (observed ×4 in one page); `.onChange` sync is equivalent and always passes.
- Event callback parameter types must be explicit (`(value: string)`) — inference inside modifiers is limited.
- Required validation messages must be rendered on the page, not only logged.
- For a styled button label, place a styled `Text` inside `Button() { Text('...') ... }` — but NEVER combine a label argument with children (`Button('x') { ... }` fails the build with 10905202; see arkui-structure-rules § 7).

## DatePicker and pickers

Two callback generations — do not mix their value types:

```ets
DatePicker({
  start: new Date('1970-1-1'),
  end: new Date('2100-12-31'),
  selected: this.selectedDate
})
  .onDateChange((value: Date) => {        // value is a real Date
    this.birthYear = value.getFullYear()
    this.birthMonth = value.getMonth() + 1  // getMonth() is 0-based
    this.birthDay = value.getDate()
  })
```

- `.onDateChange((value: Date) => {})` — use this; the value is `Date`, call `getFullYear()/getMonth()/getDate()` on it.
- The legacy `.onChange((value: DatePickerResult) => {})` callback delivers OPTIONAL fields (`value.year?: number`) — every access needs `?? 0` narrowing. Prefer `onDateChange`.
- `TextPicker({ range: this.options, selected: this.index })` + `.onChange((value: string | string[], index: number | number[]) => {})`.

## Dialog and Toast

Button label field is `value` — there is no `text` field on dialog buttons.

```ets
this.getUIContext().showAlertDialog({
  title: '确认进入订座？',
  message: '确认进入订座？',
  primaryButton: {
    value: '去订座',
    action: () => {
      this.getUIContext().getPromptAction().showToast({ message: '已打开订座' })
    }
  },
  secondaryButton: {
    value: '再想想',
    action: () => {}
  }
})
```

- `ActionSheet` entries go in `sheets: [{ title: '...', action: () => {} }]`.
- `promptAction.showActionMenu({ title?, buttons: [{ text: '...', color: '#000000' }] })` — the field is `buttons` (1–6 entries), NOT `items`; each `Button` requires BOTH `text` and `color`. The `.then` result type lives in the `promptAction` namespace — the bare name is not in scope: `import { promptAction } from '@kit.ArkUI'`, then `.then((r: promptAction.ActionMenuSuccessResponse) => { r.index ... })` (NOT `ActionMenuSuccessResult`, NOT unqualified `ActionMenuSuccessResponse`).
- Keep cancel actions side-effect free unless the requirement says otherwise.
- **`ToastOptions` is NOT an exported type** — do not annotate: `const opts: ToastOptions = ...` fails with `Cannot find name 'ToastOptions'`. Just pass the literal inline: `promptAction.showToast({ message: '...' })`.
- Prefer UIContext-based APIs when the project uses them: `this.getUIContext().getPromptAction()`, `.showAlertDialog(...)`, `.getRouter()`, `.animateTo(...)`. If the project has its own dialog/toast/router wrapper, use the wrapper instead of introducing a new pattern.
