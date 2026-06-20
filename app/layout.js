export const metadata = {
  title: 'SDGs 新聞分析器',
  description: '貼上新聞內容或網址,自動判斷符合哪些聯合國永續發展目標(SDGs)',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
