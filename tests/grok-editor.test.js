"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function optionalRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      return {};
    }
    throw error;
  }
}

test("editor adapter exposes GrokComposerAdapter through CommonJS and PromptHelper", () => {
  const editorApi = optionalRequire("../grok-editor.js");

  assert.equal(typeof editorApi.GrokComposerAdapter, "function");
  assert.equal(
    globalThis.PromptHelper?.GrokComposerAdapter,
    editorApi.GrokComposerAdapter,
  );
});

const { GrokComposerAdapter } = require("../grok-editor.js");

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class FakeNode {
  constructor(nodeType, ownerDocument = null) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current.nodeType === 9) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [];
    if (String(value)) {
      this.appendChild(this.ownerDocument.createTextNode(String(value)));
    }
  }

  appendChild(node) {
    return this.insertBefore(node, null);
  }

  insertBefore(node, referenceNode) {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    const index =
      referenceNode === null ? this.childNodes.length : this.childNodes.indexOf(referenceNode);
    if (index < 0) {
      throw new Error("Reference node is not a child");
    }
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    setOwnerDocument(node, this.nodeType === 9 ? this : this.ownerDocument);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) {
      throw new Error("Node is not a child");
    }
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }
}

class FakeText extends FakeNode {
  constructor(data, ownerDocument) {
    super(3, ownerDocument);
    this.data = String(data);
  }

