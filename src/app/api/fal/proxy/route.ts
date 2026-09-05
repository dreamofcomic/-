import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isConfigured, isSameOrigin, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { forwardWmaRequest } from "@/lib/wma-proxy";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  if (!isConfigured()) return NextResponse.json({ error: "工作台尚未配置完成。" }, { status: 503 });
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.DIRECTOR_ACCESS_CODE || "")) {
    return NextResponse.json({ error: "请先输入工作台访问码。" }, { status: 401 });
  }
  // Video/audio travels directly over WebRTC, never through this Vercel function.
  return forwardWmaRequest(request, process.env.FAL_KEY!);
}
