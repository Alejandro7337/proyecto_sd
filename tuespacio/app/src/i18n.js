// Idiomas de la interfaz (del mockup). Se traduce la navegación, el perfil y la configuración;
// el contenido operativo del prototipo sigue en español (mercado inicial: Colombia).
export const LANGUAGES = [
  { value: 'es', native: 'Español' },
  { value: 'en', native: 'English' },
  { value: 'pt', native: 'Português' },
  { value: 'it', native: 'Italiano' },
  { value: 'de', native: 'Deutsch' },
  { value: 'fr', native: 'Français' },
  { value: 'ja', native: '日本語' },
];

const copy = {
  es: {
    home: 'Encuentra tu cupo', profile: 'Perfil', settings: 'Configuración', language: 'Idioma', appearance: 'Apariencia',
    notifications: 'Notificaciones', help: 'Ayuda y soporte', account: 'Cuenta', light: 'Modo claro', dark: 'Modo oscuro',
    signIn: 'Iniciar sesión', signOut: 'Cerrar sesión', preferences: 'Preferencias', theme: 'Tema de la aplicación',
    personalize: 'Personaliza tu experiencia en Tu Espacio.', version: 'Tu Espacio · Versión',
    tabExplore: 'Inicio', tabReservations: 'Reservas', tabProfile: 'Perfil', tabSummary: 'Resumen', tabLot: 'Mi parqueadero',
    tabSpaces: 'Mis espacios', tabEarnings: 'Ingresos',
  },
  en: {
    home: 'Find your spot', profile: 'Profile', settings: 'Settings', language: 'Language', appearance: 'Appearance',
    notifications: 'Notifications', help: 'Help & support', account: 'Account', light: 'Light mode', dark: 'Dark mode',
    signIn: 'Sign in', signOut: 'Sign out', preferences: 'Preferences', theme: 'App theme',
    personalize: 'Personalize your Tu Espacio experience.', version: 'Tu Espacio · Version',
    tabExplore: 'Home', tabReservations: 'Bookings', tabProfile: 'Profile', tabSummary: 'Overview', tabLot: 'My lot',
    tabSpaces: 'My spaces', tabEarnings: 'Earnings',
  },
  pt: {
    home: 'Encontre sua vaga', profile: 'Perfil', settings: 'Configurações', language: 'Idioma', appearance: 'Aparência',
    notifications: 'Notificações', help: 'Ajuda e suporte', account: 'Conta', light: 'Modo claro', dark: 'Modo escuro',
    signIn: 'Entrar', signOut: 'Sair', preferences: 'Preferências', theme: 'Tema do aplicativo',
    personalize: 'Personalize sua experiência no Tu Espacio.', version: 'Tu Espacio · Versão',
    tabExplore: 'Início', tabReservations: 'Reservas', tabProfile: 'Perfil', tabSummary: 'Resumo', tabLot: 'Meu estacionamento',
    tabSpaces: 'Meus espaços', tabEarnings: 'Ganhos',
  },
  it: {
    home: 'Trova il tuo posto', profile: 'Profilo', settings: 'Impostazioni', language: 'Lingua', appearance: 'Aspetto',
    notifications: 'Notifiche', help: 'Aiuto e supporto', account: 'Account', light: 'Modalità chiara', dark: 'Modalità scura',
    signIn: 'Accedi', signOut: 'Esci', preferences: 'Preferenze', theme: "Tema dell'app",
    personalize: 'Personalizza la tua esperienza su Tu Espacio.', version: 'Tu Espacio · Versione',
    tabExplore: 'Home', tabReservations: 'Prenotazioni', tabProfile: 'Profilo', tabSummary: 'Riepilogo', tabLot: 'Il mio parcheggio',
    tabSpaces: 'I miei spazi', tabEarnings: 'Guadagni',
  },
  de: {
    home: 'Finde deinen Stellplatz', profile: 'Profil', settings: 'Einstellungen', language: 'Sprache', appearance: 'Darstellung',
    notifications: 'Benachrichtigungen', help: 'Hilfe & Support', account: 'Konto', light: 'Heller Modus', dark: 'Dunkler Modus',
    signIn: 'Anmelden', signOut: 'Abmelden', preferences: 'Präferenzen', theme: 'App-Design',
    personalize: 'Passe Tu Espacio an dich an.', version: 'Tu Espacio · Version',
    tabExplore: 'Start', tabReservations: 'Buchungen', tabProfile: 'Profil', tabSummary: 'Übersicht', tabLot: 'Mein Parkplatz',
    tabSpaces: 'Meine Plätze', tabEarnings: 'Einnahmen',
  },
  fr: {
    home: 'Trouvez votre place', profile: 'Profil', settings: 'Réglages', language: 'Langue', appearance: 'Apparence',
    notifications: 'Notifications', help: 'Aide et support', account: 'Compte', light: 'Mode clair', dark: 'Mode sombre',
    signIn: 'Se connecter', signOut: 'Se déconnecter', preferences: 'Préférences', theme: "Thème de l'application",
    personalize: 'Personnalisez votre expérience Tu Espacio.', version: 'Tu Espacio · Version',
    tabExplore: 'Accueil', tabReservations: 'Réservations', tabProfile: 'Profil', tabSummary: 'Résumé', tabLot: 'Mon parking',
    tabSpaces: 'Mes espaces', tabEarnings: 'Revenus',
  },
  ja: {
    home: '駐車スペースを探す', profile: 'プロフィール', settings: '設定', language: '言語', appearance: '外観',
    notifications: '通知', help: 'ヘルプとサポート', account: 'アカウント', light: 'ライトモード', dark: 'ダークモード',
    signIn: 'ログイン', signOut: 'ログアウト', preferences: '設定項目', theme: 'アプリのテーマ',
    personalize: 'Tu Espacio を自分好みに。', version: 'Tu Espacio · バージョン',
    tabExplore: 'ホーム', tabReservations: '予約', tabProfile: 'プロフィール', tabSummary: '概要', tabLot: '駐車場',
    tabSpaces: 'マイスペース', tabEarnings: '収益',
  },
};

export const translations = copy;
export const translate = (language) => copy[language] || copy.es;
