import test from 'node:test';
import assert from 'node:assert/strict';

import { createDomObserver } from '../dom-observer.js';
import { createTextNodeProcessor } from '../unicode-decoder.js';

class FakeNode {
    constructor(nodeType, ownerDocument = null) {
        this.nodeType = nodeType;
        this.ownerDocument = ownerDocument;
        this.parentElement = null;
        this.isConnected = true;
    }
}

class FakeText extends FakeNode {
    constructor(value, ownerDocument) {
        super(3, ownerDocument);
        this.nodeValue = value;
    }
}

class FakeElement extends FakeNode {
    constructor(tagName, ownerDocument) {
        super(1, ownerDocument);
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.id = '';
        this.className = '';
        this.innerHTML = '<not-written>';
    }

    append(...children) {
        for (const child of children) {
            child.parentElement = this;
            child.ownerDocument = this.ownerDocument;
            child.isConnected = this.isConnected;
            this.children.push(child);
        }
    }

    replaceChildren(...children) {
        const removed = [...this.children];
        removed.forEach((child) => {
            child.parentElement = null;
            child.isConnected = false;
        });
        this.children = [];
        this.append(...children);
        return removed;
    }

    removeChild(child) {
        this.children.splice(this.children.indexOf(child), 1);
        child.parentElement = null;
        child.isConnected = false;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'id') this.id = String(value);
        if (name === 'class') this.className = String(value);
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    matches(selector) {
        if (selector.includes(',')) {
            return selector.split(',').some((part) => this.matches(part.trim()));
        }
        if (selector === 'iframe') return this.tagName === 'IFRAME';
        if (selector === '.mes') return this.className.split(/\s+/).includes('mes');
        if (selector === '.mes_text') return this.className.split(/\s+/).includes('mes_text');
        if (selector === '.mes_edit') return this.className.split(/\s+/).includes('mes_edit');
        if (selector === '[contenteditable="true"]') return this.getAttribute('contenteditable') === 'true';
        return this.tagName === selector.toUpperCase();
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches(selector)) return current;
            current = current.parentElement;
        }
        return null;
    }

    querySelectorAll(selector) {
        const found = [];
        const visit = (element) => {
            for (const child of element.children) {
                if (child.nodeType !== 1) continue;
                if (child.matches(selector)) found.push(child);
                visit(child);
            }
        };
        visit(this);
        return found;
    }
}

class FakeFrame extends FakeElement {
    #contentDocument = null;
    #throwOnAccess = false;
    #listeners = new Map();

    constructor(ownerDocument) {
        super('iframe', ownerDocument);
    }

