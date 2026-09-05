import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "H3Director — 导演工作台",
  description: "用文字执导下一幕。基于 H3 Max Director 的实时视频创作工作台。",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
