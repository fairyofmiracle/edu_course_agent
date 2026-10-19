
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";

const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;

const blocked = new BlockList();

const ipv4Ranges: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

for (const [address, prefix] of ipv4Ranges) {
  blocked.addSubnet(address, prefix, "ipv4");
}

const ipv6Ranges: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2001::", 23],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

for (const [address, prefix] of ipv6Ranges) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export class ReferenceFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ReferenceFetchError";
  }
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);

  if (family === 4) {
    return !blocked.check(address, "ipv4");
  }

  if (family === 6) {
    const normalized = address.toLowerCase();

    // IPv4-mapped IPv6: ::ffff:192.168.1.1
    // также поддерживаем шестнадцатеричную запись
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);

      if (isIP(mapped) === 4) {
        return isPublicIp(mapped);
      }

      const parts = mapped.split(":");

      if (
        parts.length === 2 &&
        parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))
      ) {
        const high = parseInt(parts[0], 16);
        const low = parseInt(parts[1], 16);

        const ipv4 = [
          high >>> 8,
          high & 255,
          low >>> 8,
          low & 255,
        ].join(".");

        return isPublicIp(ipv4);
      }

      return false;
    }

    return (
      (normalized.startsWith("2") || normalized.startsWith("3")) &&
      !blocked.check(address, "ipv6")
    );
  }

  return false;
}

export function validateReferenceUrl(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ReferenceFetchError("Некорректный URL");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new ReferenceFetchError("Недопустимый адрес источника");
  }

  if (url.port && !["80", "443"].includes(url.port)) {
    throw new ReferenceFetchError("Нестандартный порт запрещён");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && !isPublicIp(hostname)) {
    throw new ReferenceFetchError("Внутренний или служебный адрес запрещён");
  }

  return url;
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 4);
      return;
    }

    if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) {
      callback(new Error("DNS вернул запрещённый IP-адрес"), "", 4);
      return;
    }

    const selected = addresses.find((item) =>
      options && typeof options === "object" && options.family
        ? item.family === options.family
        : true,
    );

    if (!selected) {
      callback(new Error("Нет подходящего публичного IP-адреса"), "", 4);
      return;
    }

    callback(null, selected.address, selected.family);
  });
};

function downloadOnce(url: URL): Promise<{
  status: number;
  location?: string;
  text: string;
}> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;

    const req = transport(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          Accept: "text/html,text/plain",
          "Accept-Encoding": "identity",
          "User-Agent": "edu-course-agent/0.1",
        },
      },
      (response) => {
        const status = response.statusCode ?? 502;
        const location = response.headers.location;

        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location, text: "" });
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new ReferenceFetchError(`Сайт ответил ${status}`));
          return;
        }

        const contentType = response.headers["content-type"] ?? "";
        if (
          contentType &&
          !/^(text\/html|text\/plain|application\/xhtml\+xml)\b/i.test(contentType)
        ) {
          response.destroy();
          reject(new ReferenceFetchError("Ссылка не ведёт на текстовую страницу"));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;

        response.on("data", (chunk: Buffer) => {
          size += chunk.length;

          if (size > MAX_BYTES) {
            response.destroy(
              new ReferenceFetchError("Страница превышает лимит 1 МБ", 413),
            );
            return;
          }

          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve({
            status,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });

        response.on("error", reject);
      },
    );

    req.on("timeout", () => {
      req.destroy(new ReferenceFetchError("Сайт не ответил вовремя", 504));
    });

    req.on("error", reject);
    req.end();
  });
}

export async function fetchReferencePage(value: string): Promise<{
  title: string;
  html: string;
}> {
  let url = validateReferenceUrl(value);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    let result: Awaited<ReturnType<typeof downloadOnce>>;

    try {
      result = await downloadOnce(url);
    } catch (error) {
      if (error instanceof ReferenceFetchError) throw error;
      throw new ReferenceFetchError(
        "Не удалось безопасно загрузить источник",
        502,
      );
    }

    if (result.status >= 300 && result.status < 400) {
      if (!result.location) {
        throw new ReferenceFetchError("Перенаправление без адреса");
      }

      if (redirect === MAX_REDIRECTS) {
        throw new ReferenceFetchError("Слишком много перенаправлений");
      }

      url = validateReferenceUrl(new URL(result.location, url).toString());
      continue;
    }

    return { title: url.hostname, html: result.text };
  }

  throw new ReferenceFetchError("Не удалось загрузить страницу");
}
