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

test('��ͨ��������ͨ�ı����ֲ���', () => {
    assert.equal(decodeUnicodeEscapes('��ã�SillyTavern��'), '��ã�SillyTavern��');
});

test('��ԭ BMP Unicode ת������������', () => {
    assert.equal(decodeUnicodeEscapes('\\u4F60\\u597D \\u{4E16}\\u{754C}'), '��� ����');
});

test('��ԭ�����Ժʹ����� emoji', () => {
    assert.equal(decodeUnicodeEscapes('\\uD83D\\uDE00 \\u{1F680}'), '?? ??');
});

test('�Ƿ�ת��͹�����������ԭ��', () => {
    const input = '\\uZZZZ \\uD83D! \\uDE00 \\u{110000} \\u{D800} \\u{}';
    assert.equal(decodeUnicodeEscapes(input), input);
});

test('ż����б�ܱ���չʾ�﷨������ֻ�������һ��', () => {
    assert.equal(decodeUnicodeEscapes('\\\\u4F60'), '\\\\u4F60');
    assert.equal(decodeUnicodeEscapes('\\\\\\u4F60'), '\\\\��');
});

test('HTML ע������ֻ��Ϊ�ı��ڵ�����', () => {
    const node = fakeNode('\\u003Cimg src=x onerror=alert(1)\\u003E');
    const processor = createTextNodeProcessor(() => ({ enabled: true, scope: 'assistant' }));

    processor.process(node);

    assert.equal(node.nodeValue, '<img src=x onerror=alert(1)>');
    assert.equal(node.innerHTML, '<unchanged>');
});

test('����������Ĭ���û���Ϣ��Χ������', () => {
    assert.equal(shouldProcessTextNode(fakeNode('\\u4F60', { inCode: true })), false);
    assert.equal(shouldProcessTextNode(fakeNode('\\u4F60', { isUser: true })), false);
    assert.equal(shouldProcessTextNode(fakeNode('\\u4F60', { isSystem: true })), false);
    assert.equal(shouldProcessTextNode(fakeNode('\\u4F60', { isUser: true }), 'all'), true);
});

test('�ظ��������ᷢ����������', () => {
    const node = fakeNode('\\u005Cu4F60');
    const processor = createTextNodeProcessor(() => ({ enabled: true, scope: 'assistant' }));

    assert.equal(processor.process(node), true);
    assert.equal(node.nodeValue, '\\u4F60');
    assert.equal(processor.process(node), false);
    assert.equal(node.nodeValue, '\\u4F60');
});

test('ͬһ�ı��ڵ�Ķ�̬���¿����´��������ɻָ�ԭ��', () => {
    const node = fakeNode('��ʼ��\\u4F60');
    const processor = createTextNodeProcessor(() => ({ enabled: true, scope: 'assistant' }));

    processor.process(node);
    assert.equal(node.nodeValue, '��ʼ����');

    node.nodeValue = '������\\u597D';
    processor.process(node);
    assert.equal(node.nodeValue, '��������');

    assert.equal(processor.restore(node), true);
    assert.equal(node.nodeValue, '������\\u597D');
});

test('��ʽ׷������ԭʼ�㣬���������ʾ����ٴν���', () => {
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

