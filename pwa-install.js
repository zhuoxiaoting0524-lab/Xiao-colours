let deferredInstallPrompt = null;

const $ = (selector) => document.querySelector(selector);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function platformGuide() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMacSafari = /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  if (isIOS) return {
    title: "在 iPhone 或 iPad 上安装",
    steps: ["请使用 Safari 打开 XiaoColour。", "点击底部或顶部的“分享”按钮。", "选择“添加到主屏幕”，再点击“添加”。"]
  };
  if (isMacSafari) return {
    title: "在 Mac 上添加到 Dock",
    steps: ["请使用 Safari 打开 XiaoColour。", "在菜单栏选择“文件”。", "选择“添加到程序坞”，确认名称为 XiaoColour。"]
  };
  return {
    title: "安装 XiaoColour",
    steps: ["打开浏览器菜单。", "选择“安装 XiaoColour”“安装应用”或“创建快捷方式”。", "确认以独立窗口打开。"]
  };
}

function renderInstallState(message = "") {
  const button = $("#settings-install-pwa");
  const status = $("#pwa-install-status");
  if (!button) return;
  if (isStandalone()) {
    button.textContent = "✓ 已安装";
    button.disabled = true;
    if (status) status.textContent = "XiaoColour 正在以独立应用模式运行。";
    return;
  }
  button.disabled = false;
  button.textContent = deferredInstallPrompt ? "安装 XiaoColour" : "查看安装步骤";
  if (status) status.textContent = message || (deferredInstallPrompt ? "当前浏览器支持直接安装。" : "将根据你的设备显示正确安装方法。");
}

function showInstructions() {
  const guide = platformGuide();
  $("#pwa-guide-title").textContent = guide.title;
  const list = $("#pwa-guide-steps");
  list.replaceChildren(...guide.steps.map((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    return item;
  }));
  $("#pwa-install-dialog").showModal();
}

async function installPwa() {
  if (isStandalone()) return;
  if (!deferredInstallPrompt) {
    showInstructions();
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  renderInstallState(choice.outcome === "accepted" ? "安装请求已确认。" : "安装已取消，你可以稍后重试。");
}

function updateNetworkState() {
  const banner = $("#pwa-network-status");
  if (!banner) return;
  banner.hidden = navigator.onLine;
  banner.textContent = navigator.onLine ? "" : "当前离线：私人数据不会被缓存，恢复网络后可继续使用。";
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  renderInstallState();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  renderInstallState("XiaoColour 已成功安装。可从主屏幕、Dock 或开始菜单打开。");
});
window.addEventListener("online", updateNetworkState);
window.addEventListener("offline", updateNetworkState);

document.addEventListener("DOMContentLoaded", () => {
  $("#settings-install-pwa")?.addEventListener("click", installPwa);
  renderInstallState();
  updateNetworkState();
  const secureContext = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if ("serviceWorker" in navigator && secureContext) {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error) => {
        console.error("XiaoColour service worker registration failed", error);
        renderInstallState("安装服务暂时不可用，请刷新后重试。");
      });
  }
});
