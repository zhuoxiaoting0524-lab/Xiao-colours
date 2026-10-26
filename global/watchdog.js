(function () {
  "use strict";

  var booted = false;
  var timer = window.setTimeout(showBootFailure, 8000);

  window.addEventListener("global-pulse:booted", function () {
    booted = true;
    window.clearTimeout(timer);
  }, { once: true });

  function showBootFailure() {
    if (booted) return;

    var status = document.querySelector("#gp-status-text");
    var dot = document.querySelector("#gp-status-dot");
    var health = document.querySelector("#gp-health-summary");
    var topStories = document.querySelector("#gp-top-stories");
    var feedState = document.querySelector("#gp-feed-state");
    var refresh = document.querySelector("#gp-refresh-button");

    if (status) status.textContent = "页面模块未能启动，请重新加载";
    if (dot) dot.className = "gp-live-dot is-error";
    if (health) health.textContent = "前端模块加载失败 · 新闻服务器可能仍然正常";
    if (feedState) {
      feedState.hidden = false;
      feedState.textContent = "GLOBAL PULSE 页面脚本未能完成启动。请点击“重新加载页面”；如果问题持续存在，请稍后再试。";
    }
    if (topStories) {
      topStories.dataset.count = "0";
      topStories.innerHTML = '<div class="gp-empty-state gp-empty-state--compact"><p><strong>页面加载失败</strong>新闻数据没有被删除。请重新加载页面以恢复显示。</p></div>';
    }
    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = "重新加载页面";
      refresh.addEventListener("click", function () {
        if (!booted) window.location.reload();
      });
    }
  }
}());
