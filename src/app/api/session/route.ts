import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSessionToken, isConfigured, isSameOrigin, secureEqual, SESSION_COOKIE, SESSION_SECONDS, verifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  return NextResponse.json({
    configured: isConfigured(),
    authenticated: isConfigured() && verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.DIRECTOR_ACCESS_CODE || "")
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  if (!isConfigured()) return NextResponse.json({ error: "工作台尚未配置完成，请联系网站拥有者。" }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 2048) return NextResponse.json({ error: "请求过大。" }, { status: 413 });
  let code: unknown;
  try {
    const body = await request.text();
    if (body.length > 2048) return NextResponse.json({ error: "请求过大。" }, { status: 413 });
    code = JSON.parse(body).code;
  } catch { return NextResponse.json({ error: "请输入访问码。" }, { status: 400 }); }
  if (typeof code !== "string" || !secureEqual(code, process.env.DIRECTOR_ACCESS_CODE!)) {
    return NextResponse.json({ error: "访问码不正确，请重新输入。" }, { status: 401 });
  }
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(process.env.DIRECTOR_ACCESS_CODE!), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_SECONDS
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