  get length() {
    return this.data.length;
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = String(value);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName, ownerDocument) {
    super(1, ownerDocument);
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.disabled = false;
    this.readOnly = false;
    this.hidden = false;
    this.dispatchedEvents = [];
    this._rect = { width: 120, height: 24 };
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get classList() {
    const element = this;
    return {
      contains(name) {
        return element.className.split(/\s+/u).includes(name);
      },
    };
  }

  setAttribute(name, value) {
    this.attributes.set(String(name).toLowerCase(), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name).toLowerCase()) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name).toLowerCase());
  }

  querySelectorAll(selector) {
    return descendants(this).filter(
      (node) => node.nodeType === 1 && matchesSelector(node, selector),
    );
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getClientRects() {
    return this._rect.width > 0 && this._rect.height > 0 ? [this._rect] : [];
  }

  getBoundingClientRect() {
    return { ...this._rect, left: 0, top: 0, right: this._rect.width, bottom: this._rect.height };
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  dispatchEvent(event) {
    this.dispatchedEvents.push(event);
    return true;
  }
}

class FakeTextArea extends FakeElement {
  constructor(ownerDocument) {
    super("textarea", ownerDocument);
    this._value = "";
    this._ignoreValueWrites = false;
    this._normalizeNewlines = false;
    this.nativeSetterCalls = [];
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  get value() {
    return this._value;
  }

  set value(nextValue) {
    const normalized = String(nextValue);
    this.nativeSetterCalls.push(normalized);
    if (!this._ignoreValueWrites) {
      this._value = this._normalizeNewlines
        ? normalized.replace(/\r\n?/gu, "\n")
        : normalized;
    }
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class FakeRange {
  constructor(documentObject) {
    this._document = documentObject;
    this.startContainer = documentObject;
    this.startOffset = 0;
    this.endContainer = documentObject;
    this.endOffset = 0;
    this.collapsed = true;
  }

  setStart(container, offset) {
    this.startContainer = container;
    this.startOffset = offset;
    if (this.collapsed) {
      this.endContainer = container;
      this.endOffset = offset;
    }
  }

  setEnd(container, offset) {
    this.endContainer = container;
    this.endOffset = offset;
    this.collapsed =
      this.startContainer === this.endContainer && this.startOffset === this.endOffset;
  }

  collapse(toStart = false) {
    if (toStart) {
      this.endContainer = this.startContainer;
      this.endOffset = this.startOffset;
    } else {
      this.startContainer = this.endContainer;
      this.startOffset = this.endOffset;
    }
    this.collapsed = true;
  }

  cloneRange() {
    const clone = new FakeRange(this._document);
    clone.startContainer = this.startContainer;
    clone.startOffset = this.startOffset;
    clone.endContainer = this.endContainer;
    clone.endOffset = this.endOffset;
    clone.collapsed = this.collapsed;
    return clone;
  }

  insertNode(node) {
    const container = this.startContainer;
    const offset = this.startOffset;
    if (container.nodeType === 3) {
      const parent = container.parentNode;
      const index = parent.childNodes.indexOf(container);
      const tail = container.data.slice(offset);
      container.data = container.data.slice(0, offset);
      parent.insertBefore(node, parent.childNodes[index + 1] || null);
      if (tail) {
        parent.insertBefore(
          this._document.createTextNode(tail),
          parent.childNodes[index + 2] || null,
        );
      }
      return;
    }
    container.insertBefore(node, container.childNodes[offset] || null);
  }
}

class FakeSelection {
  constructor() {
    this._ranges = [];
  }

  get rangeCount() {
    return this._ranges.length;
  }

  getRangeAt(index) {
    return this._ranges[index];
  }

  removeAllRanges() {
    this._ranges = [];
  }

  addRange(range) {
    this._ranges = [range];
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(9, null);
    this.ownerDocument = this;
    this.activeElement = null;
    this.selection = new FakeSelection();
    this.execCommandMode = "insert";
    this.execCommandCalls = [];
    this.body = new FakeElement("body", this);
    this.appendChild(this.body);
    this.defaultView = {
      HTMLTextAreaElement: FakeTextArea,
      Event: FakeEvent,
      InputEvent: FakeEvent,
      getSelection: () => this.selection,
      getComputedStyle: (element) => ({
        display: element._display || "block",
        visibility: element._visibility || "visible",
      }),
    };
  }

  createElement(tagName) {
    return String(tagName).toLowerCase() === "textarea"
      ? new FakeTextArea(this)
      : new FakeElement(tagName, this);
  }

  createTextNode(data) {
    return new FakeText(data, this);
  }

  createRange() {
    return new FakeRange(this);
  }

  getSelection() {
    return this.selection;
  }

  querySelectorAll(selector) {
    return descendants(this).filter(
      (node) => node.nodeType === 1 && matchesSelector(node, selector),
    );
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  execCommand(command, showUi, value) {
    this.execCommandCalls.push({ command, showUi, value });
    if (this.execCommandMode === "fail") {
      return false;
    }
    if (this.execCommandMode === "noop") {
      return true;
    }
    const range = this.selection.getRangeAt(0);
    if (this.execCommandMode === "paragraphs" && value.includes("\n")) {
      const lines = value.split("\n");
      let paragraph = range.startContainer;
      while (paragraph && paragraph.tagName !== "P") {
        paragraph = paragraph.parentNode;
      }
      if (!paragraph?.parentNode) {
        return false;
      }
      range.insertNode(this.createTextNode(lines[0]));
      const parent = paragraph.parentNode;
      let insertionIndex = parent.childNodes.indexOf(paragraph) + 1;
      for (const line of lines.slice(1)) {
        const nextParagraph = this.createElement("p");
        nextParagraph.appendChild(
          line === "" ? this.createElement("br") : this.createTextNode(line),
        );
        parent.insertBefore(nextParagraph, parent.childNodes[insertionIndex] || null);
        insertionIndex += 1;
      }
      return true;
    }
    range.insertNode(this.createTextNode(value));
    return true;
  }
}

function setOwnerDocument(node, documentObject) {
  node.ownerDocument = documentObject;
  for (const child of node.childNodes) {
    setOwnerDocument(child, documentObject);
  }
}

function descendants(root) {
  const result = [];
  for (const child of root.childNodes) {
    result.push(child, ...descendants(child));
  }
  return result;
}

function matchesSelector(element, selector) {
  if (selector === ".tiptap.ProseMirror[contenteditable=\"true\"]") {
    return (
      element.className.split(/\s+/u).includes("tiptap") &&
      element.className.split(/\s+/u).includes("ProseMirror") &&
      element.getAttribute("contenteditable") === "true"
    );
  }
  if (selector === "[contenteditable=\"true\"]") {
    return element.getAttribute("contenteditable") === "true";
  }
  if (selector === "form") {
    return element.tagName === "FORM";
  }
  if (selector === "[data-testid*=\"composer\"]") {
    return (element.getAttribute("data-testid") || "").includes("composer");
  }
  if (selector === "[data-testid=\"chat-input\"]") {
    return element.getAttribute("data-testid") === "chat-input";
  }
  if (selector === "[role=\"textbox\"][contenteditable=\"true\"]") {
    return (
      element.getAttribute("role") === "textbox" &&
      element.getAttribute("contenteditable") === "true"
    );
  }
  if (selector === "textarea") {
    return element.tagName === "TEXTAREA";
  }
  throw new Error(`Unsupported fake selector: ${selector}`);
}

function element(documentObject, tagName, attributes = {}, children = []) {
  const node = documentObject.createElement(tagName);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "hiddenRect" && value) {
      node._rect = { width: 0, height: 0 };
    } else if (name in node && typeof value === "boolean") {
      node[name] = value;
    } else {
      node.setAttribute(name, value);
    }
  }
  for (const child of children) {
    node.appendChild(typeof child === "string" ? documentObject.createTextNode(child) : child);
  }
  return node;
}

function createAdapter(documentObject) {
  return new GrokComposerAdapter({
    document: documentObject,
    window: documentObject.defaultView,
  });
}

function createTextareaComposer(initialValue = "") {
  const documentObject = new FakeDocument();
  const form = element(documentObject, "form");
  const textarea = element(documentObject, "textarea");
  documentObject.body.appendChild(form);
  form.appendChild(textarea);
  textarea.value = initialValue;
  textarea.nativeSetterCalls = [];
  return { documentObject, form, textarea, adapter: createAdapter(documentObject) };
}

function createContenteditableComposer(children = [], documentObject = new FakeDocument()) {
  const form = element(documentObject, "form");
  const editor = element(
    documentObject,
    "div",
    {
      class: "tiptap ProseMirror",
      role: "textbox",
      contenteditable: "true",
    },
    children,
  );
  documentObject.body.appendChild(form);
  form.appendChild(editor);
  return { documentObject, form, editor, adapter: createAdapter(documentObject) };
}

function setSelection(documentObject, startNode, startOffset, endNode = startNode, endOffset = startOffset) {
  const range = documentObject.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  documentObject.selection.removeAllRanges();
  documentObject.selection.addRange(range);
  return range;
}

function blockText(editor) {
  return editor.childNodes
    .filter((child) => child.nodeType === 1 && child.tagName === "P")
    .map((paragraph) => paragraph.textContent)
    .join("\n");
}

test("editor adapter instances expose rebind, captureBookmark, and insert", () => {
  const adapter = new GrokComposerAdapter();

  assert.equal(typeof adapter.rebind, "function");
  assert.equal(typeof adapter.captureBookmark, "function");
  assert.equal(typeof adapter.insert, "function");
});

test("rebind follows preferred, scoped role, then scoped textarea priority", () => {
  const documentObject = new FakeDocument();
  const outsideEditor = element(documentObject, "div", {
    role: "textbox",
    contenteditable: "true",
  });
  const form = element(documentObject, "form");
  const hiddenFallback = element(documentObject, "textarea", { hiddenRect: true });
  const textarea = element(documentObject, "textarea");
  const roleEditor = element(documentObject, "div", {
    role: "textbox",
    contenteditable: "true",
  });
  const preferred = element(documentObject, "div", {
    class: "tiptap ProseMirror",
    role: "textbox",
    contenteditable: "true",
  });
  documentObject.body.appendChild(outsideEditor);
  documentObject.body.appendChild(form);
  form.appendChild(hiddenFallback);
  form.appendChild(textarea);
  form.appendChild(roleEditor);
  form.appendChild(preferred);
  const adapter = createAdapter(documentObject);

  assert.equal(adapter.rebind(), preferred);

  preferred._rect = { width: 0, height: 0 };
  assert.equal(adapter.rebind(), roleEditor);

  roleEditor.setAttribute("aria-readonly", "true");
  assert.equal(adapter.rebind(), textarea);

  textarea.disabled = true;
  assert.equal(adapter.rebind(), null);
});

test("rebind never falls back to global contenteditable or textarea candidates", () => {
  const documentObject = new FakeDocument();
  const outsideEditor = element(documentObject, "div", {
    role: "textbox",
    contenteditable: "true",
  });
  const outsideTextarea = element(documentObject, "textarea");
  documentObject.body.appendChild(outsideEditor);
  documentObject.body.appendChild(outsideTextarea);

  assert.equal(createAdapter(documentObject).rebind(), null);
});

test("rebind accepts role textbox only inside a composer-labelled container", () => {
  const documentObject = new FakeDocument();
  const composer = element(documentObject, "section", {
    "data-testid": "chat-composer-shell",
  });
  const editor = element(documentObject, "div", {
    role: "textbox",
    contenteditable: "true",
  });
  documentObject.body.appendChild(composer);
  composer.appendChild(editor);

  assert.equal(createAdapter(documentObject).rebind(), editor);
});

test("rebind accepts role textbox inside grok.com chat-input scope", () => {
  const documentObject = new FakeDocument();
  const chatInput = element(documentObject, "div", {
    "data-testid": "chat-input",
  });
  const editor = element(documentObject, "div", {
    role: "textbox",
    contenteditable: "true",
  });
  documentObject.body.appendChild(chatInput);
  chatInput.appendChild(editor);

  assert.equal(createAdapter(documentObject).rebind(), editor);
});

test("textarea bookmark uses selection start and insertion preserves selected text", () => {
  const { documentObject, textarea, adapter } = createTextareaComposer("甲乙丙丁");
  textarea.setSelectionRange(1, 3);
  const bookmark = adapter.captureBookmark();

  assert.equal(bookmark.kind, "textarea");
  assert.equal(bookmark.offset, 1);
  assert.equal(bookmark.editor, textarea);

  documentObject.activeElement = documentObject.body;
  const result = adapter.insert("XYZ", 1);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 1,
    caretPosition: 2,
  });
  assert.equal(textarea.value, "甲XYZ乙丙丁");
  assert.deepEqual(textarea.nativeSetterCalls, ["甲XYZ乙丙丁"]);
  assert.equal(textarea.selectionStart, 2);
  assert.equal(textarea.selectionEnd, 2);
  assert.equal(documentObject.activeElement, textarea);
  assert.equal(textarea.dispatchedEvents.length, 1);
  assert.equal(textarea.dispatchedEvents[0].type, "input");
  assert.equal(textarea.dispatchedEvents[0].bubbles, true);
  assert.equal(textarea.dispatchedEvents[0].composed, true);
  assert.equal(textarea.dispatchedEvents[0].data, "XYZ");
});

test("textarea insertion without a bookmark appends and clamps caretOffset", () => {
  const { textarea, adapter } = createTextareaComposer("abc");

  const result = adapter.insert("!", 99);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 3,
    caretPosition: 4,
  });
  assert.equal(textarea.value, "abc!");
  assert.deepEqual(textarea.nativeSetterCalls, ["abc!"]);
  assert.equal(textarea.selectionStart, 4);
  assert.equal(textarea.selectionEnd, 4);
});

