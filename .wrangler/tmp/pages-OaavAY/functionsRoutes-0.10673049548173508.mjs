import { onRequestPost as __api_fetch_js_onRequestPost } from "D:\\16+2 VC\\SDGS\\functions\\api\\fetch.js"

export const routes = [
    {
      routePath: "/api/fetch",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_fetch_js_onRequestPost],
    },
  ]