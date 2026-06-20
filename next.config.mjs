/** @type {import('next').NextConfig} */
const nextConfig = {
  // 輸出純靜態網站(前端為主架構),產生 out/ 資料夾給 Cloudflare Pages 用。
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
};

export default nextConfig;
