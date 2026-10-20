import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const httpRequest = vi.fn();
const httpsRequest = vi.fn();
const dnsLookup = vi.fn();

vi.mock("node:http", () => ({
  request: (...args: unknown[]) => httpRequest(...args),
}));
vi.mock("node:https", () => ({
  request: (...args: unknown[]) => httpsRequest(...args),
}));
vi.mock("node:dns", () => ({
  lookup: (...args: unknown[]) => dnsLookup(...args),
}));

type FakeResponse = EventEmitter & {
  statusCode: number;
  headers: Record<string, string | undefined>;
  resume: () => void;
  destroy: (error?: Error) => void;
};

function fakeResponse(status: number, headers: Record<string, string | undefined> = {}): FakeResponse {
  const response = new EventEmitter() as FakeResponse;
  response.statusCode = status;
  response.headers = headers;
  response.resume = () => {};
  response.destroy = (error) => {
    if (error) response.emit("error", error);
  };
  return response;
}

type FakeRequest = EventEmitter & {
  destroy: (error?: Error) => void;
  end: () => void;
};

function installRequest(
  target: ReturnType<typeof vi.fn>,
  respond: (response: FakeResponse, request: FakeRequest) => void,
  status = 200,
  headers: Record<string, string | undefined> = { "content-type": "text/html" },
) {
  target.mockImplementation((_url: unknown, _options: unknown, callback: (response: FakeResponse) => void) => {
    const request = new EventEmitter() as FakeRequest;
    request.destroy = (error) => {
      if (error) request.emit("error", error);
    };
    request.end = () => {};
    const response = fakeResponse(status, headers);
    queueMicrotask(() => {
      callback(response);
      respond(response, request);
    });
    return request;
  });
}

