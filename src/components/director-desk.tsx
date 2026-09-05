"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, Clapperboard, CornerDownLeft, Crosshair, Expand, Film, ImagePlus, KeyRound, LoaderCircle, LockKeyhole, Plus, Radio, Send, Settings2, Square, Volume2, VolumeX, X } from "lucide-react";
import { useDirector, type Phase } from "@/hooks/use-director";
import { MAX_PROMPT_LENGTH, timecode, validateImageUrl, type Resolution } from "@/lib/director-protocol";

const phaseLabels: Record<Phase, string> = { idle: "STANDBY", connecting: "CONNECTING", generating: "GENERATING", live: "LIVE", stopping: "CUTTING", ended: "WRAPPED", error: "OFFLINE" };
const statusLabels = { pending: "等待生效", applied: "已生效", rejected: "未接受", failed: "未完成" };
const shots = [
  { label: "缓慢推进", text: "镜头缓慢向人物推进，保持动作和场景连续。" },
  { label: "跟随人物", text: "镜头平稳跟随人物移动，延续当前场景。" },
  { label: "转为特写", text: "镜头转向人物面部特写，保留当前情绪与光线。" },
  { label: "拉开远景", text: "镜头缓缓拉远，展现人物与周围环境的关系。" }
];
const starters = [
  { title: "雨夜书店", text: "雨夜，一位穿红色外套的女孩推开旧书店的门。暖光洒在湿漉漉的地面上。镜头从她的身后缓慢跟进，电影质感，细腻的光影。" },
  { title: "宇宙来信", text: "一名宇航员独自站在空间站的舷窗前，望着缓缓旋转的蓝色行星。舱内只有仪表的微光，镜头缓慢推进，宁静而辽阔。" },
  { title: "产品试拍", text: "一瓶琥珀色香水放在深色石台上，一束柔和的侧光透过瓶身。镜头缓慢环绕，突出玻璃、液体和石面的质感，高级产品广告风格。" }
];
type AccessState = { configured: boolean; authenticated: boolean };

