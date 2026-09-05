export const DIRECTOR_ENDPOINT = "minimax/h3-max/director";
export const MAX_PROMPT_LENGTH = 50000;
export type Resolution = "480p" | "768p";
export type DirectionStatus = "pending" | "applied" | "rejected" | "failed";
export type Direction = { version: number; text: string; status: DirectionStatus };

export function openingMessage(prompt: string, resolution: Resolution, imageUrl?: string) {
  return {
    type: "configure", protocol_version: 1, prompt_version: 1,
    prompt: validatePrompt(prompt), aspect_ratio: "16:9", resolution, memory: 12,
    ...(imageUrl ? { image_url: validateImageUrl(imageUrl) } : {})
  };
}

export function validatePrompt(prompt: string): string {
  const clean = prompt.trim();
  if (!clean) throw new Error("先写下这一幕。 ");
  if (clean.length > MAX_PROMPT_LENGTH) throw new Error("这段指令太长了，请控制在 50,000 字符以内。 ");
  return clean;
}

export function validateImageUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new Error("请输入可公开访问的 HTTPS 图片链接。 "); }
}

export function parseServerMessage(raw: unknown): Record<string, unknown> | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && typeof value.type === "string" ? value : null;
  } catch { return null; }
}

export function applyDirectionEvent(directions: Direction[], message: Record<string, unknown>): Direction[] {
  const status: DirectionStatus | undefined = message.type === "prompt_applied" || message.type === "configured" ? "applied" : message.type === "prompt_rejected" ? "rejected" : undefined;
  if (!status || typeof message.prompt_version !== "number") return directions;
  return directions.map(direction => direction.version === message.prompt_version ? { ...direction, status } : direction);
}

export function timecode(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const whole = Math.floor(safe);
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60, Math.floor((safe % 1) * 24)].map(n => String(n).padStart(2, "0")).join(":");
}
