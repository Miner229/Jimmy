import test from "node:test";
import assert from "node:assert/strict";
import { pathToRoute, routeToPath } from "../src/appRoutes.js";

test("all application routes remain below the private preview prefix", () => {
  for (const view of ["discover","clubs","bookings","profile","tools","scoreboard","tactics","levels","rankings","organiser","coaching"]) {
    assert.match(routeToPath(view), /^\/dev53\//);
  }
});

test("detail routes survive a direct page load", () => {
  assert.deepEqual(pathToRoute("/dev53/session/game-6"), { view: "eventDetail", params: { eventId: "game-6" } });
  assert.deepEqual(pathToRoute("/dev53/club/club-2"), { view: "clubDetail", params: { clubId: "club-2" } });
});

test("the public homepage is not interpreted as an application route", () => {
  assert.equal(pathToRoute("/"), null);
});
