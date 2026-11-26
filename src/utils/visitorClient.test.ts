import assert from "node:assert/strict";
import test from "node:test";
import {
  detectBrowserAndDevice,
  formatCoords,
  formatSessionDuration,
  getLocationSourceBadge,
  projectWorldLatLng,
} from "./visitorClient";

test("detectBrowserAndDevice extracts minimal browser and device metadata without fingerprinting", () => {
  const chromeWin = detectBrowserAndDevice(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
  );
  assert.equal(chromeWin.deviceCategory, "desktop");
  assert.equal(chromeWin.browser, "Chrome");

  const iphone = detectBrowserAndDevice(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
  );
  assert.equal(iphone.deviceCategory, "mobile");
  assert.equal(iphone.browser, "Safari");

  const edge = detectBrowserAndDevice(
    "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0"
  );
  assert.equal(edge.browser, "Edge");
});

test("formatSessionDuration, formatCoords, and getLocationSourceBadge differentiate GPS vs IP estimate", () => {
  assert.equal(formatSessionDuration(42), "42s");
  assert.equal(formatSessionDuration(135), "2m 15s");
  assert.equal(formatCoords(23.2599, 77.4126), "23.2599, 77.4126");
  assert.equal(formatCoords(null, null), "Unavailable");

  const gps = getLocationSourceBadge("gps");
  assert.equal(gps.label, "GPS (Consented)");
  const ip = getLocationSourceBadge("ip");
  assert.equal(ip.label, "IP Estimate");
  assert.match(ip.detail, /Approximate/i);
});

test("projectWorldLatLng maps coordinates accurately within SVG viewport", () => {
  const center = projectWorldLatLng(0, 0, 800, 400);
  assert.equal(center.x, 400);
  assert.equal(center.y, 200);

  const bhopal = projectWorldLatLng(23.2599, 77.4126, 800, 400);
  assert.ok(bhopal.x > 550 && bhopal.x < 600);
  assert.ok(bhopal.y > 140 && bhopal.y < 160);
});
