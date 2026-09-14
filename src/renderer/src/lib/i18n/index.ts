import { SUPPORTED_LANGUAGES } from '@shared/settings'

/**
 * A minimal translation layer.
 *
 * The app is written in English and stays readable without this module: every
 * call site passes the English string as the fallback, so a missing key renders
 * the same text a plain literal would. That keeps translation an additive
 * change — new strings appear untranslated rather than as `page.home.title` —
 * and it means the dictionary can grow one page at a time.
 *
 * To translate: add a `Dictionary` entry for a language in `dictionaries`. Keys
 * are dotted paths grouped by page. Only keys that differ from English need to
 * be present.
 */

type Dictionary = Record<string, string>

const en: Dictionary = {
  'nav.home': 'Home',
  'nav.accounts': 'Accounts',
  'nav.servers': 'Servers',
  'nav.appearance': 'Appearance',
  'nav.behaviour': 'Behaviour',
  'nav.fastflags': 'FastFlags',
  'nav.mods': 'Mods',
  'nav.integrations': 'Integrations',
  'nav.utilities': 'Utilities',
  'nav.installation': 'Installation',
  'nav.about': 'About',

  'action.play': 'Play',
  'action.cancel': 'Cancel',
  'action.save': 'Save',
  'action.remove': 'Remove',
  'action.refresh': 'Refresh',
  'action.close': 'Close',

  'home.idle.title': 'Nothing is running',
  'home.idle.body': 'Press Play and RemielleStrap takes it from here.',
  'home.inGame.title': 'Playing now',

  'onboarding.welcome.title': 'Welcome to RemielleStrap',
  'onboarding.welcome.body':
    'A bootstrapper for Roblox in Remielle’s colours: mods, FastFlags, accounts, regions and Discord presence, all in one quiet place.',
  'onboarding.accounts.title': 'Sign in once',
  'onboarding.accounts.body':
    'Add an account with a real sign-in window, a Quick Log In code from your phone, or a pasted cookie. Cookies are sealed with your OS credential store and never stored in the clear.',
  'onboarding.art.title': 'Dress it up — or not',
  'onboarding.art.body':
    'Every art slot can show Remielle artwork from Safebooru or Danbooru, a picture of your own, or nothing at all. Shuffle a slot at any time; the choice is remembered per slot.',
  'onboarding.launch.title': 'Ready to launch',
  'onboarding.launch.body':
    'Press Play on the Home page. Mods and flags are applied on the way in, and the Cleaner keeps the folders from piling up.'
}

/**
 * Translating into a language is a matter of adding it here; untranslated keys
 * fall back to the English text passed by the caller.
 */
const dictionaries: Record<string, Dictionary> = {
  en
}

let language = 'en'

export function setLanguage(value: string): void {
  language = Object.prototype.hasOwnProperty.call(dictionaries, value) ? value : 'en'
}

export function currentLanguage(): string {
  return language
}

/** Language options for the settings page, marking which ones have a dictionary. */
export function languageOptions(): { value: string; label: string }[] {
  return SUPPORTED_LANGUAGES.map((entry) => ({
    value: entry.value,
    label: Object.prototype.hasOwnProperty.call(dictionaries, entry.value)
      ? entry.label
      : `${entry.label} (English)`
  }))
}

/**
 * Looks a key up, falling back to English and then to the caller's text.
 *
 * `t('home.idle.title', 'Nothing is running')` always renders something
 * sensible, whether the language is supported or the key exists.
 */
export function t(key: string, fallback: string): string {
  const dictionary = dictionaries[language]
  return dictionary?.[key] ?? en[key] ?? fallback
}
