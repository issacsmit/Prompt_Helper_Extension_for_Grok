(function exposePromptHelperContent(globalObject) {
  "use strict";

  const namespace = globalObject.PromptHelper || {};
  const isCommonJs = typeof module !== "undefined" && module.exports;

  function nodeExport(modulePath, exportName) {
    if (!isCommonJs) {
      return undefined;
    }
    return require(modulePath)[exportName];
  }

  function resolveDependency(options, name, modulePath) {
    return options[name] || namespace[name] || nodeExport(modulePath, name);
  }

  function defaultSchedule(windowObject, callback) {
    if (typeof windowObject?.requestAnimationFrame === "function") {
      windowObject.requestAnimationFrame(callback);
      return;
    }
    if (typeof globalObject.queueMicrotask === "function") {
      globalObject.queueMicrotask(callback);
      return;
    }
    globalObject.setTimeout(callback, 0);
  }

  async function createRuntime(options) {
    const documentObject = options.document || globalObject.document || null;
    const windowObject =
      options.window || documentObject?.defaultView || globalObject.window || null;
    if (!documentObject?.documentElement) {
      throw new Error("Prompt Helper requires an initialized document.");
    }

    const Storage = resolveDependency(options, "Storage", "./storage.js");
    const GrokComposerAdapter = resolveDependency(
      options,
      "GrokComposerAdapter",
      "./grok-editor.js",
    );
    const PromptHelperUI = resolveDependency(options, "PromptHelperUI", "./ui.js");
    const PromptHelperController = resolveDependency(
      options,
      "PromptHelperController",
      "./ui.js",
    );
    const prepareInsertion = resolveDependency(
      options,
      "prepareInsertion",
      "./prompt-engine.js",
    );
    const extractPromptSlots = resolveDependency(
      options,
      "extractPromptSlots",
      "./prompt-engine.js",
    );
    const updatePlaceholderHistory = resolveDependency(
      options,
      "updatePlaceholderHistory",
      "./prompt-engine.js",
    );
    const MutationObserverConstructor =
      options.MutationObserver ||
      windowObject?.MutationObserver ||
      globalObject.MutationObserver;

    if (
      typeof Storage !== "function" ||
      typeof GrokComposerAdapter !== "function" ||
      typeof PromptHelperUI !== "function" ||
      typeof PromptHelperController !== "function"
    ) {
      throw new Error("Prompt Helper dependencies were not loaded in the required order.");
    }

    const orphanRoot = documentObject.getElementById?.("phg-root");
    orphanRoot?.remove?.();

    const storage =
      options.storage || new Storage(options.chrome || globalObject.chrome);
    const editor =
      options.editor ||
      new GrokComposerAdapter({ document: documentObject, window: windowObject });
    const ui =
      options.ui || new PromptHelperUI({ document: documentObject, window: windowObject });
    const controller =
      options.controller ||
      new PromptHelperController({
        storage,
        editor,
        view: ui,
        extractPromptSlots,
        prepareInsertion,
        updatePlaceholderHistory,
      });
    const root = ui.mount(controller);
    let destroyed = false;
    let observerCallbackPending = false;
    let observer = null;
    const schedule =
      typeof options.schedule === "function"
        ? options.schedule
        : (callback) => defaultSchedule(windowObject, callback);

    const ensureSingleton = () => {
      const current = documentObject.getElementById?.("phg-root");
      if (current && current !== ui.root) {
        current.remove?.();
      }
      ui.ensureMounted?.();
    };

    const scheduleRebind = () => {
      if (destroyed || observerCallbackPending) {
        return;
      }
      observerCallbackPending = true;
      schedule(() => {
        observerCallbackPending = false;
        if (destroyed) {
          return;
        }
        try {
          editor.rebind?.();
        } catch (_error) {
          // A transient SPA mutation must not create an exception loop.
        }
        ensureSingleton();
      });
    };

    if (typeof MutationObserverConstructor === "function") {
      observer = new MutationObserverConstructor(scheduleRebind);
      observer.observe(documentObject.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    const runtime = {
      storage,
      editor,
      ui,
      controller,
      root,
      destroy() {
        if (destroyed) {
          return;
        }
        destroyed = true;
        observerCallbackPending = false;
        try {
          observer?.disconnect?.();
        } catch (_error) {
          // Extension invalidation during teardown is intentionally contained.
        }
        try {
          controller.destroy?.();
        } catch (_error) {
          // Teardown remains idempotent even if an extension API disappeared.
        }
        try {
          ui.destroy?.();
        } catch (_error) {
          // The DOM may already have been removed by the host SPA.
        }
        if (namespace.phgContentRuntime === runtime) {
          namespace.phgContentRuntime = null;
        }
      },
    };

    try {
      editor.rebind?.();
      runtime.initializeResult = await controller.initialize();
    } catch (error) {
      runtime.destroy();
      throw error;
    }
    return runtime;
  }

  function initializePromptHelper(options = {}) {
    if (namespace.phgContentRuntime) {
      return Promise.resolve(namespace.phgContentRuntime);
    }
    if (namespace.phgContentInitialization) {
      return namespace.phgContentInitialization;
    }

    const initialization = createRuntime(options).then(
      (runtime) => {
        namespace.phgContentRuntime = runtime;
        if (namespace.phgContentInitialization === initialization) {
          namespace.phgContentInitialization = null;
        }
        return runtime;
      },
      (error) => {
        if (namespace.phgContentInitialization === initialization) {
          namespace.phgContentInitialization = null;
        }
        throw error;
      },
    );
    namespace.phgContentInitialization = initialization;
    return initialization;
  }

  async function destroyPromptHelper() {
    let runtime = namespace.phgContentRuntime;
    if (!runtime && namespace.phgContentInitialization) {
      try {
        runtime = await namespace.phgContentInitialization;
      } catch (_error) {
        runtime = null;
      }
    }
    runtime?.destroy?.();
    if (namespace.phgContentRuntime === runtime) {
      namespace.phgContentRuntime = null;
    }
  }

  const api = { initializePromptHelper, destroyPromptHelper };
  Object.assign(namespace, api);
  globalObject.PromptHelper = namespace;

  if (isCommonJs) {
    module.exports = api;
  } else if (globalObject.document) {
    const start = () => {
      void initializePromptHelper().catch(() => {
        // Dependency and extension errors are surfaced by the mounted UI when possible.
      });
    };
    if (globalObject.document.readyState === "loading") {
      globalObject.document.addEventListener("DOMContentLoaded", start, {
        once: true,
      });
    } else {
      start();
    }
  }
})(globalThis);
