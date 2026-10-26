import { GlobalPulseDataService } from "./data-service.js";

const root = document.querySelector("#gp-reader-root");
const eventId = new URLSearchParams(window.location.search).get("id");

function findOriginalUrl(articles) {
  const article = (articles || []).find((item) => item.eventId === eventId || item.id === eventId);
  return article?.url || article?.relatedSources?.find((source) => source.url)?.url || "";
}

function showFallback(message) {
  root.innerHTML = `
    <div class="gp-empty-state gp-empty-state--compact">
      <p><strong>${message}</strong>该历史链接无法定位原始报道，请返回新闻列表重新选择。</p>
      <a href="../global.html">返回 GLOBAL PULSE</a>
    </div>`;
}

async function redirectToOriginal() {
  if (!eventId) {
    showFallback("缺少新闻标识");
    return;
  }

  const service = new GlobalPulseDataService();
  for (const time of ["1d", "1w"]) {
    try {
      const cached = await service.getInitial(time);
      const cachedUrl = findOriginalUrl(cached?.articles);
      if (cachedUrl) {
        window.location.replace(cachedUrl);
        return;
      }

      const snapshot = await service.load(time, { force: true });
      const liveUrl = findOriginalUrl(snapshot?.articles);
      if (liveUrl) {
        window.location.replace(liveUrl);
        return;
      }
    } catch {
      // Try the wider time range before showing the fallback.
    }
  }

  showFallback("未找到原始报道");
}

redirectToOriginal();
