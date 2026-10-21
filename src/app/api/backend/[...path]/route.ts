import { NextRequest } from "next/server";
import { userFacingError } from "@/lib/user-error";

export const maxDuration = 300;

type Context = { params: Promise<{ path: string[] }> };

function pythonBase() {
  return process.env.PYTHON_AGENT_URL?.trim().replace(/\/$/, "") ?? "";
}

async function forward(req: NextRequest, path: string[]) {
  const base = pythonBase();
  if (!base) {
    return Response.json(
      { detail: "Сохранение сейчас без API. Откройте студию через Docker на порту 8000." },
      { status: 503 },
    );
  }
  const target = new URL(`${base}/${path.join("/")}`);
  target.search = new URL(req.url).search;
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const token = process.env.STUDIO_API_TOKEN?.trim();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let response: Response;
  try {
    response = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      signal: AbortSignal.timeout(290_000),
    });
  } catch (error) {
    return Response.json({ detail: userFacingError(error) }, { status: 502 });
  }
  const out = new Headers();
  const type = response.headers.get("content-type");
  if (type) out.set("content-type", type);
  const disposition = response.headers.get("content-disposition");
  if (disposition) out.set("content-disposition", disposition);
  return new Response(await response.arrayBuffer(), { status: response.status, headers: out });
}

export async function GET(req: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function POST(req: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function PUT(req: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function DELETE(req: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(req, path);
}
