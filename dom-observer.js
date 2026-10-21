const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SHOW_TEXT = 4;

/**
 * Observes chat text plus same-origin renderer frames without crossing the
 * iframe security boundary. Decoding is delegated to the text-only processor.
 */
export function createDomObserver({
    document,
    MutationObserver,
    requestAnimationFrame,
    cancelAnimationFrame = () => {},
    getSettings,
    processor,
}) {
    let chatObserver;
    let observedChat;
    let animationFrameId = 0;
    const pendingRoots = new Map();
    const frameStates = new Map();

    function walkText(root, callback) {
        if (!root) {
            return;
        }

        if (root.nodeType === TEXT_NODE) {
            callback(root);
            return;
        }

        const ownerDocument = root.nodeType === 9 ? root : root.ownerDocument;
        const walker = ownerDocument?.createTreeWalker?.(root, SHOW_TEXT);
        if (!walker) {
            return;
        }

        let node;
        while ((node = walker.nextNode())) {
            callback(node);
        }
    }

    function messageForNode(node) {
        const element = node?.nodeType === ELEMENT_NODE ? node : node?.parentElement;
        const body = element?.matches?.('.mes_text') ? element : element?.closest?.('.mes_text');
        return body?.closest?.('.mes') ?? null;
    }

    function frameElementsWithin(root) {
        if (!root || (root.nodeType !== ELEMENT_NODE && root.nodeType !== 9)) {
            return [];
        }

        const frames = [];
        if (root.nodeType === ELEMENT_NODE && root.matches?.('iframe')) {
            frames.push(root);
        }
        root.querySelectorAll?.('iframe').forEach((frame) => frames.push(frame));
        return frames;
    }

    function disconnectFrameDocument(state, restore = false) {
        state.observer?.disconnect();
        for (const [root, context] of pendingRoots) {
            if (context.ownerFrame === state.frame) {
                pendingRoots.delete(root);
            }
        }
        if (restore && state.root) {
            restoreRoot(state.root);
        }
        state.observer = null;
        state.frameDocument = null;
        state.observedRoot = null;
        state.root = null;
    }

    function unregisterFrame(frame) {
        const state = frameStates.get(frame);
        if (!state) {
            return;
        }

        for (const [childFrame, childState] of frameStates) {
            if (childState.ownerFrame === frame) {
                unregisterFrame(childFrame);
            }
        }

        disconnectFrameDocument(state, true);
        frame.removeEventListener?.('load', state.onLoad);
        frameStates.delete(frame);
    }

    function unregisterFramesWithin(root) {
        for (const frame of frameElementsWithin(root)) {
            unregisterFrame(frame);
        }
    }

    function processRoot(root, message, ownerFrame = null) {
        for (const frame of frameElementsWithin(root)) {
            registerFrame(frame, message ?? messageForNode(frame), ownerFrame);
        }

        walkText(root, (node) => processor.process(node, undefined, message));
    }

    function restoreRoot(root) {
        walkText(root, processor.restore);
    }

    function flushPendingRoots() {
        animationFrameId = 0;
        const roots = [...pendingRoots];
        pendingRoots.clear();

        for (const [root, context] of roots) {
            if (root?.isConnected !== false) {
                processRoot(root, context.message, context.ownerFrame);
            }
        }
    }

    function scheduleRoot(root, message, ownerFrame = null) {
        if (!root) {
            return;
        }

        pendingRoots.set(root, { message, ownerFrame });
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(flushPendingRoots);
        }
    }

    function handleFrameMutations(state, mutations) {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const removed of mutation.removedNodes) {
                    unregisterFramesWithin(removed);
                }
            }
        }

        if (!getSettings().enabled) {
            return;
        }

        state.message = messageForNode(state.frame) ?? state.message;
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                processor.process(mutation.target, mutation.oldValue, state.message);
                continue;
            }

            for (const added of mutation.addedNodes) {
                scheduleRoot(added, state.message, state.frame);
            }
        }
    }

    function attachFrame(state) {
        let frameDocument;
        try {
            frameDocument = state.frame.contentDocument;
        } catch {
            disconnectFrameDocument(state);
            return;
        }

        const observedRoot = frameDocument?.documentElement;
        if (!frameDocument || !observedRoot) {
            disconnectFrameDocument(state);
            return;
        }

        state.message = messageForNode(state.frame) ?? state.message;
        const contentRoot = frameDocument.body ?? observedRoot;
        if (state.frameDocument === frameDocument && state.observedRoot === observedRoot && state.observer) {
            state.root = contentRoot;
            scheduleRoot(contentRoot, state.message, state.frame);
            return;
        }

        disconnectFrameDocument(state);
        state.frameDocument = frameDocument;
        state.observedRoot = observedRoot;
        state.root = contentRoot;
        state.observer = new MutationObserver((mutations) => handleFrameMutations(state, mutations));
        state.observer.observe(observedRoot, {
            childList: true,
            subtree: true,
            characterData: true,
            characterDataOldValue: true,
        });
        scheduleRoot(state.root, state.message, state.frame);
    }

    function registerFrame(frame, message, ownerFrame = null) {
        let state = frameStates.get(frame);
        if (!state) {
            state = {
                frame,
                message,
                ownerFrame,
                frameDocument: null,
                observedRoot: null,
                root: null,
                observer: null,
                onLoad: null,
            };
            state.onLoad = () => attachFrame(state);
            frameStates.set(frame, state);
            frame.addEventListener?.('load', state.onLoad);
        } else {
            state.message = message ?? state.message;
            state.ownerFrame = ownerFrame;
        }

        attachFrame(state);
    }

    function handleChatMutations(mutations) {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const removed of mutation.removedNodes) {
                    unregisterFramesWithin(removed);
                }
            }
        }

        if (!getSettings().enabled) {
            return;
        }

        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                if (messageForNode(mutation.target)) {
                    processor.process(mutation.target, mutation.oldValue);
                }
                continue;
            }

            for (const added of mutation.addedNodes) {
                const message = messageForNode(added);
                if (message) {
                    scheduleRoot(added);
                    continue;
                }

                if (added.nodeType === ELEMENT_NODE) {
                    added.querySelectorAll?.('.mes_text').forEach((body) => scheduleRoot(body));
                }
            }
        }
    }

    function observeChat() {
        const chat = document.querySelector('#chat');
        if (!chat || chat === observedChat) {
            return;
        }

        chatObserver?.disconnect();
        for (const frame of [...frameStates.keys()]) {
            unregisterFrame(frame);
        }
        observedChat = chat;
        chatObserver = new MutationObserver(handleChatMutations);
        chatObserver.observe(chat, {
            childList: true,
            subtree: true,
            characterData: true,
            characterDataOldValue: true,
        });
    }

    function scheduleChat() {
        observeChat();
        document.querySelectorAll('#chat .mes_text').forEach((body) => scheduleRoot(body));
    }

    function restoreChat() {
        document.querySelectorAll('#chat .mes_text').forEach(restoreRoot);
        for (const state of frameStates.values()) {
            if (state.root) {
                restoreRoot(state.root);
            }
        }
    }

    function applySettings() {
        restoreChat();
        if (getSettings().enabled) {
            scheduleChat();
        }
    }

    function disconnect() {
        chatObserver?.disconnect();
        chatObserver = null;
        observedChat = null;
        for (const frame of [...frameStates.keys()]) {
            unregisterFrame(frame);
        }
        pendingRoots.clear();
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = 0;
        }
    }

    return {
        applySettings,
        disconnect,
        observeChat,
        restoreChat,
        scheduleChat,
    };
}
