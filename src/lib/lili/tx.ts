export type Locale = "zh" | "en";

export function tx(locale: Locale, zh: string, en: string) {
  return locale === "en" ? en : zh;
}
