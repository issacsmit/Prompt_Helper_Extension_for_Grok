(function wireGrokComposerFixture(globalObject) {
  "use strict";

  const documentObject = globalObject.document;
  if (!documentObject) {
    return;
  }

  const status = documentObject.getElementById("fixture-status");
  const form = documentObject.getElementById("live-composer");
  const sendButton = documentObject.getElementById("fixture-send");
  const rebuildButton = documentObject.getElementById("fixture-rebuild");
  const clearEditorButton = documentObject.getElementById("fixture-clear-editor");
  const resetStorageButton = documentObject.getElementById(
    "fixture-reset-storage",
  );
  const themeControl = documentObject.getElementById("fixture-theme");
  const reducedMotionControl = documentObject.getElementById(
    "fixture-reduced-motion",
  );

  function showStatus(message) {
    if (status) {
      status.textContent = message;
    }
  }

  function currentEditor() {
    return documentObject.getElementById("grok-prompt-editor");
  }

  function updateSendState() {
    if (!sendButton) {
      return;
    }
    const hasText = Boolean(currentEditor()?.textContent?.trim());
    sendButton.disabled = !hasText;
    sendButton.setAttribute("aria-disabled", String(!hasText));
  }

  rebuildButton?.addEventListener("click", () => {
    const current = currentEditor();
    const template = documentObject.getElementById("spa-replacement-template");
    const replacement = template?.content?.firstElementChild?.cloneNode(true);
    if (!current || !replacement) {
      showStatus("SPA 重建失败：fixture 结构不完整。");
      return;
    }
    current.replaceWith(replacement);
    replacement.focus({ preventScroll: true });
    updateSendState();
    showStatus("已替换输入框节点；可继续插入以验证 MutationObserver 重绑定。");
  });

  clearEditorButton?.addEventListener("click", () => {
    const editor = currentEditor();
    if (!editor) {
      return;
    }
    const paragraph = documentObject.createElement("p");
    paragraph.setAttribute("data-empty-paragraph", "true");
    const breakElement = documentObject.createElement("br");
    breakElement.className = "ProseMirror-trailingBreak";
    paragraph.appendChild(breakElement);
    editor.replaceChildren(paragraph);
    editor.focus({ preventScroll: true });
    updateSendState();
    showStatus("输入框已清空；附件节点仍保留在 composer 中。");
  });

  resetStorageButton?.addEventListener("click", () => {
    globalObject.chrome?.storage?.local?.clear?.(() => {
      showStatus("fixture 本地存储已清空；助手会通过 onChanged 同步为空状态。");
    });
  });

  themeControl?.addEventListener("change", () => {
    const theme = themeControl.value;
    const root = documentObject.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    if (theme === "system") {
      root.removeAttribute("data-theme");
      root.removeAttribute("data-fixture-theme");
    } else {
      root.setAttribute("data-theme", theme);
      root.setAttribute("data-fixture-theme", theme);
    }
    showStatus(`fixture 主题已切换为：${theme}。`);
  });

  reducedMotionControl?.addEventListener("change", () => {
    documentObject.documentElement.setAttribute(
      "data-fixture-reduced-motion",
      String(reducedMotionControl.checked),
    );
    showStatus(
      reducedMotionControl.checked
        ? "fixture 已模拟减少动画。"
        : "fixture 已恢复动画。",
    );
  });

  documentObject.addEventListener("input", (event) => {
    if (event.target === currentEditor() || currentEditor()?.contains(event.target)) {
      updateSendState();
    }
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    showStatus("发送已被 fixture 拦截：这里只验证按钮启用，不会发送任何内容。");
  });

  updateSendState();
  showStatus("fixture 已就绪；助手数据只保存在当前浏览器的本地存储中。");
})(globalThis);
