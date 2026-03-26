import fetch from "node-fetch";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendAlert(
  message: string,
  level: "info" | "warning" | "critical" = "info",
): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`[alert] ${level.toUpperCase()}: ${message}`);
    return;
  }

  const prefix =
    level === "critical" ? "🚨" : level === "warning" ? "⚠️" : "ℹ️";
  const text = `${prefix} *DeFi LP Engine*\n${message}\n_${new Date().toISOString()}_`;

  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "Markdown",
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch (err) {
    console.error("[alert] Failed to send Telegram alert:", err);
  }
}
