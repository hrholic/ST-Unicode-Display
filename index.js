import {
    createTextNodeProcessor,
} from './unicode-decoder.js';
import { createDomObserver } from './dom-observer.js';
import {
    createSettingsPopupOpener,
    mountSettingsMenu,
} from './settings-ui.js';

const MODULE_NAME = 'unicode_display_decoder';
const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    scope: 'assistant',
});

let started = false;

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

const domObserver = createDomObserver({
    document,
    MutationObserver,
    requestAnimationFrame,
    cancelAnimationFrame,
    getSettings,
    processor,
});

function updateSettings(patch) {
    Object.assign(getSettings(), patch);
    context.saveSettingsDebounced();
    domObserver.applySettings();
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
    domObserver.observeChat();
    domObserver.scheduleChat();

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
        subscribe(eventName, domObserver.scheduleChat);
    }
}

subscribe('APP_READY', start);
