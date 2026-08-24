// 讓這個站只有一個對外網址。
//
// Cloudflare Pages 綁了自訂網域之後,平台原生的 sdgs-news.pages.dev 仍然照常運作,
// 不會自動轉址(GitHub Pages 會,Cloudflare 不會)。同一份內容掛在兩個網址上,
// 對搜尋引擎是重複內容,對人是混淆。這裡在伺服器端回 301 把它收斂掉。
//
// 為什麼比對完整主機名、而不是用 .pages.dev 結尾:
// 預覽部署的網址長得像 <hash>.sdgs-news.pages.dev。那些要留著能開,
// 否則上線前就沒辦法先看預覽版。所以只轉正式的那一個。
//
// 這支會跑在所有請求前面,包含 functions/api/ 底下的端點。
// 不符合條件就直接放行,不影響既有行為。

const PAGES_HOST = "sdgs-news.pages.dev";
const CANONICAL_HOST = "sdgs.cornhsu.com";

export const onRequest = (context) => {
  const url = new URL(context.request.url);

  if (url.hostname !== PAGES_HOST) return context.next();

  url.protocol = "https:";
  url.hostname = CANONICAL_HOST;
  url.port = "";
  return Response.redirect(url.toString(), 301);
};
