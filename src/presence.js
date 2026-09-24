const VISITOR_ID_KEY = "thumb-guessr-visitor-id";
const HEARTBEAT_THROTTLE_MS = 15_000;
const COUNT_REFRESH_MS = 30_000;
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createVisitorId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getVisitorId() {
  try {
    const stored = localStorage.getItem(VISITOR_ID_KEY);
    if (stored && VISITOR_ID_PATTERN.test(stored)) return stored;
    const visitorId = createVisitorId();
    localStorage.setItem(VISITOR_ID_KEY, visitorId);
    return visitorId;
  } catch {
    return createVisitorId();
  }
}

export function setupFestivalPresence(countElement) {
  if (!countElement) return;
  const visitorId = getVisitorId();
  let lastHeartbeatAt = 0;
  let heartbeatPending = false;

  function updateCount(payload) {
    const count = Number(payload?.displayCount);
    if (Number.isFinite(count) && count >= 0) {
      const displayCount = Math.round(count);
      countElement.textContent = String(displayCount);
      countElement.setAttribute("aria-label", `当前 ${displayCount} 位嫦娥共度中秋`);
    }
  }

  async function refreshCount() {
    try {
      const response = await fetch("/api/presence", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      updateCount(await response.json());
    } catch {
      // 统计故障不影响游戏，保留当前展示值。
    }
  }

  async function sendHeartbeat(force = false) {
    const now = Date.now();
    if (heartbeatPending || (!force && now - lastHeartbeatAt < HEARTBEAT_THROTTLE_MS)) return;
    heartbeatPending = true;
    lastHeartbeatAt = now;
    try {
      const response = await fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ visitorId }),
        keepalive: true
      });
      if (!response.ok) return;
      updateCount(await response.json());
    } catch {
      // 埋点失败不阻塞主流程。
    } finally {
      heartbeatPending = false;
    }
  }

  const markActive = () => sendHeartbeat(false);
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive, { passive: true });
  window.addEventListener("scroll", markActive, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sendHeartbeat(false);
  });

  sendHeartbeat(true);
  window.setInterval(refreshCount, COUNT_REFRESH_MS);
}