describe("fetchReferencePage", () => {
  beforeEach(() => {
    httpRequest.mockReset();
    httpsRequest.mockReset();
    dnsLookup.mockReset();
  });

  it("отклоняет кривой адрес, чужой порт и читает текстовую страницу", async () => {
    const { fetchReferencePage, validateReferenceUrl } = await import("./safe-reference-fetch");
    expect(() => validateReferenceUrl("не адрес")).toThrow(/Некорректный URL/);
    expect(() => validateReferenceUrl("https://example.com:8443/a")).toThrow(/порт/);

    installRequest(httpsRequest, (response) => {
      response.emit("data", Buffer.from("<html>Приказ</html>"));
      response.emit("end");
    });
    const page = await fetchReferencePage("https://docs.python.org/3/");
    expect(page.title).toBe("docs.python.org");
    expect(page.html).toContain("Приказ");
  });

  it("идёт по перенаправлению и останавливается без адреса или после лимита", async () => {
    const { fetchReferencePage } = await import("./safe-reference-fetch");
    httpsRequest
      .mockImplementationOnce((_url: unknown, _options: unknown, callback: (response: FakeResponse) => void) => {
        const request = new EventEmitter() as FakeRequest;
        request.destroy = () => {};
        request.end = () => {};
        queueMicrotask(() =>
          callback(fakeResponse(302, { location: "https://docs.python.org/3/library/" })),
        );
        return request;
      });
    installRequest(httpsRequest, (response) => {
      response.emit("data", Buffer.from("текст"));
      response.emit("end");
    });
    const page = await fetchReferencePage("https://docs.python.org/3/");
    expect(page.html).toBe("текст");

    installRequest(httpsRequest, () => {}, 302, {});
    await expect(fetchReferencePage("https://docs.python.org/3/")).rejects.toThrow(/без адреса/);

    httpsRequest.mockImplementation((_url: unknown, _options: unknown, callback: (response: FakeResponse) => void) => {
      const request = new EventEmitter() as FakeRequest;
      request.destroy = () => {};
      request.end = () => {};
      queueMicrotask(() => callback(fakeResponse(302, { location: "/next" })));
      return request;
    });
    await expect(fetchReferencePage("https://docs.python.org/3/")).rejects.toThrow(/перенаправлен/);
  });

  it("не сохраняет чужой тип, ошибку сайта, обрыв и слишком большую страницу", async () => {
    const { fetchReferencePage } = await import("./safe-reference-fetch");
    installRequest(httpsRequest, () => {}, 200, { "content-type": "application/pdf" });
    await expect(fetchReferencePage("https://docs.python.org/3/")).rejects.toThrow(/текстовую страницу/);

    installRequest(httpsRequest, () => {}, 404, { "content-type": "text/plain" });
    await expect(fetchReferencePage("https://docs.python.org/3/")).rejects.toThrow(/404/);

    installRequest(httpsRequest, (_response, request) => {
      request.emit("error", new Error("обрыв"));
    });
    await expect(fetchReferencePage("https://docs.python.org/3/")).rejects.toThrow(/безопасно загрузить/);

    installRequest(httpsRequest, (_response, request) => {
      request.emit("timeout");
    });
    await expect(fetchReferencePage("https://docs.python.org/3/")).rejects.toThrow(/не ответил/);

    installRequest(httpsRequest, (response) => {
      response.emit("data", Buffer.alloc(1024 * 1024 + 1));
    });
    await expect(fetchReferencePage("https://docs.python.org/3/")).rejects.toThrow(/1 МБ/);

    installRequest(httpRequest, (response) => {
      response.emit("data", Buffer.from("по http"));
      response.emit("end");
    });
    const httpPage = await fetchReferencePage("http://docs.python.org/3/");
    expect(httpPage.html).toBe("по http");
  });

  it("не подставляет внутренний адрес из DNS", async () => {
    const { fetchReferencePage } = await import("./safe-reference-fetch");
    let lookup: (
      hostname: string,
      options: { family?: number },
      callback: (error: Error | null, address: string, family: number) => void,
    ) => void = () => {};
    httpsRequest.mockImplementation((_url: unknown, options: { lookup: typeof lookup }, callback: (response: FakeResponse) => void) => {
      lookup = options.lookup;
      const request = new EventEmitter() as FakeRequest;
      request.destroy = () => {};
      request.end = () => {};
      const response = fakeResponse(200);
      queueMicrotask(() => {
        callback(response);
        response.emit("data", Buffer.from("ок"));
        response.emit("end");
      });
      return request;
    });
    await fetchReferencePage("https://docs.python.org/3/");

    dnsLookup.mockImplementation((_host: string, _options: unknown, callback: (error: Error | null, addresses: Array<{ address: string; family: number }>) => void) => {
      callback(new Error("dns"), []);
    });
    await new Promise<void>((resolve) => {
      lookup("docs.python.org", {}, (error) => {
        expect(error?.message).toBe("dns");
        resolve();
      });
    });

    dnsLookup.mockImplementation((_host: string, _options: unknown, callback: (error: Error | null, addresses: Array<{ address: string; family: number }>) => void) => {
      callback(null, [{ address: "10.0.0.8", family: 4 }]);
    });
    await new Promise<void>((resolve) => {
      lookup("docs.python.org", {}, (error) => {
        expect(error?.message).toContain("запрещённый");
        resolve();
      });
    });

    dnsLookup.mockImplementation((_host: string, _options: unknown, callback: (error: Error | null, addresses: Array<{ address: string; family: number }>) => void) => {
      callback(null, [{ address: "8.8.8.8", family: 4 }]);
    });
    await new Promise<void>((resolve) => {
      lookup("docs.python.org", { family: 6 }, (error) => {
        expect(error?.message).toContain("подходящего");
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      lookup("docs.python.org", { family: 4 }, (error, address, family) => {
        expect(error).toBeNull();
        expect(address).toBe("8.8.8.8");
        expect(family).toBe(4);
        resolve();
      });
    });
  });
});
