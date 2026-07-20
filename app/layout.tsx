import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";

  return {
    title: "따라와잉 — 따릉이로 잇는 서울",
    description:
      "출발지부터 따릉이 대여소, 최적의 반납 대여소, 목적지까지 한 번에 안내하는 서울 자전거 경로 서비스",
    metadataBase: new URL(origin),
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
    openGraph: {
      title: "따라와잉 — 따릉이로 잇는 서울",
      description: "걷기와 따릉이를 가장 편한 한 경로로 이어보세요.",
      type: "website",
      locale: "ko_KR",
      url: origin,
      images: [
        {
          url: `${origin}/og.png`,
          width: 1200,
          height: 630,
          alt: "따라와잉 — 걷기와 따릉이를 가장 편한 한 경로로",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "따라와잉 — 따릉이로 잇는 서울",
      description: "걷기와 따릉이를 가장 편한 한 경로로 이어보세요.",
      images: [`${origin}/og.png`],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7faf7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
