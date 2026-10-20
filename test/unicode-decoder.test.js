import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createTextNodeProcessor,
    decodeUnicodeEscapes,
    shouldProcessTextNode,
} from '../unicode-decoder.js';

function fakeNode(value, { inCode = false, isUser = false, isSystem = false } = {}) {
    const message = {
        getAttribute(name) {
            if (name === 'is_user') return String(isUser);
            if (name === 'is_system') return String(isSystem);
            return null;
        },
    };
    const body = {
        closest(selector) {
            return selector === '.mes' ? message : null;
        },
    };
    const parentElement = {
        closest(selector) {
            if (selector === '.mes_text') return body;
            if (selector === '.mes') return message;
            return inCode ? {} : null;
        },
    };

    return { nodeValue: value, parentElement, innerHTML: '<unchanged>' };
}

test('普通中文与普通文本保持不变', () => {
    assert.equal(decodeUnicodeEscapes('你好，SillyTavern！'), '你好，SillyTavern！');
});

test('还原 BMP Unicode 转义与大括号码点', () => {
    assert.equal(decodeUnicodeEscapes('\\u4F60\\u597D \\u{4E16}\\u{754C}'), '你好 世界');
});

test('还原代理对和大括号 emoji', () => {
    assert.equal(decodeUnicodeEscapes('\\uD83D\\uDE00 \\u{1F680}'), '😀 🚀');
});

test('非法转义和孤立代理保持原样', () => {
    const input = '\\uZZZZ \\uD83D! \\uDE00 \\u{110000} \\u{D800} \\u{}';
    assert.equal(decodeUnicodeEscapes(input), input);
});

test('偶数反斜杠保持展示语法，奇数只解码最后一层', () => {
    assert.equal(decodeUnicodeEscapes('\\\\u4F60'), '\\\\u4F60');
    assert.equal(decodeUnicodeEscapes('\\\\\\u4F60'), '\\\\你');
});

test('HTML 注入内容只成为文本节点内容', () => {
    const node = fakeNode('\\u003Cimg src=x onerror=alert(1)\\u003E');
    const processor = createTextNodeProcessor(() => ({ enabled: true, scope: 'assistant' }));

    processor.process(node);

    assert.equal(node.nodeValue, '<img src=x onerror=alert(1)>');
    assert.equal(node.innerHTML, '<unchanged>');
});

test('代码区域与默认用户消息范围不处理', () => {
    assert.equal(shouldProcessTextNode(fakeNode('\\u4F60', { inCode: true })), false);
    assert.equal(shouldProcessTextNode(fakeNode('\\u4F60', { isUser: true })), false);
    assert.equal(shouldProcessTextNode(fakeNode('\\u4F60', { isSystem: true })), false);
    assert.equal(shouldProcessTextNode(fakeNode('\\u4F60', { isUser: true }), 'all'), true);
});

test('重复处理不会发生级联解码', () => {
    const node = fakeNode('\\u005Cu4F60');
    const processor = createTextNodeProcessor(() => ({ enabled: true, scope: 'assistant' }));

    assert.equal(processor.process(node), true);
    assert.equal(node.nodeValue, '\\u4F60');
    assert.equal(processor.process(node), false);
    assert.equal(node.nodeValue, '\\u4F60');
});

test('同一文本节点的动态更新可重新处理，并可恢复原文', () => {
    const node = fakeNode('开始：\\u4F60');
    const processor = createTextNodeProcessor(() => ({ enabled: true, scope: 'assistant' }));

    processor.process(node);
    assert.equal(node.nodeValue, '开始：你');

    node.nodeValue = '增量：\\u597D';
    processor.process(node);
    assert.equal(node.nodeValue, '增量：好');

    assert.equal(processor.restore(node), true);
    assert.equal(node.nodeValue, '增量：\\u597D');
});

test('流式追加沿用原始层，不会把已显示结果再次解码', () => {
    const node = fakeNode('\\u005C');
    const processor = createTextNodeProcessor(() => ({ enabled: true, scope: 'assistant' }));

    processor.process(node);
    assert.equal(node.nodeValue, '\\');

    const oldValue = node.nodeValue;
    node.nodeValue += 'u4F60';
    processor.process(node, oldValue);
    assert.equal(node.nodeValue, '\\u4F60');
    assert.equal(processor.process(node), false);

    processor.restore(node);
    assert.equal(node.nodeValue, '\\u005Cu4F60');
});
