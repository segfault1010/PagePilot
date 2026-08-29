/**
 * Computes a deterministic ISO-8601 week window identifier ('YYYY-Www')
 * for a given date in the specified IANA timezone (defaulting to 'UTC').
 * 
 * Safe against invalid timezone identifiers (falls back gracefully to UTC)
 * and consistent across DST transitions and timezone offsets.
 */
export function getWeeklyWindow(
  date: Date = new Date(),
  timezone: string = "UTC",
): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === "year")?.value || "1970";
    const month = parts.find((p) => p.type === "month")?.value || "01";
    const day = parts.find((p) => p.type === "day")?.value || "01";

    const localDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
    const d = new Date(
      Date.UTC(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth(),
        localDate.getUTCDate(),
      ),
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );

    const paddedWeek = String(weekNo).padStart(2, "0");
    return `${d.getUTCFullYear()}-W${paddedWeek}`;
  } catch {
    if (timezone !== "UTC") {
      return getWeeklyWindow(date, "UTC");
    }
    return "1970-W01";
  }
}
