import i18next, { i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import te from '../locales/te.json';

export type AppLanguage = 'en' | 'te';

/** Each app mode receives its own i18n instance, preventing shared language state. */
export function createAppI18n(initialLanguage: AppLanguage): i18n {
  const instance = i18next.createInstance();
  instance.use(initReactI18next).init({
    compatibilityJSON: 'v4',
    lng: initialLanguage,
    fallbackLng: 'en',
    resources: { en: { translation: en }, te: { translation: te } },
    interpolation: { escapeValue: false },
  });
  return instance;
}
