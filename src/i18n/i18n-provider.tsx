import { useEffect, type ReactNode } from "react";
import { useAppStore } from "@/store";
import { I18nContext, TRANSLATIONS } from "./index";

export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);

  const isRTL = language === "ar";

  useEffect(() => {
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
    document.documentElement.lang = language;
  }, [language, isRTL]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    // Turkish case safety: keys are matched exactly as literal strings,
    // avoiding toLowerCase/toUpperCase transformations to prevent Turkish dotted/dotless i casing traps.
    const langTranslations = TRANSLATIONS[language] || TRANSLATIONS["en"];
    const template =
      langTranslations[key] || TRANSLATIONS["en"][key] || String(key);
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      String(params[name] ?? `{${name}}`),
    );
  };

  return (
    <I18nContext.Provider value={{ t, language, setLanguage, isRTL }}>
      {children}
    </I18nContext.Provider>
  );
}
