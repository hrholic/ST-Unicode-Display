const HEX_4 = /^[0-9a-fA-F]{4}$/;
const HEX_BRACED = /^[0-9a-fA-F]{1,6}$/;

function isScalarValue(value) {
    return value <= 0x10FFFF && !(value >= 0xD800 && value <= 0xDFFF);
}

function readEscape(text, uIndex) {
    if (text[uIndex] !== 'u') {
        return null;
    }

    if (text[uIndex + 1] === '{') {
        const close = text.indexOf('}', uIndex + 2);
        if (close === -1) {
            return null;
        }

        const digits = text.slice(uIndex + 2, close);
        if (!HEX_BRACED.test(digits)) {
            return null;
        }

        const value = Number.parseInt(digits, 16);
        return isScalarValue(value)
            ? { value: String.fromCodePoint(value), nextIndex: close + 1 }
            : null;
    }

    const digits = text.slice(uIndex + 1, uIndex + 5);
    if (!HEX_4.test(digits)) {
        return null;
    }

    const first = Number.parseInt(digits, 16);
    const nextIndex = uIndex + 5;
    if (first >= 0xDC00 && first <= 0xDFFF) {
        return null;
    }

    if (first < 0xD800 || first > 0xDBFF) {
        return { value: String.fromCharCode(first), nextIndex };
    }

    if (text[nextIndex] !== '\\' || text[nextIndex + 1] !== 'u') {
        return null;
    }

    const lowDigits = text.slice(nextIndex + 2, nextIndex + 6);
    if (!HEX_4.test(lowDigits)) {
        return null;
    }

    const second = Number.parseInt(lowDigits, 16);
    if (second < 0xDC00 || second > 0xDFFF) {
        return null;
    }

    const codePoint = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00);
    return { value: String.fromCodePoint(codePoint), nextIndex: nextIndex + 6 };
}

/**
 * Decodes one display layer of unescaped Unicode escape sequences.
 * Even backslash runs are left alone so examples such as `\\\\u4F60` stay literal.
 */
export function decodeUnicodeEscapes(text) {
    if (typeof text !== 'string' || !text.includes('\\u')) {
        return text;
    }

    let result = '';
    let index = 0;

    while (index < text.length) {
        if (text[index] !== '\\') {
            result += text[index++];
            continue;
        }

        const slashStart = index;
        while (text[index] === '\\') {
            index++;
        }

        const slashCount = index - slashStart;
        if (slashCount % 2 === 0 || text[index] !== 'u') {
            result += '\\'.repeat(slashCount);
            continue;
        }

        const escape = readEscape(text, index);
        if (!escape) {
            result += '\\'.repeat(slashCount);
            continue;
        }

        result += '\\'.repeat(slashCount - 1) + escape.value;
        index = escape.nextIndex;
    }

    return result;
}

export const SKIP_SELECTOR = [
    'pre',
    'code',
    'kbd',
    'samp',
    'script',
    'style',
    'textarea',
    'input',
    '[contenteditable="true"]',
    '.mes_edit',
].join(',');

export function shouldProcessTextNode(node, scope = 'assistant') {
    const parent = node?.parentElement;
    const body = parent?.closest?.('.mes_text');
    const message = body?.closest?.('.mes');

    if (!body || !message || parent.closest(SKIP_SELECTOR)) {
        return false;
    }

    return scope === 'all' || (
        message.getAttribute('is_user') !== 'true'
        && message.getAttribute('is_system') !== 'true'
    );
}

/** Keeps original text only in memory; it never writes chat data or HTML. */
export function createTextNodeProcessor(getSettings) {
    const states = new WeakMap();

    function process(node, observedOldValue) {
        const settings = getSettings();
        if (!settings.enabled || !shouldProcessTextNode(node, settings.scope)) {
            return false;
        }

        const current = node.nodeValue;
        const previous = states.get(node);
        if (previous && current === previous.rendered) {
            return false;
        }

        const raw = previous
            && observedOldValue === previous.rendered
            && current.startsWith(observedOldValue)
            ? previous.raw + current.slice(observedOldValue.length)
            : current;
        const rendered = decodeUnicodeEscapes(raw);
        states.set(node, { raw, rendered });
        if (rendered === current) {
            return false;
        }

        node.nodeValue = rendered;
        return true;
    }

    function restore(node) {
        const previous = states.get(node);
        states.delete(node);
        if (!previous || node.nodeValue !== previous.rendered || previous.raw === previous.rendered) {
            return false;
        }

        node.nodeValue = previous.raw;
        return true;
    }

    return { process, restore };
}

