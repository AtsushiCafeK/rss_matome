import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RSS Reader | シンプルで美しいRSSリーダー",
  description: "Apple風のクリーンなデザインでニュースをチェック",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${inter.className} bg-[#FBFBFD] text-[#1D1D1F] antialiased overflow-hidden h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
