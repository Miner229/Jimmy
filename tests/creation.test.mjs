import { build } from "esbuild";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { unlink } from "node:fs/promises";
await build({
  entryPoints: ["src/CreateFlows.jsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  loader: { ".css": "empty" },
  outfile: "tests/.creation.mjs",
});
const { EventForm, ClubForm } = await import("./.creation.mjs");
await unlink("tests/.creation.mjs");
test("Session and tournament share the complete form with distinct titles", () => {
  for (const kind of ["session", "tournament"]) {
    const html = renderToStaticMarkup(
      React.createElement(EventForm, { kind, onBack() {} }),
    );
    assert.ok(
      html.includes(
        kind === "session" ? "Create Session" : "Create Tournament",
      ),
    );
    for (const name of [
      "title",
      "organiser",
      "location",
      "dates",
      "start",
      "end",
      "capacity",
      "price",
      "phone",
      "photos",
      "insurance",
      "MenMin",
      "WomenMax",
    ])
      assert.ok(html.includes(`name="${name}"`), name);
    assert.ok(html.includes('max="1000"'));
  }
});
test("Club onboarding asks only name sport and area, without KYC or contact requirements", () => {
  const html = renderToStaticMarkup(
    React.createElement(ClubForm, { onBack() {} }),
  );
  for (const name of ["name", "primary_sport", "main_area"])
    assert.ok(html.includes(`name="${name}"`), name);
  for (const name of [
    "logo",
    "phone",
    "wechat",
    "passport",
    "bank",
    "company_number",
  ])
    assert.ok(!html.includes(`name="${name}"`), name);
});
test("Unconfigured backend never returns a false submission or approval", async () => {
  const { default: handler } = await import("../api/creation/[kind].js");
  const res = {
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(data) {
      this.data = data;
      return this;
    },
  };
  handler({ method: "POST" }, res);
  assert.equal(res.code, 503);
  assert.equal(res.data.code, "SERVICE_NOT_CONFIGURED");
  assert.equal(res.data.id, undefined);
});
