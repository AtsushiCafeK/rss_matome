import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // デプロイ用: 必要なファイルだけを .next/standalone にまとめる
  // (node_modules 全体をサーバーへアップせずに済む)
  output: "standalone",
};

export default nextConfig;
