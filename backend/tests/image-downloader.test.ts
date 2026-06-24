import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test";

const { isPrivateOrReservedIp } = await import("../src/services/image-downloader.js");

test("isPrivateOrReservedIp blocks private and reserved IPv4 ranges", () => {
  const blocked = [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
  ];

  for (const address of blocked) {
    assert.equal(isPrivateOrReservedIp(address), true, address);
  }
});

test("isPrivateOrReservedIp allows public IPv4 addresses", () => {
  const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34"];

  for (const address of allowed) {
    assert.equal(isPrivateOrReservedIp(address), false, address);
  }
});

test("isPrivateOrReservedIp blocks private and reserved IPv6 ranges", () => {
  const blocked = [
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ];

  for (const address of blocked) {
    assert.equal(isPrivateOrReservedIp(address), true, address);
  }
});

test("isPrivateOrReservedIp allows public IPv6 addresses", () => {
  const allowed = ["2606:4700:4700::1111", "2001:4860:4860::8888"];

  for (const address of allowed) {
    assert.equal(isPrivateOrReservedIp(address), false, address);
  }
});
