export function parseResetFromText(text, now = new Date()) {
  if (!text || typeof text !== "string") return null;

  const durationMatch = text.match(/resets?\s+in\s+((?:\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s*)+)/i);
  if (durationMatch) {
    const durationText = durationMatch[1];
    const parts = [...durationText.matchAll(/(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/gi)];
    let totalMs = 0;

    for (const [, amountRaw, unitRaw] of parts) {
      const amount = Number(amountRaw);
      const unit = unitRaw.toLowerCase();
      if (!Number.isFinite(amount) || amount < 0) return null;

      if (unit.startsWith("h")) {
        totalMs += amount * 60 * 60 * 1000;
      } else {
        totalMs += amount * 60 * 1000;
      }
    }

    if (totalMs > 0) {
      return {
        reset: new Date(now.getTime() + totalMs),
        timezone: null,
        raw: durationMatch[0].trim()
      };
    }
  }

  const patterns = [
    /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?(?:\s*\(([^)]+)\))?/i,
    /try\s+again\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?(?:\s*\(([^)]+)\))?/i,
    /available\s+(?:again\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?(?:\s*\(([^)]+)\))?/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const [, hourRaw, minuteRaw = "00", meridiemRaw, timezone] = match;
    let hours = Number(hourRaw);
    const minutes = Number(minuteRaw);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (minutes < 0 || minutes > 59) return null;

    const meridiem = meridiemRaw ? meridiemRaw.toLowerCase() : null;
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;

    if (hours < 0 || hours > 23) return null;

    const reset = new Date(now);
    reset.setHours(hours, minutes, 5, 0);

    if (reset.getTime() <= now.getTime()) {
      reset.setDate(reset.getDate() + 1);
    }

    return {
      reset,
      timezone: timezone || null,
      raw: match[0]
    };
  }

  return null;
}

export function looksLikeUsageLimit(text) {
  if (!text || typeof text !== "string") return false;

  return (
    /out of .*usage/i.test(text) ||
    /usage limit/i.test(text) ||
    /rate limit/i.test(text) ||
    /session limit/i.test(text) ||
    /resets?\s+in\s+\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/i.test(text) ||
    /resets?\s+(?:at\s+)?\d{1,2}(?::\d{2})?/i.test(text) ||
    /try\s+again\s+(?:at\s+)?\d{1,2}(?::\d{2})?/i.test(text)
  );
}