test("textarea reports INSERTION_FAILED when the native setter has no effect", () => {
  const { textarea, adapter } = createTextareaComposer("unchanged");
  textarea._ignoreValueWrites = true;

  const result = adapter.insert("!", 0);

  assert.deepEqual(result, {
    ok: false,
    code: "INSERTION_FAILED",
  });
  assert.equal(textarea.value, "unchanged");
  assert.deepEqual(textarea.nativeSetterCalls, ["unchanged!"]);
  assert.equal(textarea.dispatchedEvents.length, 0);
});

test("textarea accepts native newline normalization and maps caretOffset to normalized text", () => {
  const { textarea, adapter } = createTextareaComposer("base");
  textarea._normalizeNewlines = true;

  const result = adapter.insert("A\r\nB\rC", 4);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 4,
    caretPosition: 7,
  });
  assert.equal(textarea.value, "baseA\nB\nC");
  assert.deepEqual(textarea.nativeSetterCalls, ["baseA\nB\nC"]);
  assert.equal(textarea.selectionStart, 7);
  assert.equal(textarea.selectionEnd, 7);
  assert.equal(adapter.captureBookmark().offset, 7);
  assert.equal(textarea.dispatchedEvents.length, 1);
  assert.equal(textarea.dispatchedEvents[0].data, "A\nB\nC");
});

