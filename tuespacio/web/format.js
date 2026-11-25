export function formatMoney(minor, profile) {
  if (!Number.isSafeInteger(minor))
    throw new TypeError(
      "El importe debe ser un entero seguro en unidad menor."
    );
  return new Intl.NumberFormat(profile.locale, {
    style: "currency",
    currency: profile.currency,
    minimumFractionDigits: profile.digits,
    maximumFractionDigits: profile.digits,
  }).format(minor / 10 ** profile.digits);
}

export function formatRegionalDate(value, profile, full = true) {
  return new Intl.DateTimeFormat(profile.locale, {
    timeZone: profile.timeZone,
    ...(full
      ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" }),
  }).format(new Date(value));
}
