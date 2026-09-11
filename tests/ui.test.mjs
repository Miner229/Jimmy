import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { build } from "esbuild";
import { unlink } from "node:fs/promises";
await build({
  entryPoints: ["src/App.jsx"],
  outfile: "tests/.app.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  loader: { ".css": "empty" },
});
const { default: App } = await import("./.app.mjs");
await unlink("tests/.app.mjs");
globalThis.window = {
  location: { search: "", origin: "https://example.com" },
  scrollTo() {},
};
globalThis.document = { activeElement: { focus() {} } };
const content = (node) =>
  node.children.map((x) => (typeof x === "string" ? x : content(x))).join("");
test("Existing mobile navigation keeps layout and opens all four creation choices", async () => {
  let app;
  await act(async () => {
    app = TestRenderer.create(React.createElement(App), {
      createNodeMock: (element) =>
        element.type === "dialog" ? { showModal() {} } : {},
    });
  });
  const nav = app.root
    .findAllByType("nav")
    .find((x) => x.props.className.includes("grid-cols-5"));
  assert.deepEqual(
    nav.findAllByType("button").map((x) => x.props["aria-label"]),
    ["Discover", "Clubs", "Create", "Rankings", "Bookings"],
  );
  await act(async () => nav.findAllByType("button")[2].props.onClick());
  assert.equal(app.root.findAllByType("dialog").length, 1);
  const options = app.root
    .findByProps({ className: "creation-options" })
    .findAllByType("button");
  assert.deepEqual(
    options.map((x) => content(x.findByType("strong"))),
    ["Session", "Coaching", "Tournaments", "Club"],
  );
  await act(async () => options[3].props.onClick());
  assert.ok(app.toJSON());
  assert.ok(
    JSON.stringify(app.toJSON()).includes(
      "Sign in to create or manage your Club.",
    ),
  );
  await act(async () => app.unmount());
});
test("Registration requests full name, email and password only", async () => {
  let app;
  await act(async () => {
    app = TestRenderer.create(React.createElement(App));
  });
  const signup = app.root
    .findAllByType("button")
    .find((x) => content(x) === "Sign up / Create profile");
  await act(async () => signup.props.onClick());
  const create = app.root
    .findAllByType("button")
    .find((x) => content(x) === "Create account");
  await act(async () => create.props.onClick());
  const inputs = app.root.findAllByType("input").filter((x) => x.props.name);
  assert.deepEqual(
    inputs.map((x) => x.props.name),
    ["full_name", "email", "password"],
  );
  assert.equal(inputs[2].props.type, "password");
  assert.equal(inputs[2].props.minLength, 12);
  await act(async () => app.unmount());
});
