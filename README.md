# H3Director

一个把文字变成连续画面的导演工作台，封装 fal.ai 的 `minimax/h3-max/director` 实时端点。

**Next.js App Router + TypeScript + React，适用于 Vercel。** 固定 16:9 的片场监视器、居中的 Courier 剧本输入区，以及围绕它们展开的导演控制。

## 功能

- 16:9 实时监视器，真实播放时码、状态、静音与全屏。
- 文本开场，可选 HTTPS 图片链接作为首帧。
- 在同一会话内持续发送导演指令，按服务端回执显示待生效、已生效或未接受。
- 480p / 768p 画质；会话开始后锁定画质与首帧。
- 镜头快捷指令、场景起笔、场记历史及 UTF-8 剧本下载。
- 取消连接、收镜、超时处理、断线反馈和会话资源清理。
- 桌面与手机布局，键盘快捷发送（Ctrl / ⌘ + Enter）。
- 服务端 fal 代理与私人访问码，浏览器不接触 `FAL_KEY`。

首帧图片需为公开可读的直接图片链接。本版不包含本地图片上传或视频文件录制；导出按钮下载的是文字剧本。场记只保留在当前页面，刷新页面会清空。

## 本地运行

建议 Node.js 22 LTS 或 24 LTS，npm。

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Windows PowerShell 复制命令：`Copy-Item .env.example .env.local`。

在 `.env.local` 填入：

| 变量 | 必填 | 含义 |
| --- | --- | --- |
| `FAL_KEY` | 是 | [fal API key](https://fal.ai/dashboard/keys)，只在服务端使用 |
| `DIRECTOR_ACCESS_CODE` | 是 | 至少 16 字符的私人工作台访问码，推荐使用随机生成的长字符串 |
| `APP_ORIGIN` | 否 | 固定网站来源，例如 `https://h3director.vercel.app`；默认按当前请求来源校验 |

不要为这两个秘密添加 `NEXT_PUBLIC_` 前缀，不要把 `.env.local` 提交到 GitHub。可运行 `node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"` 生成访问码。

浏览器打开终端显示的本地地址，点击「连接工作台」，输入访问码，然后写下第一幕并点击 Action。未配置变量时仍可浏览完整界面、编写指令和使用镜头快捷按钮；生成入口会显示配置说明。

## 从 GitHub 部署到 Vercel

1. 在 Vercel 的 **Add New → Project** 导入 `dreamofcomic/-`，选择包含本应用的分支。若先合并 PR，可直接使用 `main`。
2. Framework Preset 使用 **Next.js**，Root Directory 使用仓库根目录。保留默认的安装和构建命令（`npm ci` / `npm run build`），不要设置静态导出目录。
3. 在 Vercel 环境变量中设置 `FAL_KEY` 与 `DIRECTOR_ACCESS_CODE`。仅对需要实际生成的部署环境启用；未设置密钥的预览会安全地停留在未配置状态。
4. 点击 Deploy。首次部署不需要 `APP_ORIGIN`；若之后设置固定域名，将它设为实际域名的 origin 并重新部署。Preview 环境不要误用 Production 的固定 origin。
5. 打开部署地址，输入访问码并开拍。确认 fal 账户具备该端点访问权限和足够额度。

环境变量修改后需重新部署。实际视频和音频通过浏览器与 fal 的 WebRTC 连接传输；Vercel Route Handler 只负责认证与短时协商/心跳请求，不承担长连接视频转发。

## 实现与访问控制

```text
Browser                         Next.js / Vercel                  fal
  ├─ private access code ───────→ /api/session
  │  ← HttpOnly signed cookie ──┘
  ├─ WMA negotiation ──────────→ /api/fal/proxy ── server key ──→ wma.fal.run
  └─ video + audio + prompts ═════════ WebRTC ══════════════════→ H3 Max Director
```

- 实时客户端使用官方 `@fal-ai/client@1.11.0-alpha.2`，精确版本与 lockfile 一起提交。服务端使用受限 WMA 代理，额外保留请求取消信号与超时；未使用不转发取消信号的通用代理适配器。
- 代理限定为 WMA 服务和 `minimax/h3-max/director`，禁止普通模型代理、客户端自带 Authorization 和任意目标转发。
- 每个代理请求校验签名 Cookie；写请求还校验同源。Cookie 有效期 12 小时，HttpOnly、SameSite=Strict，生产环境 Secure。
- 访问码用于私人或小团队工作台，没有用户数据库、个人额度或分布式限流。需要面向公众开放时，应先接入正式身份系统、按用户限流与费用配额。可以在 Vercel Firewall 对 `/api/session` 配置登录限流。
- `ready` / `live` 只代表连接协商状态，只有视频 `playing` 事件会让界面进入 LIVE。
- 客户端协商超时 60 秒，服务端协商最多 55 秒，等待首段视频最多 180 秒。收镜会先发送 `stop`，随后关闭 peer；生成排队、暂时停帧、被拒指令均有独立反馈。
- `FAL_KEY` 不写入前端、日志、Git 或公共资源。生成采用网站拥有者的 fal 额度。

## 验证

```sh
npm test
npm run typecheck
npm run build
npm start
```

测试覆盖签名 Cookie 的篡改与到期、同源检查、固定画幅配置、首帧链接校验、指令回执状态，以及 WMA 目标白名单、鉴权头隔离和取消信号。真实生成需要有效 fal 密钥和端点权限，不属于离线单元测试。

## 主要文件

```text
src/components/director-desk.tsx   工作台界面
src/hooks/use-director.ts          实时会话与生命周期
src/lib/director-protocol.ts       H3 消息与校验
src/lib/auth.ts                    私人访问码会话
src/lib/wma-proxy.ts               受限 WMA 转发与请求取消
src/app/api/fal/proxy/route.ts      fal 服务端代理
src/app/api/session/route.ts        解锁、状态与锁定
src/app/theme.css                  共享视觉变量
src/app/globals.css                监视器、剧本与响应式布局
```

参考：[H3 Max Director API](https://fal.ai/models/minimax/h3-max/director/api) · [fal JavaScript SDK](https://github.com/fal-ai/fal-js) · [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)。实时接口目前为 alpha，提示词响应速度、连续性和服务限制取决于模型及部署状态。
