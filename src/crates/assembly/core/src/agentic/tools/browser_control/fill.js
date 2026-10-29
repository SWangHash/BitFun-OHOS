(function (el, value, verify) {
    const win = el.ownerDocument.defaultView;
    const tag = el.tagName.toLowerCase();
    const input = tag === 'input';
    const textarea = tag === 'textarea';
    const editable = el.isContentEditable;
    if (!el.isConnected || el.disabled || el.readOnly || el.matches(':disabled')) {
        throw new Error('Fill target is detached, disabled, or read-only');
    }
    if ((!input && !textarea && !editable)
        || (input && ['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image'].includes(el.type))) {
        throw new Error('Fill target is not an editable text field');
    }
    if (verify) {
        // Return evidence without exposing field contents (including passwords).
        if ((editable ? el.textContent : el.value) !== value) {
            throw new Error('Fill verification failed: the field did not retain the requested value');
        }
        return { verified: true };
    }

    el.focus();
    let focused = el.ownerDocument.activeElement;
    while (focused && focused.shadowRoot && focused.shadowRoot.activeElement) {
        focused = focused.shadowRoot.activeElement;
    }
    if (focused !== el && !el.contains(focused)) {
        throw new Error('Fill target could not receive focus');
    }
    if (editable) {
        el.textContent = '';
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        const selection = win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    } else {
        // Native setters keep controlled React/Vue inputs in sync with events.
        const prototype = input ? win.HTMLInputElement.prototype : win.HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
        // Date/time controls do not accept Input.insertText on every engine.
        const direct = input && ['date', 'datetime-local', 'month', 'time', 'week', 'color', 'range'].includes(el.type);
        setter.call(el, direct ? value : '');
        el.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
        if (direct) {
            el.dispatchEvent(new win.Event('change', { bubbles: true }));
            return { insert_text: false };
        }
    }
    return { insert_text: true };
})
