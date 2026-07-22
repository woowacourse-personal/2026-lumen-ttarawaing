export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const javascriptKey = process.env.KAKAO_JAVASCRIPT_KEY;
  if (!javascriptKey) {
    return Response.json(
      { error: "Kakao Maps is not configured." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  return Response.json(
    { javascriptKey },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
