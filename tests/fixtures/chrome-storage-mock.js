(function installFixtureChromeStorage(globalObject) {
  "use strict";

  const BACKING_KEY = "prompt-helper-fixture-storage-v1";
  const listeners = new Set();
  let memoryData = {};

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(value));
  }

  function readData() {
    try {
      const stored = globalObject.localStorage?.getItem(BACKING_KEY);
      if (stored !== null && stored !== undefined) {
        const parsed = JSON.parse(stored);
        if (isObject(parsed)) {
          memoryData = clone(parsed);
        }
      }
    } catch (_error) {
      // file:// privacy settings can disable localStorage; memory remains usable.
    }
    return clone(memoryData);
  }

  function writeData(data) {
    memoryData = clone(data);
    try {
      globalObject.localStorage?.setItem(BACKING_KEY, JSON.stringify(memoryData));
    } catch (_error) {
      // The in-memory fallback still supports the current fixture session.
    }
  }

  function defer(callback) {
    if (typeof globalObject.queueMicrotask === "function") {
      globalObject.queueMicrotask(callback);
      return;
    }
    Promise.resolve().then(callback);
  }

  function finish(callback, value, beforeCallback = null) {
    if (typeof callback === "function") {
      defer(() => {
        beforeCallback?.();
        callback(clone(value));
      });
      return undefined;
    }
    return Promise.resolve().then(() => {
      beforeCallback?.();
      return clone(value);
    });
  }

  function selectKeys(data, keys) {
    if (keys === null || keys === undefined) {
      return clone(data);
    }

    const selected = {};
    if (typeof keys === "string") {
      if (Object.prototype.hasOwnProperty.call(data, keys)) {
        selected[keys] = clone(data[keys]);
      }
      return selected;
    }

    if (Array.isArray(keys)) {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          selected[key] = clone(data[key]);
        }
      }
      return selected;
    }

    if (isObject(keys)) {
      for (const [key, fallback] of Object.entries(keys)) {
        selected[key] = Object.prototype.hasOwnProperty.call(data, key)
          ? clone(data[key])
          : clone(fallback);
      }
    }
    return selected;
  }

  function emit(changes) {
    if (Object.keys(changes).length === 0) {
      return;
    }
    for (const listener of [...listeners]) {
      listener(clone(changes), "local");
    }
  }

  function normalizeKeyList(keys) {
    if (typeof keys === "string") {
      return [keys];
    }
    return Array.isArray(keys) ? keys : [];
  }

  const local = {
    get(keys, callback) {
      return finish(callback, selectKeys(readData(), keys));
    },

    set(items, callback) {
      const data = readData();
      const changes = {};
      for (const [key, value] of Object.entries(isObject(items) ? items : {})) {
        const oldValue = data[key];
        const newValue = clone(value);
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
          continue;
        }
        changes[key] = { oldValue: clone(oldValue), newValue };
        data[key] = newValue;
      }
      writeData(data);
      return finish(callback, undefined, () => emit(changes));
    },

    remove(keys, callback) {
      const data = readData();
      const changes = {};
      for (const key of normalizeKeyList(keys)) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
          continue;
        }
        changes[key] = { oldValue: clone(data[key]) };
        delete data[key];
      }
      writeData(data);
      return finish(callback, undefined, () => emit(changes));
    },

    clear(callback) {
      const data = readData();
      const changes = {};
      for (const [key, value] of Object.entries(data)) {
        changes[key] = { oldValue: clone(value) };
      }
      writeData({});
      return finish(callback, undefined, () => emit(changes));
    },
  };

  const onChanged = {
    addListener(listener) {
      if (typeof listener === "function") {
        listeners.add(listener);
      }
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    hasListener(listener) {
      return listeners.has(listener);
    },
  };

  const existingChrome =
    globalObject.chrome && typeof globalObject.chrome === "object"
      ? globalObject.chrome
      : {};
  if (!existingChrome.runtime) {
    existingChrome.runtime = { lastError: null };
  }
  existingChrome.storage = { local, onChanged };
  globalObject.chrome = existingChrome;
  globalObject.__PHG_FIXTURE_STORAGE__ = Object.freeze({ backingKey: BACKING_KEY });
})(globalThis);
