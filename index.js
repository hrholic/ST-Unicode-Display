import {
    createTextNodeProcessor,
    shouldProcessTextNode,
} from './unicode-decoder.js';

const MODULE_NAME = 'unicode_display_decoder';
const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    scope: 'assistant',
});

let observer;
let started = false;
let frameId = 0;
const pendingRoots = new Set();

const context = SillyTavern.getContext();
const processor = createTextNodeProcessor(getSettings);

function getSettings() {
    const { extensionSettings } = context;
    extensionSettings[MODULE_NAME] ??= structuredClone(DEFAULT_SETTINGS);

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = value;
        }
    }

    return extensionSettings[MODULE_NAME];
}

function walkText(root, callback) {
    if (!root) {
        return;
    }

    if (root.nodeType === Node.TEXT_NODE) {
        callback(root);
        return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        callback(node);
    }
}

function processRoot(root) {
    walkText(root, (node) => {
        if (shouldProcessTextNode(node, getSettings().scope)) {
            processor.process(node);
        }
    });
}

function restoreRoot(root) {
    walkText(root, processor.restore);
}

function flushPendingRoots() {
    frameId = 0;
    const roots = [...pendingRoots];
    pendingRoots.clear();

    for (const root of roots) {
        if (root?.isConnected) {
            processRoot(root);
        }
    }
}

function scheduleRoot(root) {
    if (!root) {
        return;
    }

    pendingRoots.add(root);
    if (!frameId) {
        frameId = requestAnimationFrame(flushPendingRoots);
    }
}

function scheduleChat() {
    document.querySelectorAll('#chat .mes_text').forEach(scheduleRoot);
}

function bodyForNode(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.matches?.('.mes_text') ? element : element?.closest?.('.mes_text');
}

function onMutations(mutations) {
    if (!getSettings().enabled) {
        return;
    }

    for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
            if (bodyForNode(mutation.target)) {
                processor.process(mutation.target, mutation.oldValue);
            }
            continue;
        }

        for (const added of mutation.addedNodes) {
            const body = bodyForNode(added);
            if (body) {
                scheduleRoot(added.nodeType === Node.TEXT_NODE ? added : added);
                continue;
            }

            if (added.nodeType === Node.ELEMENT_NODE) {
                added.querySelectorAll?.('.mes_text').forEach(scheduleRoot);
            }
        }
    }
}

function observeChat() {
    const chat = document.querySelector('#chat');
    if (!chat) {
        return;
    }

    observer?.disconnect();
    observer = new MutationObserver(onMutations);
    observer.observe(chat, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
    });
}

function restoreChat() {
    document.querySelectorAll('#chat .mes_text').forEach(restoreRoot);
}

function applySettings() {
    restoreChat();
    if (getSettings().enabled) {
        scheduleChat();
    }
}

function makeSettingsPanel() {
    if (document.querySelector('#unicode_display_decoder_settings')) {
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'unicode_display_decoder_settings';
    panel.className = 'extension_container unicode-display-settings';

    const title = document.createElement('h4');
    title.textContent = 'Unicode 转义显示还原';
    panel.append(title);

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'checkbox_label';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.id = 'unicode_display_decoder_enabled';
    enabled.checked = getSettings().enabled;
    const enabledText = document.createElement('span');
    enabledText.textContent = '仅在页面显示时还原 Unicode 转义';
    enabledLabel.append(enabled, enabledText);
    panel.append(enabledLabel);

    const scopeLabel = document.createElement('label');
    scopeLabel.htmlFor = 'unicode_display_decoder_scope';
    scopeLabel.textContent = '适用范围';
    const scope = document.createElement('select');
    scope.id = 'unicode_display_decoder_scope';
    scope.className = 'text_pole';
    scope.add(new Option('仅 AI 回复（推荐）', 'assistant'));
    scope.add(new Option('全部聊天消息', 'all'));
    scope.value = getSettings().scope;
    panel.append(scopeLabel, scope);

    const hint = document.createElement('small');
    hint.className = 'unicode-display-hint';
    hint.textContent = '不会修改聊天记录；代码块、编辑框和双反斜杠转义示例保持原样。';
    panel.append(hint);

    enabled.addEventListener('change', () => {
        getSettings().enabled = enabled.checked;
        context.saveSettingsDebounced();
        applySettings();
    });

    scope.addEventListener('change', () => {
        getSettings().scope = scope.value;
        context.saveSettingsDebounced();
        applySettings();
    });

    document.querySelector('#extensions_settings2, #extensions_settings')?.append(panel);
}

function subscribe(eventName, handler) {
    const event = context.event_types[eventName];
    if (event) {
        context.eventSource.on(event, handler);
    }
}

function start() {
    if (started) {
        return;
    }

    started = true;
    getSettings();
    makeSettingsPanel();
    observeChat();
    scheduleChat();

    for (const eventName of [
        'CHARACTER_MESSAGE_RENDERED',
        'USER_MESSAGE_RENDERED',
        'MESSAGE_EDITED',
        'MESSAGE_UPDATED',
        'MESSAGE_SWIPED',
        'MORE_MESSAGES_LOADED',
        'GENERATION_ENDED',
        'CHAT_CHANGED',
        'CHAT_LOADED',
    ]) {
        subscribe(eventName, scheduleChat);
    }
}

subscribe('APP_READY', start);
