import { explainSberError, getSberAccessToken } from "@/lib/sber-auth";

const SYNTH_URL = "https://smartspeech.sber.ru/rest/v1/text:synthesize";
const MAX_CHARS = 3500;

const VOICES = new Set([
  "Nec_24000",
  "Nec_8000",
  "Bys_24000",
  "Bys_8000",
  "May_24000",
  "May_8000",
  "Tur_24000",
  "Tur_8000",
  "Ost_24000",
  "Ost_8000",
  "Pon_24000",
  "Pon_8000",
  "Kin_24000",
  "Kin_8000",
]);

export async function POST(req: Request) {
  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return Response.json({ error: "Некорректный JSON запроса" }, { status: 400 });
  }

  if (!text) {
    return Response.json({ error: "Нет текста для озвучки" }, { status: 400 });
  }

  const credentials = process.env.SALUTE_CREDENTIALS?.trim();
  if (!credentials) {
    return Response.json(
      {
        error:
          "Не задан SALUTE_CREDENTIALS. Добавьте ключ авторизации SaluteSpeech в .env.local — см. .env.example.",
      },
      { status: 500 },
    );
  }

  const requested = process.env.SALUTE_VOICE?.trim() || "Nec_24000";
  const voice = VOICES.has(requested) ? requested : "Nec_24000";

  try {
    const accessToken = await getSberAccessToken({
      credentials,
      scope: process.env.SALUTE_SCOPE?.trim() || "SALUTE_SPEECH_PERS",
    });
    const url = new URL(SYNTH_URL);
    url.searchParams.set("format", "wav16");
    url.searchParams.set("voice", voice);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/text",
      },
      body: text.slice(0, MAX_CHARS),
    });

    if (!response.ok) {
      const detail = await response.text();
      return Response.json(
        { error: detail.slice(0, 300) || `SaluteSpeech ответил ${response.status}` },
        { status: 502 },
      );
    }

    const audio = await response.arrayBuffer();
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: explainSberError(error, "Не удалось озвучить текст") },
      { status: 500 },
    );
  }
}