test("textarea insertion can select an inserted bracket placeholder range", () => {
  const { textarea, adapter } = createTextareaComposer("base");
  const text = "请写【主题】";

  const result = adapter.insert(text, 2, 6);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 4,
    caretPosition: 6,
  });
  assert.equal(textarea.value, `base${text}`);
  assert.equal(textarea.selectionStart, 6);
  assert.equal(textarea.selectionEnd, 10);
  assert.equal(adapter.captureBookmark().offset, 6);
});

test("contenteditable bookmark maps nested selection start and preserves selected text", () => {
  const documentObject = new FakeDocument();
  const nestedText = documentObject.createTextNode("乙丙");
  const strong = element(documentObject, "strong", {}, [nestedText]);
  const attachment = element(documentObject, "span", { "data-attachment": "file" });
  const firstParagraph = element(documentObject, "p", {}, [
    "甲",
    strong,
    attachment,
    "丁",
  ]);
  const secondText = documentObject.createTextNode("第二");
  const secondParagraph = element(documentObject, "p", {}, [secondText]);
  const { editor, adapter } = createContenteditableComposer(
    [firstParagraph, secondParagraph],
    documentObject,
  );
  setSelection(documentObject, nestedText, 1, secondText, 1);

  const bookmark = adapter.captureBookmark();
  assert.equal(bookmark.kind, "contenteditable");
  assert.equal(bookmark.offset, 2);
  assert.equal(bookmark.editor, editor);

  documentObject.selection.removeAllRanges();
  assert.equal(adapter.captureBookmark(), null);
  const result = adapter.insert("XY", 1);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 2,
    caretPosition: 3,
  });
  assert.equal(blockText(editor), "甲乙XY丙丁\n第二");
  assert.equal(firstParagraph.contains(attachment), true);
  assert.equal(secondParagraph.textContent, "第二");
  assert.deepEqual(documentObject.execCommandCalls, [
    { command: "insertText", showUi: false, value: "XY" },
  ]);
  assert.equal(editor.dispatchedEvents.length, 1);
  assert.equal(editor.dispatchedEvents[0].type, "input");
  assert.equal(editor.dispatchedEvents[0].bubbles, true);
  assert.equal(editor.dispatchedEvents[0].composed, true);
  assert.equal(editor.dispatchedEvents[0].data, "XY");

  const restoredBookmark = adapter.captureBookmark();
  assert.equal(restoredBookmark.offset, 3);
});

