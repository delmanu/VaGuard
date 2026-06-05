import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import es from './es';

function detectLanguage(): string {
  const stored = localStorage.getItem('vaguard_language');
  if (stored === 'en' || stored === 'es') return stored;
  const nav = navigator.language?.toLowerCase() ?? '';
  if (nav.startsWith('es')) return 'es';
  return 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
