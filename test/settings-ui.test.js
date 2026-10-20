import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    createSettingsContent,
    createSettingsPopupOpener,
    MENU_ITEM_ID,
    mountSettingsMenu,
} from '../settings-ui.js';

class FakeClassList {
    values = new Set();

    add(...names) {
        names.forEach((name) => this.values.add(name));
    }

    contains(name) {
        return this.values.has(name);
    }
}

class FakeElement extends EventTarget {
    children = [];
    classList = new FakeClassList();
    attributes = new Map();
    id = '';
    className = '';
    textContent = '';
    value = '';
    checked = false;
    tabIndex = -1;

    constructor(tagName) {
        super();
        this.tagName = tagName.toUpperCase();
    }

    append(...children) {
        this.children.push(...children);
    }

    setAttribute(name, value) {
        this.attributes.set(name, value);
    }
}

class FakeDocument {
    body = new FakeElement('body');

    createElement(tagName) {
        return new FakeElement(tagName);
    }

    getElementById(id) {
        const find = (element) => element.id === id
            ? element
            : element.children.map(find).find(Boolean) ?? null;
        return find(this.body);
    }
}

function findByTag(root, tagName) {
    if (root.tagName === tagName.toUpperCase()) return root;
    for (const child of root.children) {
        const found = findByTag(child, tagName);
        if (found) return found;
    }
    return null;
}

function keyEvent(key) {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: key });
    return event;
}

test('菜单挂到输入区原生扩展菜单，重复初始化不重复添加', () => {
    const document = new FakeDocument();
    const menu = document.createElement('div');
    menu.id = 'extensionsMenu';
    document.body.append(menu);
    let opens = 0;

    const first = mountSettingsMenu(document, () => opens++);
    const second = mountSettingsMenu(document, () => opens++);

    assert.equal(first, second);
    assert.equal(menu.children.length, 1);
    assert.equal(first.id, MENU_ITEM_ID);
    assert.equal(first.attributes.get('role'), 'button');
    assert.equal(first.attributes.get('aria-haspopup'), 'dialog');
    assert.equal(first.tabIndex, 0);
    first.dispatchEvent(new Event('click'));
    assert.equal(opens, 1);
});

test('菜单支持键盘操作，空格和回车均可打开', () => {
    const document = new FakeDocument();
    const menu = document.createElement('div');
    menu.id = 'extensionsMenu';
    document.body.append(menu);
    let opens = 0;
    const item = mountSettingsMenu(document, () => opens++);

    item.dispatchEvent(keyEvent('Escape'));
    item.dispatchEvent(keyEvent('Enter'));
    item.dispatchEvent(keyEvent(' '));
    assert.equal(opens, 2);
});

test('弹窗恢复已保存设置并把变更交给保存处理器', () => {
    const document = new FakeDocument();
    const settings = { enabled: false, scope: 'all' };
    let saves = 0;
    let applies = 0;
    const content = createSettingsContent(document, settings, (patch) => {
        Object.assign(settings, patch);
        saves++;
        applies++;
    });
    const enabled = findByTag(content, 'input');
    const scope = findByTag(content, 'select');

    assert.equal(enabled.checked, false);
    assert.equal(scope.value, 'all');
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    scope.value = 'assistant';
    scope.dispatchEvent(new Event('change'));

    assert.deepEqual(settings, { enabled: true, scope: 'assistant' });
    assert.equal(saves, 2);
    assert.equal(applies, 2);
});

test('弹窗打开期间不会重复创建，关闭后可以再次打开', async () => {
    const document = new FakeDocument();
    const resolvers = [];
    let shows = 0;
    class FakePopup {
        show() {
            shows++;
            return new Promise((resolve) => resolvers.push(resolve));
        }
    }
    const open = createSettingsPopupOpener({
        document,
        Popup: FakePopup,
        POPUP_TYPE: { TEXT: 'text' },
        getSettings: () => ({ enabled: true, scope: 'assistant' }),
        onChange: () => {},
    });

    const first = open();
    const duplicate = open();
    assert.equal(shows, 1);
    resolvers.shift()();
    await Promise.all([first, duplicate]);
    const reopened = open();
    assert.equal(shows, 2);
    resolvers.shift()();
    await reopened;
});

test('移动端入口具备 44px 触控目标和响应式弹窗宽度', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /100vw/);
    assert.match(css, /touch-action:\s*manipulation/);
});

test('主脚本不再向旧扩展设置页挂载面板', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(index, /extensions_settings|makeSettingsPanel/);
    assert.match(index, /unicode_display_decoder/);
});