test("contenteditable insertion can select an inserted bracket placeholder range", () => {
  const documentObject = new FakeDocument();
  const paragraph = element(documentObject, "p", {}, ["base"]);
  const { editor, adapter } = createContenteditableComposer(
    [paragraph],
    documentObject,
  );
  const text = "前【主题】后";

  const result = adapter.insert(text, 1, 5);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 4,
    caretPosition: 5,
  });
  assert.equal(blockText(editor), `base${text}`);
  const range = documentObject.selection.getRangeAt(0);
  assert.equal(range.collapsed, false);
  assert.equal(range.startContainer.data, text);
  assert.equal(range.startOffset, 1);
  assert.equal(range.endContainer, range.startContainer);
  assert.equal(range.endOffset, 5);
  assert.equal(adapter.captureBookmark().offset, 5);
});

test("contenteditable treats non-editable attachment descendants as an atomic boundary", () => {
  const documentObject = new FakeDocument();
  const attachmentLabel = element(documentObject, "span", {}, ["file.pdf"]);
  const attachment = element(
    documentObject,
    "span",
    { "data-attachment-id": "file", contenteditable: "false" },
    [attachmentLabel, element(documentObject, "svg")],
  );
  const paragraph = element(documentObject, "p", {}, ["A", attachment, "B"]);
  const { editor, adapter } = createContenteditableComposer(
    [paragraph],
    documentObject,
  );
  setSelection(documentObject, paragraph, 2);

  const bookmark = adapter.captureBookmark();
  const result = adapter.insert("X", 1);

  assert.equal(bookmark.offset, 1);
  assert.equal(bookmark.affinity, "after");
  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 1,
    caretPosition: 2,
  });
  assert.equal(attachment.textContent, "file.pdf");
  assert.equal(attachment.parentNode, paragraph);
  const insertedNode = paragraph.childNodes.find(
    (node) => node.nodeType === 3 && node.data === "X",
  );
  assert.ok(insertedNode);
  assert.ok(
    paragraph.childNodes.indexOf(insertedNode) > paragraph.childNodes.indexOf(attachment),
  );
  assert.equal(attachment.contains(insertedNode), false);
  assert.equal(paragraph.textContent, "Afile.pdfXB");
  assert.equal(adapter.captureBookmark().offset, 2);
  assert.equal(editor.dispatchedEvents.length, 1);
});

