import {
  getHealthPayload,
  getNewsPayload,
  refreshWindow,
} from "./news-cache.js";

function notFound() {
  return new Response("Not found", { status: 404 });
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

  if (url.pathname === "/api/news") {
    return getNewsPayload(env, url.searchParams.get("time") || "1d", {
      force: url.searchParams.get("refresh") === "1",
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  }
  if (url.pathname === "/api/news/health") return getHealthPayload(env);
  return notFound();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    const run = (async () => {
      const results = [];
      for (const [index, windowName] of ["1d", "1w"].entries()) {
        if (index) await new Promise((resolve) => setTimeout(resolve, 5500));
        try {
          const result = await refreshWindow(env, windowName);
          results.push({ window: windowName, ok: true, count: result.snapshot.validCount });
        } catch (error) {
          results.push({ window: windowName, ok: false, type: error?.name || "Error", status: error?.status || null });
        }
      }
      console.log(JSON.stringify({ event: "scheduled_refresh_complete", cron: controller.cron, scheduledTime: controller.scheduledTime, results }));
      if (results.every((result) => !result.ok)) throw new Error("All scheduled news refreshes failed; previous caches were preserved");
    })();
    ctx.waitUntil(run);
  },
};
