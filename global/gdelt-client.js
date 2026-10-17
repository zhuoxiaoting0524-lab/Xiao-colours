const LAST_REQUEST_KEY = "global-pulse-gdelt-last-request";
const MIN_REQUEST_INTERVAL_MS = 5500;

function abortError() {
  return new DOMException("请求已中止", "AbortError");
}

function wait(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function lastRequestTime() {
  try {
    return Number(localStorage.getItem(LAST_REQUEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markRequestTime() {
  try {
    localStorage.setItem(LAST_REQUEST_KEY, String(Date.now()));
  } catch {
    // The request can continue when storage is unavailable.
  }
}

export async function waitForGdeltSlot(signal) {
  const remaining = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestTime());
  if (remaining > 0) await wait(remaining, signal);
  if (signal?.aborted) throw abortError();
  markRequestTime();
}

export async function fetchGdeltJson(url, signal) {
  await waitForGdeltSlot(signal);
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`GDELT HTTP ${response.status}`);
    error.name = "GdeltResponseError";
    error.status = response.status;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(text.slice(0, 180) || "GDELT 返回了无法解析的数据");
    error.name = "GdeltResponseError";
    throw error;
  }
}
