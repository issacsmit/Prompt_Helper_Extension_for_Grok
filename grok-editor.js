(function exposeGrokEditor(globalObject) {
  "use strict";

  const namespace = globalObject.PromptHelper || {};
  const PRIMARY_TIPTAP_SELECTOR =
    '.tiptap.ProseMirror[contenteditable="true"]';
  const CONTENTEDITABLE_SELECTOR = '[contenteditable="true"]';
  const ROLE_EDITOR_SELECTOR = '[role="textbox"][contenteditable="true"]';
  const COMPOSER_SELECTOR = '[data-testid*="composer"]';
  const CHAT_INPUT_SELECTOR = '[data-testid="chat-input"]';
  const GROK_TEXTAREA_LABEL_PATTERN =
    /ask\s+grok|grok\s+anything|ask\s+anything|问\s*grok|grok-compose|compose-input|随便问|尽管问|有什么问题|有什么想问|どんなことでも/iu;

  function queryAll(root, selector) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (_error) {
      return [];
    }
  }

  function getAttribute(element, name) {
    return typeof element?.getAttribute === "function"
      ? element.getAttribute(name)
      : null;
  }

  function isUsableEditor(element, windowObject) {
    if (
      !element ||
      element.isConnected === false ||
      element.hidden ||
      element.disabled ||
      element.readOnly ||
      getAttribute(element, "aria-hidden") === "true" ||
      getAttribute(element, "aria-disabled") === "true" ||
      getAttribute(element, "aria-readonly") === "true"
    ) {
      return false;
    }

    if (typeof windowObject?.getComputedStyle === "function") {
      const style = windowObject.getComputedStyle(element);
      if (style?.display === "none" || style?.visibility === "hidden") {
        return false;
      }
    }

    if (typeof element.getClientRects === "function") {
      const rects = element.getClientRects();
      if (!rects || rects.length === 0) {
        return false;
      }
    }

    return true;
  }

  function firstUsable(candidates, windowObject) {
    return candidates.find((candidate) => isUsableEditor(candidate, windowObject)) || null;
  }

  function clamp(value, minimum, maximum) {
    const numericValue = Number.isFinite(value) ? value : minimum;
    return Math.min(maximum, Math.max(minimum, numericValue));
  }

  function isTextarea(editor) {
    return String(editor?.tagName || "").toLowerCase() === "textarea";
  }

  function classTokens(element) {
    const value =
      typeof element?.className === "string"
        ? element.className
        : getAttribute(element, "class") || "";
    return String(value)
      .split(/\s+/u)
      .filter(Boolean);
  }

  function isTiptapComposer(element) {
    if (getAttribute(element, "contenteditable") !== "true") {
      return false;
    }
    const tokens = classTokens(element);
    return tokens.includes("tiptap") && tokens.includes("ProseMirror");
  }

  function labeledTextHaystack(element) {
    return [
      getAttribute(element, "aria-label"),
      getAttribute(element, "placeholder"),
      getAttribute(element, "aria-placeholder"),
      getAttribute(element, "data-testid"),
    ]
      .filter(Boolean)
      .join("\n");
  }

  function isGrokLabeledTextarea(element) {
    if (!isTextarea(element)) {
      return false;
    }
    const haystack = labeledTextHaystack(element);
    return GROK_TEXTAREA_LABEL_PATTERN.test(haystack) || /\bgrok\b/iu.test(haystack);
  }

  function normalizeTextareaValue(value) {
    return String(value).replace(/\r\n?/gu, "\n");
  }

  function findValueSetter(editor, windowObject) {
    const prototypes = [];
    if (windowObject?.HTMLTextAreaElement?.prototype) {
      prototypes.push(windowObject.HTMLTextAreaElement.prototype);
    }

    let prototype = Object.getPrototypeOf(editor);
    while (prototype) {
      if (!prototypes.includes(prototype)) {
        prototypes.push(prototype);
      }
      prototype = Object.getPrototypeOf(prototype);
    }

    for (const candidate of prototypes) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, "value");
      if (typeof descriptor?.set === "function") {
        return descriptor.set;
      }
    }
    return null;
  }

  function focusEditor(editor) {
    if (typeof editor?.focus !== "function") {
      return;
    }
    try {
      editor.focus({ preventScroll: true });
    } catch (_error) {
      editor.focus();
    }
  }

  function createInputEvent(windowObject, text) {
    const init = {
      bubbles: true,
      composed: true,
      data: text,
      inputType: "insertText",
    };
    const InputEventConstructor = windowObject?.InputEvent;
    if (typeof InputEventConstructor === "function") {
      try {
        return new InputEventConstructor("input", init);
      } catch (_error) {
        // Older browsers can expose InputEvent without a constructible initializer.
      }
    }

    const EventConstructor = windowObject?.Event || globalObject.Event;
    const event = new EventConstructor("input", init);
    for (const [key, value] of Object.entries(init)) {
      if (!(key in event)) {
        try {
          Object.defineProperty(event, key, { value, configurable: true });
        } catch (_error) {
          // Event dispatch still carries type/bubbling semantics if fields are read-only.
        }
      }
    }
    return event;
  }

  const BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DIV",
    "FOOTER",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "LI",
    "MAIN",
    "NAV",
    "P",
    "PRE",
    "SECTION",
  ]);

  function childNodesOf(node) {
    return Array.from(node?.childNodes || []);
  }

  function isBlockNode(node) {
    return node?.nodeType === 1 && BLOCK_TAGS.has(String(node.tagName).toUpperCase());
  }

  function isIgnoredTrailingBreak(node) {
    if (node?.nodeType !== 1 || String(node.tagName).toUpperCase() !== "BR") {
      return false;
    }
    const className =
      typeof node.className === "string"
        ? node.className
        : getAttribute(node, "class") || "";
    if (className.split(/\s+/u).includes("ProseMirror-trailingBreak")) {
      return true;
    }

    const parent = node.parentNode;
    const siblings = childNodesOf(parent);
    return isBlockNode(parent) && siblings.length === 1 && siblings[0] === node;
  }

  function isAtomicNonEditable(node) {
    if (node?.nodeType !== 1) {
      return false;
    }
    const value = getAttribute(node, "contenteditable") ?? node.contentEditable;
    return String(value || "").toLowerCase() === "false";
  }

  function containsNode(root, node) {
    if (!root || !node) {
      return false;
    }
    if (root === node) {
      return true;
    }
    if (typeof root.contains === "function") {
      return root.contains(node);
    }
    let current = node.parentNode;
    while (current) {
      if (current === root) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  function createTextModel(root) {
    const nodeInfo = new Map();
    const positions = [];
    const atomicPositions = [];
    const chunks = [];
    let length = 0;

    const setPosition = (
      offset,
      container,
      pointOffset,
      priority,
      preferLater = false,
    ) => {
      const current = positions[offset];
      if (
        !current ||
        priority > current.priority ||
        (preferLater && priority === current.priority)
      ) {
        positions[offset] = { container, offset: pointOffset, priority };
      }
    };

    const append = (text) => {
      if (!text) {
        return;
      }
      chunks.push(text);
      length += text.length;
    };

    const visit = (node, depth) => {
      const start = length;
      if (node?.nodeType === 3) {
        const data = typeof node.data === "string" ? node.data : node.textContent || "";
        const info = { start, end: start + data.length, childOffsets: null };
        nodeInfo.set(node, info);
        for (let offset = 0; offset <= data.length; offset += 1) {
          setPosition(start + offset, node, offset, 1000 + depth);
        }
        append(data);
        return;
      }

      if (node?.nodeType !== 1) {
        nodeInfo.set(node, { start, end: start, childOffsets: null });
        return;
      }

      if (isAtomicNonEditable(node)) {
        nodeInfo.set(node, { start, end: start, childOffsets: null });
        return;
      }

      if (String(node.tagName).toUpperCase() === "BR") {
        const ignored = isIgnoredTrailingBreak(node);
        nodeInfo.set(node, {
          start,
          end: ignored ? start : start + 1,
          childOffsets: null,
        });
        if (!ignored) {
          append("\n");
        }
        return;
      }

      const children = childNodesOf(node);
      const info = {
        start,
        end: start,
        childOffsets: new Array(children.length + 1),
      };
      nodeInfo.set(node, info);
      info.childOffsets[0] = length;
      setPosition(length, node, 0, depth);

      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        const previousChild = children[index - 1];
        const atomicChild = isAtomicNonEditable(child);
        if (
          index > 0 &&
          (isBlockNode(previousChild) || isBlockNode(child))
        ) {
          append("\n");
        }

        info.childOffsets[index] = length;
        setPosition(length, node, index, depth);
        if (atomicChild) {
          const points = atomicPositions[length] || {};
          points.before ||= { container: node, offset: index };
          atomicPositions[length] = points;
        }
        visit(child, depth + 1);
        info.childOffsets[index + 1] = length;
        if (atomicChild) {
          const points = atomicPositions[length] || {};
          points.after = { container: node, offset: index + 1 };
          atomicPositions[length] = points;
        }
        setPosition(
          length,
          node,
          index + 1,
          atomicChild ? 2000 + depth : depth,
          atomicChild,
        );
      }

      info.end = length;
    };

    visit(root, 0);
    const text = chunks.join("");

    return {
      text,
      offsetAt(container, boundaryOffset) {
        const info = nodeInfo.get(container);
        if (!info) {
          return null;
        }
        if (container.nodeType === 3) {
          const dataLength = Math.max(0, info.end - info.start);
          return info.start + clamp(boundaryOffset, 0, dataLength);
        }
        if (info.childOffsets) {
          const childIndex = Math.trunc(
            clamp(boundaryOffset, 0, info.childOffsets.length - 1),
          );
          return info.childOffsets[childIndex];
        }
        return info.start;
      },
      pointAt(offset, affinity = null) {
        const safeOffset = Math.trunc(clamp(offset, 0, text.length));
        const atomicPoint = atomicPositions[safeOffset]?.[affinity];
        if (atomicPoint) {
          return atomicPoint;
        }
        const point = positions[safeOffset];
        if (point) {
          return { container: point.container, offset: point.offset };
        }
        return { container: root, offset: childNodesOf(root).length };
      },
    };
  }

  function getBoundaryAffinity(root, container, boundaryOffset) {
    let node = container;
    let offset = boundaryOffset;

    while (node && containsNode(root, node)) {
      if (node.nodeType === 3) {
        const textLength = String(node.data ?? node.textContent ?? "").length;
        const safeOffset = Math.trunc(clamp(offset, 0, textLength));
        if (safeOffset !== 0 && safeOffset !== textLength) {
          return null;
        }
        const parent = node.parentNode;
        if (!parent) {
          return null;
        }
        const index = childNodesOf(parent).indexOf(node);
        if (index < 0) {
          return null;
        }
        node = parent;
        offset = index + (safeOffset === textLength ? 1 : 0);
        continue;
      }

      if (node.nodeType !== 1 || isAtomicNonEditable(node)) {
        return null;
      }

      const children = childNodesOf(node);
      const safeOffset = Math.trunc(clamp(offset, 0, children.length));
      if (isAtomicNonEditable(children[safeOffset])) {
        return "before";
      }
      if (isAtomicNonEditable(children[safeOffset - 1])) {
        return "after";
      }
      if (node === root) {
        return null;
      }
      if (safeOffset !== 0 && safeOffset !== children.length) {
        return null;
      }

      const parent = node.parentNode;
      if (!parent) {
        return null;
      }
      const index = childNodesOf(parent).indexOf(node);
      if (index < 0) {
        return null;
      }
      node = parent;
      offset = index + (safeOffset === children.length ? 1 : 0);
    }

    return null;
  }

  function getSelection(documentObject, windowObject) {
    if (typeof windowObject?.getSelection === "function") {
      return windowObject.getSelection();
    }
    if (typeof documentObject?.getSelection === "function") {
      return documentObject.getSelection();
    }
    return null;
  }

  function placeSelection(documentObject, windowObject, startPoint, endPoint) {
    if (!documentObject || typeof documentObject.createRange !== "function") {
      return null;
    }
    const selection = getSelection(documentObject, windowObject);
    if (!selection) {
      return null;
    }
    const range = documentObject.createRange();
    range.setStart(startPoint.container, startPoint.offset);
    if (endPoint && typeof range.setEnd === "function") {
      range.setEnd(endPoint.container, endPoint.offset);
    } else {
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  }

  class GrokComposerAdapter {
    constructor(options = {}) {
      this._document = options.document ?? globalObject.document ?? null;
      this._window =
        options.window ?? this._document?.defaultView ?? globalObject.window ?? null;
      this._editor = null;
      this._bookmark = null;
    }

    rebind() {
      const unique = (candidates) =>
        candidates.filter(
          (candidate, index, allCandidates) =>
            allCandidates.indexOf(candidate) === index,
        );

      const tipTap = firstUsable(
        unique([
          ...queryAll(this._document, PRIMARY_TIPTAP_SELECTOR),
          ...queryAll(this._document, CONTENTEDITABLE_SELECTOR).filter(
            isTiptapComposer,
          ),
        ]),
        this._window,
      );
      if (tipTap) {
        this._editor = tipTap;
        return tipTap;
      }

      const labeledTextarea = firstUsable(
        queryAll(this._document, "textarea").filter(isGrokLabeledTextarea),
        this._window,
      );
      if (labeledTextarea) {
        this._editor = labeledTextarea;
        return labeledTextarea;
      }

      const scopes = unique([
        ...queryAll(this._document, "form"),
        ...queryAll(this._document, COMPOSER_SELECTOR),
        ...queryAll(this._document, CHAT_INPUT_SELECTOR),
      ]);

      const roleCandidates = scopes.flatMap((scope) =>
        queryAll(scope, ROLE_EDITOR_SELECTOR),
      );
      const roleEditor = firstUsable(roleCandidates, this._window);
      if (roleEditor) {
        this._editor = roleEditor;
        return roleEditor;
      }

      const textareaCandidates = scopes.flatMap((scope) =>
        queryAll(scope, "textarea"),
      );
      this._editor = firstUsable(textareaCandidates, this._window);
      return this._editor;
    }

    captureBookmark() {
      const editor = this.rebind();
      if (!editor) {
        return null;
      }

      if (isTextarea(editor)) {
        const text = typeof editor.value === "string" ? editor.value : "";
        const offset = clamp(editor.selectionStart, 0, text.length);
        this._bookmark = { editor, kind: "textarea", offset };
        return { ...this._bookmark };
      }

      const selection = getSelection(this._document, this._window);
      if (!selection || selection.rangeCount < 1) {
        return null;
      }
      const range = selection.getRangeAt(0);
      if (
        !containsNode(editor, range.startContainer) ||
        !containsNode(editor, range.endContainer)
      ) {
        return null;
      }
      const model = createTextModel(editor);
      const offset = model.offsetAt(range.startContainer, range.startOffset);
      if (offset === null) {
        return null;
      }
      this._bookmark = { editor, kind: "contenteditable", offset };
      const affinity = getBoundaryAffinity(
        editor,
        range.startContainer,
        range.startOffset,
      );
      if (affinity) {
        this._bookmark.affinity = affinity;
      }
      return { ...this._bookmark };
    }

    insert(text, caretOffset, selectionEndOffset) {
      const editor = this.rebind();
      if (!editor) {
        return { ok: false, code: "EDITOR_NOT_FOUND" };
      }
      if (typeof text !== "string") {
        return { ok: false, code: "INVALID_TEXT" };
      }

      const insertionResult = isTextarea(editor)
        ? this._insertIntoTextarea(
            editor,
            text,
            caretOffset,
            selectionEndOffset,
          )
        : this._insertIntoContenteditable(
            editor,
            text,
            caretOffset,
            selectionEndOffset,
          );

      return insertionResult;
    }

    _insertIntoTextarea(editor, text, caretOffset, selectionEndOffset) {
      const before = typeof editor.value === "string" ? editor.value : "";
      const insertionStart = Math.trunc(
        clamp(this._bookmark?.offset ?? before.length, 0, before.length),
      );
      const normalizedText = normalizeTextareaValue(text);
      const expected =
        before.slice(0, insertionStart) + normalizedText + before.slice(insertionStart);
      const valueSetter = findValueSetter(editor, this._window);
      if (valueSetter) {
        valueSetter.call(editor, expected);
      } else {
        editor.value = expected;
      }

      if (editor.value !== expected) {
        return { ok: false, code: "INSERTION_FAILED" };
      }

      const sourceCaretOffset = Math.trunc(clamp(caretOffset, 0, text.length));
      const relativeCaretOffset = normalizeTextareaValue(
        text.slice(0, sourceCaretOffset),
      ).length;
      const caretPosition = insertionStart + relativeCaretOffset;
      const sourceSelectionEndOffset = Math.trunc(
        clamp(selectionEndOffset, sourceCaretOffset, text.length),
      );
      const relativeSelectionEndOffset = normalizeTextareaValue(
        text.slice(0, sourceSelectionEndOffset),
      ).length;
      const selectionEndPosition = insertionStart + relativeSelectionEndOffset;
      focusEditor(editor);
      if (typeof editor.setSelectionRange === "function") {
        editor.setSelectionRange(caretPosition, selectionEndPosition);
      } else {
        editor.selectionStart = caretPosition;
        editor.selectionEnd = selectionEndPosition;
      }
      editor.dispatchEvent(createInputEvent(this._window, normalizedText));
      this._bookmark = { editor, kind: "textarea", offset: caretPosition };

      return {
        ok: true,
        code: "INSERTED",
        insertionStart,
        caretPosition,
      };
    }

    _insertIntoContenteditable(editor, text, caretOffset, selectionEndOffset) {
      const beforeModel = createTextModel(editor);
      const before = beforeModel.text;
      const insertionStart = Math.trunc(
        clamp(this._bookmark?.offset ?? before.length, 0, before.length),
      );
      const expected = before.slice(0, insertionStart) + text + before.slice(insertionStart);
      const bookmarkAffinity = this._bookmark?.affinity || null;
      const insertionPoint = beforeModel.pointAt(insertionStart, bookmarkAffinity);
      focusEditor(editor);
      const range = placeSelection(this._document, this._window, insertionPoint);
      if (!range) {
        return { ok: false, code: "INSERTION_FAILED" };
      }

      let commandSucceeded = false;
      if (typeof this._document?.execCommand === "function") {
        try {
          commandSucceeded =
            this._document.execCommand("insertText", false, text) === true;
        } catch (_error) {
          commandSucceeded = false;
        }
      }

      if (!commandSucceeded) {
        try {
          if (
            typeof range.insertNode !== "function" ||
            typeof this._document?.createTextNode !== "function"
          ) {
            return { ok: false, code: "INSERTION_FAILED" };
          }
          range.insertNode(this._document.createTextNode(text));
        } catch (_error) {
          return { ok: false, code: "INSERTION_FAILED" };
        }
      }

      const afterModel = createTextModel(editor);
      if (afterModel.text !== expected) {
        return { ok: false, code: "INSERTION_FAILED" };
      }

      const relativeCaretOffset = Math.trunc(clamp(caretOffset, 0, text.length));
      const caretPosition = insertionStart + relativeCaretOffset;
      const relativeSelectionEndOffset = Math.trunc(
        clamp(selectionEndOffset, relativeCaretOffset, text.length),
      );
      const selectionEndPosition = insertionStart + relativeSelectionEndOffset;
      const caretPoint = afterModel.pointAt(caretPosition, bookmarkAffinity);
      const selectionEndPoint = afterModel.pointAt(
        selectionEndPosition,
        bookmarkAffinity,
      );
      focusEditor(editor);
      if (
        !placeSelection(
          this._document,
          this._window,
          caretPoint,
          selectionEndPoint,
        )
      ) {
        return { ok: false, code: "INSERTION_FAILED" };
      }
      editor.dispatchEvent(createInputEvent(this._window, text));
      this._bookmark = { editor, kind: "contenteditable", offset: caretPosition };
      const caretAffinity = getBoundaryAffinity(
        editor,
        caretPoint.container,
        caretPoint.offset,
      );
      if (caretAffinity) {
        this._bookmark.affinity = caretAffinity;
      }

      return {
        ok: true,
        code: "INSERTED",
        insertionStart,
        caretPosition,
      };
    }
  }

  const api = { GrokComposerAdapter };
  Object.assign(namespace, api);
  globalObject.PromptHelper = namespace;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
