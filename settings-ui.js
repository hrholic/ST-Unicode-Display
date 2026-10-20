export const MENU_ITEM_ID = 'unicode_display_decoder_menu_item';

export function mountSettingsMenu(document, onOpen) {
    const existing = document.getElementById(MENU_ITEM_ID);
    if (existing) {
        return existing;
    }

    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        return null;
    }

    const item = document.createElement('div');
    item.id = MENU_ITEM_ID;
    item.classList.add('list-group-item', 'flex-container', 'flexGap5', 'unicode-display-menu-item');
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-haspopup', 'dialog');
    item.setAttribute('aria-label', 'Unicode 转义显示还原');

    const icon = document.createElement('div');
    icon.classList.add('fa-solid', 'fa-font', 'extensionsMenuExtensionButton');
    const text = document.createElement('span');
    text.textContent = 'Unicode 转义显示还原';
    item.append(icon, text);

    item.addEventListener('click', onOpen);
    item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen();
        }
    });
    menu.append(item);
    return item;
}

export function createSettingsContent(document, settings, onChange) {
    const content = document.createElement('div');
    content.className = 'unicode-display-popup';

    const title = document.createElement('h3');
    title.textContent = 'Unicode 转义显示还原';
    content.append(title);

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'checkbox_label';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = Boolean(settings.enabled);
    const enabledText = document.createElement('span');
    enabledText.textContent = '仅在页面显示时还原 Unicode 转义';
    enabledLabel.append(enabled, enabledText);
    content.append(enabledLabel);

    const scopeLabel = document.createElement('label');
    scopeLabel.htmlFor = 'unicode_display_decoder_popup_scope';
    scopeLabel.textContent = '适用范围';
    const scope = document.createElement('select');
    scope.id = 'unicode_display_decoder_popup_scope';
    scope.className = 'text_pole';
    for (const [label, value] of [
        ['仅 AI 回复（推荐）', 'assistant'],
        ['全部聊天消息', 'all'],
    ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        scope.append(option);
    }
    scope.value = settings.scope === 'all' ? 'all' : 'assistant';
    content.append(scopeLabel, scope);

    const hint = document.createElement('small');
    hint.className = 'unicode-display-hint';
    hint.textContent = '不会修改聊天记录；代码块、编辑框和双反斜杠转义示例保持原样。';
    content.append(hint);

    enabled.addEventListener('change', () => onChange({ enabled: enabled.checked }));
    scope.addEventListener('change', () => onChange({ scope: scope.value }));
    return content;
}

export function createSettingsPopupOpener({ document, Popup, POPUP_TYPE, getSettings, onChange }) {
    let activePopup;

    return function openSettingsPopup() {
        if (activePopup) {
            return activePopup;
        }

        const content = createSettingsContent(document, getSettings(), onChange);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
            okButton: '关闭',
            allowVerticalScrolling: true,
        });
        activePopup = Promise.resolve(popup.show()).finally(() => {
            activePopup = null;
        });
        return activePopup;
    };
}
