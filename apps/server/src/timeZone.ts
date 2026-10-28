// "Glofly's day": GLOFLY_TIME_ZONE (US Central by default). A leaf module (no imports from the rest
// of the server), so anything can use it without making an import cycle.

export const TIME_ZONE = (() => {
  const tz = process.env.GLOFLY_TIME_ZONE?.trim() || "America/Chicago";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    console.warn(`GLOFLY_TIME_ZONE "${tz}" isn't a time zone; using America/Chicago.`);
    return "America/Chicago";
  }
})();
