import {
    createTextNodeProcessor,
    shouldProcessTextNode,
} from './unicode-decoder.js';
import {
    createSettingsPopupOpener,
    mountSettingsMenu,
} from './settings-ui.js';

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

function updateSettings(patch) {
    Object.assign(getSettings(), patch);
    context.saveSettingsDebounced();
    applySettings();
}

const openSettingsPopup = createSettingsPopupOpener({
    document,
    Popup: context.Popup,
    POPUP_TYPE: context.POPUP_TYPE,
    getSettings,
    onChange: updateSettings,
});

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
    mountSettingsMenu(document, openSettingsPopup);
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
