
import { describe, expect, it } from "vitest";
import {
  isPublicIp,
  validateReferenceUrl,
} from "./safe-reference-fetch";

describe("Безопасность внешних источников", () => {
  it("разрешает публичные адреса", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("1.1.1.1")).toBe(true);
  });

  it("проверяет IPv4-mapped IPv6 адреса", () => {
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicIp("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIp("::ffff:192.168.1.1")).toBe(false);
  });

  it("запрещает локальные и внутренние адреса", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "fc00::1",
    ]) {
      expect(isPublicIp(address)).toBe(false);
    }
  });

  it("запрещает внутренние URL", () => {
    expect(() =>
      validateReferenceUrl("http://127.0.0.1:8000/admin"),
    ).toThrow();

    expect(() =>
      validateReferenceUrl("http://169.254.169.254/latest/meta-data/"),
    ).toThrow();
  });

  it("запрещает неподдерживаемые протоколы", () => {
    expect(() =>
      validateReferenceUrl("file:///etc/passwd"),
    ).toThrow();

    expect(() =>
      validateReferenceUrl("ftp://example.com/file"),
    ).toThrow();
  });

  it("разрешает публичные учебные материалы", () => {
    expect(
      validateReferenceUrl("https://docs.python.org/3/").hostname,
    ).toBe("docs.python.org");
  });

  it("запрещает URL с учётными данными", () => {
    expect(() =>
      validateReferenceUrl("https://user:pass@example.com"),
    ).toThrow();
  });

  it("разрешает публичные IPv6-адреса", () => {
  expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
  });

  it("запрещает локальные IPv6-адреса", () => {
    expect(isPublicIp("::1")).toBe(false);
    expect(isPublicIp("fc00::1")).toBe(false);
    expect(isPublicIp("fe80::1")).toBe(false);
  });

  it("проверяет шестнадцатеричную запись IPv4-mapped IPv6", () => {
    expect(isPublicIp("::ffff:808:808")).toBe(true);
    expect(isPublicIp("::ffff:c0a8:101")).toBe(false);
    expect(isPublicIp("::ffff:7f00:1")).toBe(false);
  });

  it("запрещает внутренние IPv6-адреса в URL", () => {
    expect(() => validateReferenceUrl("http://[::1]/")).toThrow();
    expect(() =>
      validateReferenceUrl("http://[::ffff:192.168.1.1]/")
    ).toThrow();
  });

  it("разрешает публичный IPv6 в URL", () => {
    expect(() =>
      validateReferenceUrl("https://[2606:4700:4700::1111]/")
    ).not.toThrow();
  });


});