test("contenteditable bookmark affinity preserves the boundary before an atomic attachment", () => {
  const documentObject = new FakeDocument();
  const attachment = element(
    documentObject,
    "span",
    { "data-attachment-id": "file", contenteditable: "false" },
    [element(documentObject, "span", {}, ["file.pdf"])],
  );
  const paragraph = element(documentObject, "p", {}, ["A", attachment, "B"]);
  const { adapter } = createContenteditableComposer([paragraph], documentObject);
  setSelection(documentObject, paragraph, 1);

  const bookmark = adapter.captureBookmark();
  const result = adapter.insert("X", 1);

  assert.equal(bookmark.offset, 1);
  assert.equal(bookmark.affinity, "before");
  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 1,
    caretPosition: 2,
  });
  assert.equal(attachment.textContent, "file.pdf");
  const insertedNode = paragraph.childNodes.find(
    (node) => node.nodeType === 3 && node.data === "X",
  );
  assert.ok(insertedNode);
  assert.ok(
    paragraph.childNodes.indexOf(insertedNode) < paragraph.childNodes.indexOf(attachment),
  );
  assert.equal(attachment.contains(insertedNode), false);
  assert.equal(paragraph.textContent, "AXfile.pdfB");
  const restoredBookmark = adapter.captureBookmark();
  assert.equal(restoredBookmark.offset, 2);
  assert.equal(restoredBookmark.affinity, "before");
});

test("contenteditable block boundary distinguishes second paragraph start", () => {
  const documentObject = new FakeDocument();
  const firstText = documentObject.createTextNode("第一段");
  const secondText = documentObject.createTextNode("第二段");
  const firstParagraph = element(documentObject, "p", {}, [firstText]);
  const secondParagraph = element(documentObject, "p", {}, [secondText]);
  const { editor, adapter } = createContenteditableComposer(
    [firstParagraph, secondParagraph],
    documentObject,
  );
  setSelection(documentObject, secondText, 0);

  assert.equal(adapter.captureBookmark().offset, firstText.length + 1);
  const result = adapter.insert(">>", 0);

  assert.equal(result.insertionStart, firstText.length + 1);
  assert.equal(blockText(editor), "第一段\n>>第二段");
  assert.equal(firstParagraph.textContent, "第一段");
  assert.equal(secondParagraph.textContent, ">>第二段");
  assert.equal(adapter.captureBookmark().offset, firstText.length + 1);
});

