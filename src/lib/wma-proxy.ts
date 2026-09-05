import { DIRECTOR_ENDPOINT } from "./director-protocol";

const ALLOWED_PATHS = new Set(["/ice", "/session", "/session/heartbeat"]);
const MAX_BODY_BYTES = 131072;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Narrow WMA relay. Caller must authenticate and check Origin before invoking. */
export async function forwardWmaRequest(request: Request, apiKey: string, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!apiKey) return error("视频服务尚未配置。", 503);
  if (request.method !== "POST") return error("不支持此请求。", 405);
  let target: URL;
  try { target = new URL(request.headers.get("x-fal-target-url") || ""); }
  catch { return error("请求目标无效。", 400); }
  if (target.origin !== "https://wma.fal.run" || target.username || target.password || target.search || target.hash || !ALLOWED_PATHS.has(target.pathname)) {
    return error("请求目标无效。", 400);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return error("请求过大。", 413);
  let payload: Record<string, unknown>;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return error("请求过大。", 413);
    payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return error("请求内容无效。", 400);
  } catch { return error("请求内容无效。", 400); }
  if (target.pathname === "/session/heartbeat") {
    if (typeof payload.session_id !== "string" || !payload.session_id || payload.session_id.length > 1024) return error("会话无效。", 400);
  } else if (payload.app_id !== DIRECTOR_ENDPOINT) return error("此工作台仅支持 H3 Max Director。", 400);
  if (target.pathname === "/session" && (payload.type !== "offer" || typeof payload.sdp !== "string" || !payload.sdp)) return error("协商内容无效。", 400);

  try {
    // Preserve browser cancellation and cap server-side negotiation below Vercel's function limit.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55000)]);
    const upstream = await fetcher(target.href, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Key ${apiKey}` },
      body: JSON.stringify(payload),
      signal,
      redirect: "error",
      cache: "no-store"
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return error(upstream.status === 401 || upstream.status === 403 ? "视频服务访问被拒绝，请检查 fal 密钥与端点权限。" : upstream.status === 429 ? "视频服务繁忙或额度不足，请稍后重试。" : "视频服务暂时不可用，请稍后重试。", upstream.status);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") || "application/json", "Cache-Control": "no-store" }
    });
  } catch {
    return error(request.signal.aborted ? "请求已取消。" : "视频服务连接超时或中断。", request.signal.aborted ? 499 : 502);
  }
}
