// src/i18n.ts  (driver app i18n, static, no Firebase)
import { ref } from "vue";

export type Lang = "tr" | "en";

const STORAGE_KEY = "kpt_driver_lang";

const DICT = {
  // Brand / header
  "brand.name": { tr: "KayseriPark AVM Taksi", en: "KayseriPark AVM Taksi" },
  "brand.driver": { tr: "Sürücü", en: "Driver" },

  // Language
  "lang.tr": { tr: "TR", en: "TR" },
  "lang.en": { tr: "EN", en: "EN" },

  // Login
  "login.plate": { tr: "Plaka (örn: 38 ABC 123)", en: "Plate (e.g., 38 ABC 123)" },
  "login.pass": { tr: "Şifre", en: "Password" },
  "login.btn": { tr: "Giriş", en: "Login" },
  "login.err.plate": { tr: "Plaka gerekli", en: "Plate required" },
  "login.err.pass": { tr: "Şifre gerekli", en: "Password required" },

  // Session / account
  "session.uid": { tr: "uid", en: "uid" },
  "session.logout": { tr: "Çıkış", en: "Logout" },
  "session.plateKey": { tr: "plateKey", en: "plateKey" },

  // Status
  "status.title": { tr: "Durum", en: "Status" },
  "status.available": { tr: "Müsait", en: "Available" },
  "status.busy": { tr: "Meşgul", en: "Busy" },
  "status.offline": { tr: "Çevrimdışı", en: "Offline" },
  "status.update": { tr: "Durumu güncelle", en: "Update status" },
  "status.updating": { tr: "Güncelleniyor…", en: "Updating…" },
  "status.server": { tr: "sunucu", en: "server" },
  "status.selected": { tr: "seçili", en: "selected" },
  "status.last": { tr: "son", en: "last" },
  "status.updated": { tr: "Durum güncellendi.", en: "Status updated." },

  // GPS
  "gps.title": { tr: "GPS", en: "GPS" },
  "gps.start": { tr: "GPS Başlat", en: "Start GPS" },
  "gps.stop": { tr: "GPS Durdur", en: "Stop GPS" },
  "gps.last": { tr: "son", en: "last" },
  "gps.noSupport": { tr: "Konum (Geolocation) desteklenmiyor", en: "Geolocation not supported" },
  "gps.sendFail": { tr: "GPS gönderimi başarısız", en: "GPS send failed" },

  // Bookings
  "bookings.title": { tr: "Rezervasyonlar (bu araç)", en: "Bookings (this vehicle)" },
  "bookings.none": { tr: "Rezervasyon yok.", en: "No bookings." },
  "bookings.accept": { tr: "Kabul", en: "Accept" },
  "bookings.reject": { tr: "Reddet", en: "Reject" },

  // Common
  "common.pending": { tr: "beklemede", en: "pending" },
  "common.accepted": { tr: "kabul", en: "accepted" },
  "common.rejected": { tr: "reddedildi", en: "rejected" },
  "common.km": { tr: "km", en: "km" },
  "common.try": { tr: "TRY", en: "TRY" },
} as const;

export type I18nKey = keyof typeof DICT;

function fmt(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

function detectInitialLang(): Lang {
  const qp = new URL(window.location.href).searchParams.get("lang");
  if (qp === "tr" || qp === "en") return qp;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "tr" || stored === "en") return stored;

  const nav = (navigator.language || "").toLowerCase();
  return nav.startsWith("tr") ? "tr" : "en";
}

const lang = ref<Lang>(detectInitialLang());

export function useI18n() {
  const setLang = (l: Lang) => {
    lang.value = l;
    localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
  };

  const t = (key: I18nKey, vars?: Record<string, string | number>) => {
    const row = DICT[key];
    const raw = row?.[lang.value] ?? row?.en ?? String(key);
    return fmt(raw, vars);
  };

  return { lang, setLang, t };
}