test("contenteditable Range fallback inserts inside an empty ProseMirror paragraph", () => {
  const documentObject = new FakeDocument();
  const trailingBreak = element(documentObject, "br", {
    class: "ProseMirror-trailingBreak",
  });
  const emptyParagraph = element(
    documentObject,
    "p",
    { "data-empty-paragraph": "true" },
    [trailingBreak],
  );
  const { editor, adapter } = createContenteditableComposer(
    [emptyParagraph],
    documentObject,
  );
  documentObject.execCommandMode = "fail";
  setSelection(documentObject, emptyParagraph, 0);

  assert.equal(adapter.captureBookmark().offset, 0);
  const result = adapter.insert("hello", 2);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 0,
    caretPosition: 2,
  });
  assert.equal(editor.textContent, "hello");
  assert.equal(emptyParagraph.childNodes[0].textContent, "hello");
  assert.equal(emptyParagraph.childNodes[1], trailingBreak);
  assert.equal(adapter.captureBookmark().offset, 2);
  assert.equal(editor.dispatchedEvents.length, 1);
});

test("contenteditable reports INSERTION_FAILED when execCommand claims success without mutation", () => {
  const documentObject = new FakeDocument();
  const paragraph = element(documentObject, "p", {}, ["stable"]);
  const { editor, adapter } = createContenteditableComposer(
    [paragraph],
    documentObject,
  );
  documentObject.execCommandMode = "noop";

  const result = adapter.insert("!", 0);

  assert.deepEqual(result, {
    ok: false,
    code: "INSERTION_FAILED",
  });
  assert.equal(blockText(editor), "stable");
  assert.deepEqual(documentObject.execCommandCalls, [
    { command: "insertText", showUi: false, value: "!" },
  ]);
  assert.equal(editor.dispatchedEvents.length, 0);
});

test("contenteditable verifies multiline insertion normalized into paragraph blocks", () => {
  const documentObject = new FakeDocument();
  const paragraph = element(documentObject, "p", {}, ["base"]);
  const { editor, adapter } = createContenteditableComposer(
    [paragraph],
    documentObject,
  );
  documentObject.execCommandMode = "paragraphs";

  const result = adapter.insert("甲\n乙", 2);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 4,
    caretPosition: 6,
  });
  assert.equal(blockText(editor), "base甲\n乙");
  assert.equal(editor.childNodes.length, 2);
  assert.equal(editor.childNodes[0].textContent, "base甲");
  assert.equal(editor.childNodes[1].textContent, "乙");
  assert.equal(adapter.captureBookmark().offset, 6);
  assert.deepEqual(documentObject.execCommandCalls, [
    { command: "insertText", showUi: false, value: "甲\n乙" },
  ]);
  assert.equal(editor.dispatchedEvents.length, 1);
});

test("contenteditable treats a browser-normalized bare BR paragraph as one empty line", () => {
  const documentObject = new FakeDocument();
  const trailingBreak = element(documentObject, "br", {
    class: "ProseMirror-trailingBreak",
  });
  const emptyParagraph = element(
    documentObject,
    "p",
    { "data-empty-paragraph": "true" },
    [trailingBreak],
  );
  const { editor, adapter } = createContenteditableComposer(
    [emptyParagraph],
    documentObject,
  );
  documentObject.execCommandMode = "paragraphs";

  const result = adapter.insert("请总结：\n\n保留附件", 5);

  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 0,
    caretPosition: 5,
  });
  assert.equal(editor.childNodes.length, 3);
  assert.equal(editor.childNodes[1].childNodes[0].tagName, "BR");
  assert.equal(editor.childNodes[1].childNodes[0].className, "");
  assert.equal(adapter.captureBookmark().offset, 5);
  const range = documentObject.selection.getRangeAt(0);
  assert.equal(range.startContainer, editor.childNodes[1]);
  assert.equal(range.startOffset, 0);
  assert.equal(editor.dispatchedEvents.length, 1);
});