    get contentDocument() {
        if (this.#throwOnAccess) throw new DOMException('Blocked', 'SecurityError');
        return this.#contentDocument;
    }

    setDocument(document) {
        this.#throwOnAccess = false;
        this.#contentDocument = document;
    }

    makeInaccessible() {
        this.#throwOnAccess = true;
        this.#contentDocument = null;
    }

    addEventListener(name, callback) {
        const callbacks = this.#listeners.get(name) ?? new Set();
        callbacks.add(callback);
        this.#listeners.set(name, callbacks);
    }

    removeEventListener(name, callback) {
        this.#listeners.get(name)?.delete(callback);
    }

    dispatchLoad() {
        for (const callback of this.#listeners.get('load') ?? []) callback();
    }

    listenerCount(name) {
        return this.#listeners.get(name)?.size ?? 0;
    }
}

class FakeDocument extends FakeNode {
    constructor() {
        super(9);
        this.ownerDocument = this;
        this.documentElement = new FakeElement('html', this);
        this.body = new FakeElement('body', this);
        this.documentElement.append(this.body);
    }

    createElement(tagName) {
        return tagName === 'iframe' ? new FakeFrame(this) : new FakeElement(tagName, this);
    }

    createTextNode(value) {
        return new FakeText(value, this);
    }

    createTreeWalker(root) {
        const nodes = [];
        const visit = (node) => {
            if (node.nodeType === 3) {
                nodes.push(node);
                return;
            }
            node.children?.forEach(visit);
        };
        visit(root);
        let index = 0;
        return { nextNode: () => nodes[index++] ?? null };
    }

    querySelector(selector) {
        if (selector !== '#chat') return null;
        return this.querySelectorAll('#chat')[0] ?? null;
    }

    querySelectorAll(selector) {
        const all = [this.documentElement, ...descendants(this.documentElement)];
        if (selector === '#chat') return all.filter((node) => node.id === 'chat');
        if (selector === '#chat .mes_text') {
            const chat = all.find((node) => node.id === 'chat');
            return chat?.querySelectorAll('.mes_text') ?? [];
        }
        return this.documentElement.querySelectorAll(selector);
    }
}

function descendants(root) {
    const result = [];
    for (const child of root.children ?? []) {
        if (child.nodeType !== 1) continue;
        result.push(child, ...descendants(child));
    }
    return result;
}

class FakeMutationObserver {
    static instances = [];

    constructor(callback) {
        this.callback = callback;
        this.target = null;
        this.disconnected = false;
        FakeMutationObserver.instances.push(this);
    }

    observe(target) {
        this.target = target;
        this.disconnected = false;
    }

    disconnect() {
        this.disconnected = true;
    }

    emit(mutations) {
        if (!this.disconnected) this.callback(mutations);
    }
}

function makeAnimationFrameQueue() {
    let nextId = 1;
    const callbacks = new Map();
    return {
        request(callback) {
            const id = nextId++;
            callbacks.set(id, callback);
            return id;
        },
        cancel(id) {
            callbacks.delete(id);
        },
        flush() {
            while (callbacks.size) {
                const current = [...callbacks.values()];
                callbacks.clear();
                current.forEach((callback) => callback());
            }
        },
    };
}

function makePanelDocument() {
    const document = new FakeDocument();
    const rawData = document.createElement('textarea');
    rawData.id = 'raw-data';
    const rawText = document.createTextNode('<M>\u539F\u59CB</M>');
    rawData.append(rawText);

    const motive = document.createElement('div');
    motive.id = 'center-motive';
    const motiveText = document.createTextNode('\u60F3\u6CD5');
    motive.append(motiveText);

    const info = document.createElement('div');
    info.id = 'info-desc';
    const maliciousText = document.createTextNode('\u003Cimg src=x onerror=alert(1)\u003E');
    info.append(maliciousText);
    document.body.append(rawData, motive, info);
    return { document, rawText, motive, motiveText, info, maliciousText };
}

function makeHarness({ isUser = false, frameDocument = null } = {}) {
    FakeMutationObserver.instances = [];
    const document = new FakeDocument();
    const chat = document.createElement('div');
    chat.id = 'chat';
    const message = document.createElement('div');
    message.className = 'mes';
    message.setAttribute('is_user', String(isUser));
    message.setAttribute('is_system', 'false');
    const body = document.createElement('div');
    body.className = 'mes_text';
    const frame = document.createElement('iframe');
    if (frameDocument) frame.setDocument(frameDocument);
    body.append(frame);
    message.append(body);
    chat.append(message);
    document.body.append(chat);

    const settings = { enabled: true, scope: 'assistant' };
    const animationFrames = makeAnimationFrameQueue();
    const processor = createTextNodeProcessor(() => settings);
    const controller = createDomObserver({
        document,
        MutationObserver: FakeMutationObserver,
        requestAnimationFrame: animationFrames.request,
        cancelAnimationFrame: animationFrames.cancel,
        getSettings: () => settings,
        processor,
    });
    controller.observeChat();
    const chatObserver = FakeMutationObserver.instances.find((observer) => observer.target === chat);
    return { document, chat, message, body, frame, settings, animationFrames, controller, chatObserver };
}

function frameObserverFor(frameDocument) {
    return FakeMutationObserver.instances.find((observer) => observer.target === frameDocument.documentElement);
}

test('正则生成的同文档动态面板仍会在插入和点击更新后解码', () => {
    const harness = makeHarness();
    harness.body.removeChild(harness.frame);
    const panel = harness.document.createElement('section');
    const initialText = harness.document.createTextNode('\u521D\u59CB');
    panel.append(initialText);
    harness.body.append(panel);
    harness.chatObserver.emit([{
        type: 'childList',
        target: harness.body,
        addedNodes: [panel],
        removedNodes: [],
    }]);
    harness.animationFrames.flush();
    assert.equal(initialText.nodeValue, '初始');

    const clickedText = harness.document.createTextNode('\u70B9\u51FB');
    const oldValue = initialText.nodeValue;
    initialText.nodeValue = clickedText.nodeValue;
    harness.chatObserver.emit([{
        type: 'characterData',
        target: initialText,
        oldValue,
    }]);
    assert.equal(initialText.nodeValue, '点击');
});

test('同源 iframe 初始内容与后续点击替换都会解码，原始 textarea 和 HTML 结构不变', () => {
    const panel = makePanelDocument();
    const harness = makeHarness({ frameDocument: panel.document });
    harness.controller.scheduleChat();
    harness.animationFrames.flush();

    assert.equal(panel.motiveText.nodeValue, '想法');
    assert.equal(panel.rawText.nodeValue, '<M>\u539F\u59CB</M>');
    assert.equal(panel.maliciousText.nodeValue, '<img src=x onerror=alert(1)>');
    assert.equal(panel.info.innerHTML, '<not-written>');

    const clickedText = panel.document.createTextNode('\u65B0\u503C');
    const removed = panel.motive.replaceChildren(clickedText);
    frameObserverFor(panel.document).emit([{
        type: 'childList',
        target: panel.motive,
        addedNodes: [clickedText],
        removedNodes: removed,
    }]);
    harness.animationFrames.flush();
    assert.equal(clickedText.nodeValue, '新值');
});

test('延迟 load 后接入 iframe，重复扫描不创建重复 observer', () => {
    const harness = makeHarness();
    harness.controller.scheduleChat();
    harness.animationFrames.flush();
    assert.equal(harness.frame.listenerCount('load'), 1);

    const panel = makePanelDocument();
    harness.frame.setDocument(panel.document);
    harness.frame.dispatchLoad();
    harness.animationFrames.flush();
    assert.equal(panel.motiveText.nodeValue, '想法');

    harness.controller.scheduleChat();
    harness.controller.scheduleChat();
    harness.animationFrames.flush();
    const observers = FakeMutationObserver.instances.filter((observer) => observer.target === panel.document.documentElement);
    assert.equal(observers.length, 1);
});

test('关闭和范围变更会恢复原文并按宿主消息范围重新扫描 iframe', () => {
    const panel = makePanelDocument();
    const harness = makeHarness({ frameDocument: panel.document });
    harness.controller.scheduleChat();
    harness.animationFrames.flush();
    assert.equal(panel.motiveText.nodeValue, '想法');

    harness.settings.enabled = false;
    harness.controller.applySettings();
    harness.animationFrames.flush();
    assert.equal(panel.motiveText.nodeValue, '\u60F3\u6CD5');

    harness.settings.enabled = true;
    harness.message.setAttribute('is_user', 'true');
    harness.controller.applySettings();
    harness.animationFrames.flush();
    assert.equal(panel.motiveText.nodeValue, '\u60F3\u6CD5');

    harness.settings.scope = 'all';
    harness.controller.applySettings();
    harness.animationFrames.flush();
    assert.equal(panel.motiveText.nodeValue, '想法');
});

test('iframe 移除时断开 observer、移除 load 监听并恢复仍可访问的原文', () => {
    const panel = makePanelDocument();
    const harness = makeHarness({ frameDocument: panel.document });
    harness.controller.scheduleChat();
    harness.animationFrames.flush();
    const frameObserver = frameObserverFor(panel.document);
    assert.equal(panel.motiveText.nodeValue, '想法');

    // A load callback may already have queued another scan when removal occurs.
    harness.frame.dispatchLoad();
    harness.body.removeChild(harness.frame);
    harness.chatObserver.emit([{
        type: 'childList',
        target: harness.body,
        addedNodes: [],
        removedNodes: [harness.frame],
    }]);

    assert.equal(frameObserver.disconnected, true);
    assert.equal(harness.frame.listenerCount('load'), 0);
    assert.equal(panel.motiveText.nodeValue, '\u60F3\u6CD5');
    harness.animationFrames.flush();
    assert.equal(panel.motiveText.nodeValue, '\u60F3\u6CD5');
});

test('不可访问的 sandbox/cross-origin iframe 被安全跳过', () => {
    const harness = makeHarness();
    harness.frame.makeInaccessible();
    assert.doesNotThrow(() => {
        harness.controller.scheduleChat();
        harness.animationFrames.flush();
        harness.frame.dispatchLoad();
    });
    assert.equal(FakeMutationObserver.instances.filter((observer) => observer !== harness.chatObserver).length, 0);
});