export function DirectorDesk() {
  const director = useDirector();
  const { phase, directions, error, notice, hasFrame, videoRef, needsPlayback } = director;
  const [draft, setDraft] = useState("");
  const [resolution, setResolution] = useState<Resolution>("768p");
  const [imageUrl, setImageUrl] = useState("");
  const [imageDraft, setImageDraft] = useState("");
  const [imageError, setImageError] = useState("");
  const [access, setAccess] = useState<AccessState | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [accessError, setAccessError] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [muted, setMuted] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const accessDialogRef = useRef<HTMLDialogElement>(null);
  const imageDialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const active = ["connecting", "generating", "live", "stopping"].includes(phase);
  const canDirect = phase === "live" || phase === "generating";
  const busy = phase === "connecting" || phase === "stopping" || submitting;
  const hasVideo = hasFrame;

  const refreshAccess = useCallback(async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) throw new Error("暂时无法检查连接，请稍后重试。 ");
    const next = await response.json() as AccessState;
    setAccess(next);
    return next;
  }, []);

  useEffect(() => { void refreshAccess().catch(() => {}); }, [refreshAccess]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) { textarea.style.height = "auto"; textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`; }
  }, [draft]);

  function setDirection(value: string) {
    setDraft(value);
    setFormError("");
    textareaRef.current?.focus();
  }

  async function submitDirection(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || busy || submittingRef.current) return;
    setFormError("");
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (canDirect) {
        director.sendDirection(draft);
        setDraft("");
      } else {
        const nextAccess = await refreshAccess();
        if (!nextAccess.authenticated) {
          setAccessError("");
          accessDialogRef.current?.showModal();
          return;
        }
        setElapsed(0);
        director.start(draft, resolution, imageUrl || undefined);
        setDraft("");
      }
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "指令未能发送，请重试。 "); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setAccessError(""); setAccessBusy(true);
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: accessCode }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "连接失败，请重试。 ");
      await refreshAccess();
      setAccessCode("");
      accessDialogRef.current?.close();
      textareaRef.current?.focus();
    } catch (cause) { setAccessError(cause instanceof Error ? cause.message : "网络暂时不可用。 "); }
    finally { setAccessBusy(false); }
  }

  async function lock() {
    setAccessError(""); setAccessBusy(true);
    try {
      if (active) director.stop();
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("退出失败，请重试。 ");
      await refreshAccess();
      accessDialogRef.current?.close();
    } catch (cause) { setAccessError(cause instanceof Error ? cause.message : "网络暂时不可用。 "); }
    finally { setAccessBusy(false); }
  }

  function saveImage(event: FormEvent) {
    event.preventDefault();
    try {
      setImageUrl(imageDraft.trim() ? validateImageUrl(imageDraft) : "");
      setImageError(""); imageDialogRef.current?.close();
    } catch (cause) { setImageError(cause instanceof Error ? cause.message : "图片链接无效。 "); }
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (monitorRef.current?.requestFullscreen) await monitorRef.current.requestFullscreen();
      else setFormError("当前浏览器不支持全屏播放。 ");
    } catch { setFormError("暂时无法进入全屏，请重试。 "); }
  }

  function downloadScript() {
    const script = ["H3DIRECTOR / DIRECTOR'S SCRIPT", "", ...directions.flatMap(item => [`DIRECTION ${String(item.version).padStart(2, "0")} · ${statusLabels[item.status]}`, item.text, ""])].join("\n");
    const url = URL.createObjectURL(new Blob([script], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "h3director-script.txt"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="desk-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="H3Director 首页"><span className="brand-mark"><Film size={20} strokeWidth={1.7} /></span><span>H3<span className="brand-light">Director</span><span className="brand-period">.</span></span></a>
        <div className="header-caption">THE DIRECTOR’S DESK<span>实时导演工作台</span></div>
        <button className="access-button" onClick={() => { setAccessError(""); accessDialogRef.current?.showModal(); void refreshAccess().catch(() => setAccessError("暂时无法检查连接。 ")); }}><span className={`status-dot ${access?.authenticated ? "is-ready" : ""}`} />{access?.authenticated ? "工作台已解锁" : "连接工作台"}<Settings2 size={15} /></button>
      </header>

      <main className="workspace">
        <section className="monitor-section" aria-label="导演监视器">
          <div className="section-caption"><span><span className="section-number">01</span> DIRECTOR’S MONITOR</span><span className="caption-right">H3 MAX DIRECTOR <span className="tiny-divider" /> 16:9</span></div>
          <div className="monitor-housing" ref={monitorRef}>
            <div className="monitor-top-rail"><span className="rail-brand">H3D <span>FIELD MONITOR</span></span><span className="rail-tally" data-live={phase === "live"} /><span className="rail-port">HD / A</span></div>
            <div className={`monitor-screen ${hasVideo ? "has-video" : ""}`}>
              <video ref={videoRef} autoPlay playsInline muted={muted} onPlaying={director.onPlaying} onTimeUpdate={event => setElapsed(event.currentTarget.currentTime)} aria-label="H3 Max Director 实时生成画面" />
              <div className="screen-texture" aria-hidden="true" />
              <div className="safe-area" aria-hidden="true"><i /><i /><i /><i /></div>
              <div className="monitor-osd osd-top"><span className={`on-air ${phase === "live" ? "is-live" : ""}`}><span />{phaseLabels[phase]}</span><span>{timecode(elapsed)}</span></div>
              {!hasVideo && <div className="standby-content">
                <div className="standby-crosshair" aria-hidden="true">{active ? <LoaderCircle size={36} strokeWidth={1} className="spin" /> : <Crosshair size={38} strokeWidth={0.8} />}</div>
                <span className="standby-eyebrow">{active ? "SETTING THE SCENE" : phase === "ended" ? "THAT’S A WRAP" : "READY WHEN YOU ARE"}</span>
                <h1>{phase === "connecting" ? "正在连接片场" : phase === "generating" ? "第一幕正在显影" : phase === "stopping" ? "正在收镜" : phase === "ended" ? "这一场，收工。" : phase === "error" ? "片场暂时离线" : "等你的一声 Action。"}</h1>
                <p>{active ? "画面准备好后会自动播放" : phase === "error" ? "指令已保留，可以重新开拍" : "在下方写下场景，让故事开始发生。"}</p>
              </div>}
              {needsPlayback && <button className="play-overlay" onClick={() => { void videoRef.current?.play().catch(() => setFormError("播放被浏览器暂停，请检查媒体播放权限。 ")); }}><Radio size={18} />点击播放画面</button>}
              <div className="monitor-osd osd-bottom"><span>{resolution.toUpperCase()}<span className="osd-divider">/</span>24 FPS</span><span>FRAME 16:9 <span className="frame-icon" /></span></div>
            </div>
            <div className="monitor-controls">
              <div className="monitor-model"><span className={`power-led ${active ? "is-on" : ""}`} /><span>H3 <b>DIRECTOR</b></span></div>
              <div className="control-cluster">
                {active && <button className="cut-button" onClick={director.stop} disabled={phase === "stopping"}><Square size={12} fill="currentColor" />{phase === "connecting" ? "取消连接" : phase === "stopping" ? "收镜中" : "收镜"}</button>}
                <button className="icon-button" title={muted ? "开启声音" : "静音"} aria-label={muted ? "开启声音" : "静音"} aria-pressed={!muted} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
                <span className="control-divider" />
                <button className="icon-button" title="全屏监视器" aria-label="全屏监视器" onClick={() => void fullscreen()}><Expand size={17} /></button>
              </div>
            </div>
          </div>
          <div className="monitor-footnote"><span><span className="square-mark" />{phase === "live" ? "正在播出 · 继续输入，执导下一幕" : phase === "generating" ? "准备画面 · 可继续提交导演指令" : phase === "connecting" ? "建立连接 · 请稍候" : "连续画面，随你的文字展开。"}</span><span>TEXT → MOTION</span></div>
        </section>

        <section className="script-section" aria-label="剧本与导演指令">
          <div className="script-heading"><span><span className="section-number">02</span> THE SCRIPT</span><span className="script-counter">DIRECTION {String(canDirect ? directions.length + 1 : 1).padStart(2, "0")}</span></div>
          {(error || notice || formError) && <div className={`feedback ${error || formError ? "feedback-error" : ""}`} role={error || formError ? "alert" : "status"}>{formError || error || notice}</div>}
          <form className={`script-paper ${busy ? "is-busy" : ""}`} onSubmit={event => void submitDirection(event)}>
            <div className="paper-topline"><span><span className="paper-dot" />{canDirect ? "接下来，发生什么？" : "INT. / EXT. — 你的第一场戏"}</span><span>H3D—{String(canDirect ? directions.length + 1 : 1).padStart(3, "0")}</span></div>
            <label className="sr-only" htmlFor="director-prompt">{canDirect ? "下一条导演指令" : "开场场景描述"}</label>
            <textarea id="director-prompt" ref={textareaRef} value={draft} maxLength={MAX_PROMPT_LENGTH} spellCheck={false} rows={3} placeholder={canDirect ? "镜头再靠近一点。让她注意到那本发光的书……" : "写下地点、人物、动作与光线。\n例如：雨夜，她推开旧书店的门，镜头缓缓跟入……"} onChange={event => { setDraft(event.target.value); setFormError(""); }} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submitDirection(); } }} />
            <div className="paper-toolbar"><div className="paper-options">
              <button type="button" className={`paper-option ${imageUrl ? "has-image" : ""}`} disabled={active} onClick={() => { setImageDraft(imageUrl); setImageError(""); imageDialogRef.current?.showModal(); }}><ImagePlus size={16} /><span>{imageUrl ? "已设首帧" : "首帧图片"}</span>{imageUrl && <Check size={12} />}</button>
              <span className="paper-divider" />
              <label className="resolution-control"><span className="sr-only">视频分辨率</span><select value={resolution} disabled={active} onChange={event => setResolution(event.target.value as Resolution)}><option value="768p">768p</option><option value="480p">480p</option></select><ChevronDown size={12} /></label>
            </div><button className="action-button" type="submit" disabled={!draft.trim() || busy}>{busy ? <LoaderCircle size={15} className="spin" /> : canDirect ? <Send size={15} /> : <span className="action-triangle" />}<span>{submitting ? "检查连接" : phase === "connecting" ? "连接中" : phase === "stopping" ? "收镜中" : canDirect ? "执导下一幕" : "Action"}</span>{!busy && <CornerDownLeft size={13} className="enter-icon" />}</button></div>
          </form>
          <div className="composer-note"><span>用文字掌镜。新指令将在后续画面中生效。</span><span><kbd>⌘ / Ctrl</kbd> + <kbd>Enter</kbd> 发送</span></div>
          <div className="shot-shortcuts"><span className="shortcut-label"><Clapperboard size={14} />镜头指令</span>{shots.map(shot => <button key={shot.label} onClick={() => setDirection(draft.trim() ? `${draft.trim()}\n${shot.text}` : shot.text)}><Plus size={12} />{shot.label}</button>)}</div>

          {directions.length === 0 ? <div className="scene-starters"><span>还没有灵感？从一幕开始</span><div>{starters.map(starter => <button key={starter.title} onClick={() => setDirection(starter.text)}>{starter.title}<ArrowRight size={13} /></button>)}</div></div> : <section className="direction-history" aria-label="本场指令历史"><div className="history-heading"><h2>场记 <span>/ {String(directions.length).padStart(2, "0")} DIRECTIONS</span></h2><div>{!active && <button onClick={() => { director.reset(); setElapsed(0); setDraft(""); textareaRef.current?.focus(); }}><Plus size={14} />新一场</button>}<button onClick={downloadScript}><ArrowDownToLine size={14} />导出剧本</button></div></div><ol>{directions.map(direction => <li key={direction.version}><span className="direction-number">{String(direction.version).padStart(2, "0")}</span><div><div className="direction-meta"><span>{direction.version === 1 ? "开场" : "导演指令"}</span><span className={`direction-status status-${direction.status}`}>{direction.status === "pending" ? <LoaderCircle size={11} className="spin" /> : direction.status === "applied" ? <Check size={11} /> : <Square size={9} />}{statusLabels[direction.status]}</span></div><p>{direction.text}</p>{(direction.status === "rejected" || direction.status === "failed") && <button className="reuse-button" onClick={() => setDirection(direction.text)}>修改后重试 <ArrowRight size={12} /></button>}</div></li>)}</ol></section>}
        </section>
      </main>

      <footer className="site-footer"><span>H3DIRECTOR<span className="footer-slash">/</span>A SPACE FOR YOUR NEXT SCENE.</span><span>Powered by <a href="https://fal.ai/models/minimax/h3-max/director" target="_blank" rel="noreferrer">fal.ai <ArrowRight size={11} /></a></span></footer>

      <dialog className="desk-dialog" ref={accessDialogRef} aria-labelledby="access-title"><button className="dialog-close" aria-label="关闭连接设置" onClick={() => accessDialogRef.current?.close()}><X size={18} /></button><div className="dialog-symbol"><KeyRound size={22} /></div><span className="dialog-eyebrow">BACKSTAGE ACCESS</span><h2 id="access-title">{access?.authenticated ? "工作台已解锁" : "进入你的片场"}</h2>
        {access === null ? <p>正在检查连接…</p> : !access.configured ? <><p>工作台还没有连接视频服务。网站拥有者需要完成部署配置后，才能开始生成。</p><div className="setup-note">在 Vercel 环境变量中设置 <code>FAL_KEY</code> 和至少 16 位的 <code>DIRECTOR_ACCESS_CODE</code>，然后重新部署。详细步骤见项目 README。</div><button className="dialog-primary" onClick={() => { void refreshAccess().catch(() => setAccessError("暂时无法检查连接。 ")); }}>重新检查连接</button></> : access.authenticated ? <><p>你可以开始新一场，或继续用文字指导画面。</p><button className="dialog-primary" onClick={() => accessDialogRef.current?.close()}>返回工作台 <ArrowRight size={16} /></button><button className="dialog-secondary" disabled={accessBusy} onClick={() => void lock()}><LockKeyhole size={14} />{active ? "结束会话并锁定" : "锁定工作台"}</button></> : <form onSubmit={event => void unlock(event)}><p>输入网站拥有者提供的访问码，解锁视频生成。</p><label htmlFor="access-code">工作台访问码</label><input id="access-code" type="password" autoComplete="current-password" value={accessCode} onChange={event => setAccessCode(event.target.value)} placeholder="输入访问码" required maxLength={512} /><button className="dialog-primary" disabled={accessBusy || !accessCode}>{accessBusy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}解锁工作台</button><p className="dialog-fineprint">开拍后将使用网站拥有者的 fal 账户额度。</p></form>}{accessError && <p className="dialog-error" role="alert">{accessError}</p>}
      </dialog>

      <dialog className="desk-dialog" ref={imageDialogRef} aria-labelledby="image-title"><button className="dialog-close" aria-label="关闭首帧设置" onClick={() => imageDialogRef.current?.close()}><X size={18} /></button><div className="dialog-symbol"><ImagePlus size={22} /></div><span className="dialog-eyebrow">THE OPENING FRAME</span><h2 id="image-title">从一张画面开始</h2><form onSubmit={saveImage}><p>提供一张可公开访问的图片作为首帧，再用文字描述接下来发生的事。</p><label htmlFor="image-url">图片链接</label><input id="image-url" type="url" value={imageDraft} onChange={event => setImageDraft(event.target.value)} placeholder="https://…" maxLength={8192} /><p className="dialog-fineprint">建议使用 16:9 图片。链接需能直接打开图片。</p>{imageError && <p className="dialog-error" role="alert">{imageError}</p>}<button className="dialog-primary" type="submit"><Check size={16} />{imageDraft.trim() ? "使用这张首帧" : "仅使用文字开场"}</button>{imageUrl && <button className="dialog-secondary" type="button" onClick={() => { setImageUrl(""); setImageDraft(""); imageDialogRef.current?.close(); }}>移除首帧</button>}</form></dialog>
    </div>
  );
}
