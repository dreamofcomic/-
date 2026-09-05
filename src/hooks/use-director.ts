"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma, type ManagedRealtimeSession, type WmaRealtimeSession } from "@fal-ai/client/realtime";
import { applyDirectionEvent, DIRECTOR_ENDPOINT, openingMessage, parseServerMessage, validatePrompt, type Direction, type Resolution } from "@/lib/director-protocol";

export type Phase = "idle" | "connecting" | "generating" | "live" | "stopping" | "ended" | "error";
type DirectorSession = ManagedRealtimeSession<WmaRealtimeSession>;

export function useDirector() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [directions, setDirections] = useState<Direction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<DirectorSession | null>(null);
  const generationRef = useRef(0);
  const versionRef = useRef(0);
  const configuredRef = useRef(false);
  const receiverRef = useRef<MediaStream | null>(null);
  const expectedStreamRef = useRef<MediaStream | null>(null);
  const sourceStreamsRef = useRef(new Map<MediaStream, () => void>());
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }, []);

  const release = useCallback(() => {
    clearWatchdog();
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void session.close().catch(() => {});
    for (const [source, listener] of sourceStreamsRef.current) source.removeEventListener("addtrack", listener);
    sourceStreamsRef.current.clear();
    videoRef.current?.pause();
    if (videoRef.current) videoRef.current.srcObject = null;
    expectedStreamRef.current = null;
    receiverRef.current?.getTracks().forEach(track => track.stop());
    receiverRef.current = null;
    setStream(null);
    setHasFrame(false);
  }, [clearWatchdog]);

  const fail = useCallback((message: string) => {
    generationRef.current += 1;
    release();
    setError(message);
    setPhase("error");
    setNotice(null);
    setDirections(previous => previous.map(item => item.status === "pending" ? { ...item, status: "failed" } : item));
  }, [release]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || (stream && expectedStreamRef.current !== stream)) return;
    const current = generationRef.current;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {
      if (generationRef.current === current && expectedStreamRef.current === stream) setNeedsPlayback(true);
    });
  }, [stream]);

  useEffect(() => () => {
    generationRef.current += 1;
    release();
  }, [release]);

  const start = useCallback((prompt: string, resolution: Resolution, imageUrl?: string) => {
    const configure = openingMessage(prompt, resolution, imageUrl);
    generationRef.current += 1;
    const current = generationRef.current;
    release();
    versionRef.current = 1;
    configuredRef.current = false;
    setError(null);
    setNotice(null);
    setStream(null);
    setHasFrame(false);
    setNeedsPlayback(false);
    setDirections([{ version: 1, text: configure.prompt, status: "pending" }]);
    setPhase("connecting");
    const isCurrent = () => generationRef.current === current;
    try {
      const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });
      const session = fal.realtime.open(wma(DIRECTOR_ENDPOINT), {
        receive: ["video", "audio"],
        negotiationTimeoutMs: 60000,
        onMedia: media => {
          if (!isCurrent()) return;
          // WebRTC may announce audio/video separately. Never replace video with an audio-only stream.
          const mergeTracks = () => {
            if (!isCurrent()) return;
            const combined = receiverRef.current ?? new MediaStream();
            let changed = !receiverRef.current;
            for (const track of media.getTracks()) {
              if (!combined.getTracks().some(existing => existing.id === track.id)) { combined.addTrack(track); changed = true; }
            }
            receiverRef.current = combined;
            if (changed) {
              const next = new MediaStream(combined.getTracks());
              expectedStreamRef.current = next;
              setStream(next);
            }
          };
          if (!sourceStreamsRef.current.has(media)) {
            sourceStreamsRef.current.set(media, mergeTracks);
            media.addEventListener("addtrack", mergeTracks);
          }
          mergeTracks();
        },
        onState: state => {
          if (!isCurrent()) return;
          if (state === "live") setPhase(value => value === "connecting" ? "generating" : value);
          if (state === "failed") fail("视频连接中断了。你的指令已保留，可以重新开拍。 ");
          if (state === "closed") {
            clearWatchdog();
            sessionRef.current = null;
            setPhase(value => value === "error" || value === "idle" ? value : "ended");
            setDirections(previous => previous.map(item => item.status === "pending" ? { ...item, status: "failed" } : item));
          }
        },
        onError: () => { if (isCurrent()) fail("无法建立视频连接。请检查网络、访问权限和 fal 账户额度后重试。 "); },
        onData: raw => {
          if (!isCurrent()) return;
          const message = parseServerMessage(raw);
          if (!message) return;
          setDirections(previous => applyDirectionEvent(previous, message));
          if (message.type === "configured") {
            configuredRef.current = true;
            setPhase(value => value === "connecting" ? "generating" : value);
          }
          if (message.type === "deadline_missed") setNotice("下一段画面正在生成，播放器会暂时停留在当前帧。 ");
          if (message.type === "chunk") setNotice(null);
          if (message.type === "prompt_rejected") setNotice("这条指令未被接受，请调整描述后重试。 ");
          if (message.type === "error") {
            const code = message.code;
            if (!configuredRef.current) {
              fail(code === "content_policy" ? "开场描述未被接受，请修改后重新开拍。 " : code === "invalid_initial_image" ? "首帧图片无法读取，请检查链接后重新开拍。 " : "开场配置未能完成，请检查设置后重试。 ");
              return;
            }
            if (code === "stale_prompt_version" || code === "invalid_message" || code === "content_policy") {
              const version = message.prompt_version;
              setDirections(previous => previous.map(item => item.version === version ? { ...item, status: "rejected" } : item));
              setNotice("这条指令未能生效，请调整描述后重试。 ");
            } else {
              fail(code === "invalid_initial_image" ? "首帧图片无法读取，请检查图片链接后重新开拍。 " : "这一场生成中断了。请稍后重新开拍。 ");
            }
          }
          if (message.type === "stream_exhausted") {
            generationRef.current += 1;
            release();
            setPhase("ended");
            setNotice(message.reason === "session_limit" ? "本次会话已达到服务时限，可以开始新一场。 " : null);
            setDirections(previous => previous.map(item => item.status === "pending" ? { ...item, status: "failed" } : item));
          }
        }
      });
      sessionRef.current = session;
      session.send(configure);
      void session.ready.catch(() => { if (isCurrent()) fail("连接未能完成，请稍后重试。 "); });
      watchdogRef.current = setTimeout(() => { if (isCurrent()) fail("等待首段视频超时了。请检查 fal 服务状态后重新开拍。 "); }, 180000);
    } catch { if (isCurrent()) fail("当前浏览器无法启动实时视频，请使用支持 WebRTC 的现代浏览器。 "); }
  }, [clearWatchdog, fail, release]);

  const sendDirection = useCallback((prompt: string) => {
    const text = validatePrompt(prompt);
    if (!sessionRef.current) throw new Error("会话已结束，请重新开拍。 ");
    const version = ++versionRef.current;
    sessionRef.current.send({ type: "prompt", prompt: text, prompt_version: version });
    setDirections(previous => [...previous, { version, text, status: "pending" }]);
    setNotice(null);
    setError(null);
  }, []);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setPhase("stopping");
    clearWatchdog();
    try { session.send({ type: "stop" }); } catch { /* close also releases the peer */ }
    // Give the control channel time to deliver stop; still close if the server never acknowledges.
    stopTimerRef.current = setTimeout(() => {
      generationRef.current += 1;
      release();
      setPhase("ended");
      setDirections(previous => previous.map(item => item.status === "pending" ? { ...item, status: "failed" } : item));
    }, 1200);
  }, [clearWatchdog, release]);

  const onPlaying = useCallback(() => {
    const video = videoRef.current;
    if (!video || !expectedStreamRef.current || video.srcObject !== expectedStreamRef.current || video.videoWidth === 0 || !receiverRef.current?.getVideoTracks().length) return;
    clearWatchdog();
    setHasFrame(true);
    setNeedsPlayback(false);
    setPhase(value => value === "connecting" || value === "generating" ? "live" : value);
  }, [clearWatchdog]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    release();
    setPhase("idle"); setStream(null); setHasFrame(false); setDirections([]); setError(null); setNotice(null);
    setNeedsPlayback(false); versionRef.current = 0;
  }, [release]);

  return { phase, directions, error, notice, stream, hasFrame, videoRef, needsPlayback, start, sendDirection, stop, onPlaying, reset };
}
