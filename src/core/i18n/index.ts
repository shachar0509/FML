import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import he from "./he.json";
import en from "./en.json";

void i18n.use(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: "he",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
