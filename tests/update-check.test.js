"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const updateCheck = require("../update-check.js");

test("update check exposes version helpers through CommonJS and PromptHelper", () => {
  assert.equal(typeof updateCheck.isNewerVersion, "function");
  assert.equal(typeof updateCheck.checkForUpdate, "function");
  assert.equal(globalThis.PromptHelper?.checkForUpdate, updateCheck.checkForUpdate);
});

test("semver comparison treats dotted numbers as newer, not strings", () => {
  assert.equal(updateCheck.isNewerVersion("1.1.0", "1.0.0"), true);
  assert.equal(updateCheck.isNewerVersion("v1.1.0", "1.0.0"), true);
  assert.equal(updateCheck.isNewerVersion("1.0.0", "1.0.0"), false);
  assert.equal(updateCheck.isNewerVersion("1.9.0", "1.10.0"), false);
  assert.equal(updateCheck.isNewerVersion("1.10.0", "1.9.0"), true);
  assert.equal(updateCheck.isNewerVersion("2.0", "1.9.9"), true);
  assert.equal(updateCheck.isNewerVersion("not-a-version", "1.0.0"), false);
});

test("checkForUpdate reports a newer GitHub release", async () => {
  const result = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    fetch: async (url) => {
      assert.equal(url, updateCheck.GITHUB_API_LATEST);
      return {
        ok: true,
        json: async () => ({
          tag_name: "v1.1.0",
          html_url:
            "https://github.com/issacsmit/Prompt_Helper_Extension_for_Grok/releases/tag/v1.1.0",
        }),
      };
    },
  });

  assert.deepEqual(result, {
    status: "available",
    current: "1.0.0",
    latest: "1.1.0",
    htmlUrl:
      "https://github.com/issacsmit/Prompt_Helper_Extension_for_Grok/releases/tag/v1.1.0",
  });
});

test("checkForUpdate treats matching versions as current", async () => {
  const result = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    fetch: async () => ({
      ok: true,
      json: async () => ({ tag_name: "v1.0.0", html_url: "https://evil.example/x" }),
    }),
  });

  assert.equal(result.status, "current");
  assert.equal(result.latest, "1.0.0");
  assert.equal(result.htmlUrl, updateCheck.GITHUB_RELEASES_PAGE);
});

test("checkForUpdate fails closed when GitHub is missing or broken", async () => {
  const missing = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    fetch: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.htmlUrl, updateCheck.GITHUB_RELEASES_PAGE);

  const crashed = await updateCheck.checkForUpdate({
    currentVersion: "1.0.0",
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(crashed.status, "unavailable");
  assert.equal(crashed.code, "NETWORK");
});