test("SPA replacement rebinds and clamps the bookmark to the new logical text length", () => {
  const documentObject = new FakeDocument();
  const originalText = documentObject.createTextNode("abcdef");
  const originalParagraph = element(documentObject, "p", {}, [originalText]);
  const { form, editor: originalEditor, adapter } = createContenteditableComposer(
    [originalParagraph],
    documentObject,
  );
  setSelection(documentObject, originalText, 5);
  assert.equal(adapter.captureBookmark().offset, 5);

  form.removeChild(originalEditor);
  const trailingBreak = element(documentObject, "br", {
    class: "ProseMirror-trailingBreak",
  });
  const replacementEditor = element(
    documentObject,
    "div",
    {
      class: "tiptap ProseMirror",
      role: "textbox",
      contenteditable: "true",
    },
    [
      element(documentObject, "p", {}, ["A"]),
      element(documentObject, "p", { "data-empty-paragraph": "true" }, [trailingBreak]),
      element(documentObject, "p", {}, ["B"]),
    ],
  );
  form.appendChild(replacementEditor);

  const result = adapter.insert("Z", 0);

  assert.equal(adapter.rebind(), replacementEditor);
  assert.deepEqual(result, {
    ok: true,
    code: "INSERTED",
    insertionStart: 4,
    caretPosition: 4,
  });
  assert.equal(blockText(replacementEditor), "A\n\nBZ");
  assert.equal(blockText(originalEditor), "abcdef");
  assert.equal(adapter.captureBookmark().editor, replacementEditor);
  assert.equal(adapter.captureBookmark().offset, 4);
});

test("missing editor returns a result distinct from insertion failure", () => {
  const documentObject = new FakeDocument();
  const adapter = createAdapter(documentObject);

  assert.equal(adapter.rebind(), null);
  assert.equal(adapter.captureBookmark(), null);
  assert.deepEqual(adapter.insert("text", 0), {
    ok: false,
    code: "EDITOR_NOT_FOUND",
  });
});

test("rebind accepts a labeled Grok landing textarea outside form scope", () => {
  const documentObject = new FakeDocument();
  const landing = element(documentObject, "textarea", {
    "aria-label": "Ask Grok anything",
  });
  documentObject.body.appendChild(landing);

  assert.equal(createAdapter(documentObject).rebind(), landing);
});

test("rebind prefers TipTap composer over a labeled landing textarea", () => {
  const documentObject = new FakeDocument();
  const landing = element(documentObject, "textarea", {
    "aria-label": "Ask Grok anything",
  });
  const conversation = element(documentObject, "div", {
    class: "tiptap ProseMirror",
    contenteditable: "true",
  });
  documentObject.body.appendChild(landing);
  documentObject.body.appendChild(conversation);

  assert.equal(createAdapter(documentObject).rebind(), conversation);
});

test("browser fixture includes live, fallback, outside, attachment, and rebuild structures", () => {
  const fixturePath = path.join(__dirname, "fixtures", "grok-composer.html");
  const fixture = fs.readFileSync(fixturePath, "utf8");

  assert.match(fixture, /id="outside-editor"[^>]*contenteditable="true"/u);
  assert.match(fixture, /<form id="live-composer"(?![^>]*data-testid)[^>]*>/u);
  assert.match(
    fixture,
    /id="grok-prompt-editor"[^>]*class="[^"]*tiptap ProseMirror[^"]*"[^>]*contenteditable="true"/u,
  );
  assert.match(fixture, /data-testid="chat-input"/u);
  assert.match(fixture, /is-empty is-editor-empty[\s\S]*ProseMirror-trailingBreak/u);
  assert.match(fixture, /fallbackTextarea[^>]*aria-hidden="true"/u);
  assert.match(fixture, /data-testid="chat-composer-fallback"[\s\S]*role="textbox"/u);
  assert.match(fixture, /id="textarea-fallback"/u);
  assert.match(fixture, /id="landing-textarea"[^>]*aria-label="Ask Grok anything"/u);
  assert.match(fixture, /data-attachment-id=/u);
  assert.match(fixture, /id="spa-rebuild-container"/u);
});
