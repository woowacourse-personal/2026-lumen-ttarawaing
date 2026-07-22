import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const siteTitle = "따라와잉 — 따릉이로 잇는 서울";
const siteDescription =
  "따릉이를 더 편하게. 가까운 대여소부터 반납 대여소와 이동 경로까지 한 번에 알려드려요.";
const socialImagePath = "/og-v2.png";
const socialImageAlt = "따라와잉 — 따릉이를 더 편하게";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";

  return {
    title: siteTitle,
    description: siteDescription,
    metadataBase: new URL(origin),
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
    openGraph: {
      title: siteTitle,
      description: siteDescription,
      type: "website",
      locale: "ko_KR",
      url: origin,
      images: [
        {
          url: `${origin}${socialImagePath}`,
          width: 1200,
          height: 630,
          alt: socialImageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: siteTitle,
      description: siteDescription,
      images: [`${origin}${socialImagePath}`],
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
