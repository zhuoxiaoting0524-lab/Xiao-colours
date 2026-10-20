import { handleAuthApi } from "./auth-api.js";
import { handleGalleryApi } from "./gallery-api.js";
import { handleJournalApi } from "./journal-api.js";
import { handleNotesApi } from "./notes-api.js";
import { handleDaysApi } from "./days-api.js";
import { createNewsCache } from "./news-cache.js";
import { errorJson, json } from "./http.js";

function normalizeTime(value) {
  return value === "1w" || value === "7d" ? "1w" : "1d";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Personal auth + spaces + journal APIs (D1). Never touch Global Pulse KV here.
    if (url.pathname.startsWith("/api/auth")
      || url.pathname.startsWith("/api/admin")
      || url.pathname.startsWith("/api/me")) {
      try {
        if (url.pathname.startsWith("/api/me/notes")) {
          const notesResponse = await handleNotesApi(request, env);
          if (notesResponse) return notesResponse;
          return errorJson(404, "not_found", "接口不存在");
        }
        if (url.pathname.startsWith("/api/me/days")) {
          const daysResponse = await handleDaysApi(request, env);
          if (daysResponse) return daysResponse;
          return errorJson(404, "not_found", "接口不存在");
        }
        if (url.pathname.startsWith("/api/me/gallery")) {
          const galleryResponse = await handleGalleryApi(request, env);
          if (galleryResponse) return galleryResponse;
          return errorJson(404, "not_found", "接口不存在");
        }
        if (url.pathname.startsWith("/api/me/journal")) {
          const journalResponse = await handleJournalApi(request, env);
          if (journalResponse) return journalResponse;
          return errorJson(404, "not_found", "接口不存在");
        }
        const authResponse = await handleAuthApi(request, env);
        if (authResponse) return authResponse;
        return errorJson(404, "not_found", "接口不存在");
      } catch (error) {
        console.error(JSON.stringify({ event: "api_crash", message: error.message }));
        return errorJson(500, "server_error", "服务器错误");
      }
    }

    // Existing Global Pulse news API (KV) — unchanged contract.
    if (url.pathname === "/api/news/health" || url.pathname === "/api/news") {
      const cache = createNewsCache(env);
      if (url.pathname === "/api/news/health") {
        return json(await cache.getHealth());
      }
      const time = normalizeTime(url.searchParams.get("time"));
      const force = url.searchParams.get("refresh") === "1";
      const result = await cache.getNews(time, { force });
      return json(result.body, result.status);
    }

    if (env.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const cache = createNewsCache(env);
    ctx.waitUntil(cache.refreshAll());
  },
};
