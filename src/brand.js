// Store builds (Microsoft Store, Mac App Store) ship as "Retrogram" without the ICQ
// trademark. scripts/build-store.js sets REACT_APP_STORE=1 for the renderer build; the
// regular builds (portable, setup, DMG, Linux) keep the ICQ naming unchanged.
export const STORE_BUILD = process.env.REACT_APP_STORE === '1';

export const APP_TITLE = STORE_BUILD ? 'Retrogram' : 'ICQ Messenger';
export const GAMES_LABEL = STORE_BUILD ? 'Spiele' : 'ICQ Spiele';

// "ICQ Classic (Green)" -> "Classic (Green)" in store builds.
export const skinLabel = (name) => (STORE_BUILD ? String(name).replace(/^ICQ\s+/, '') : name);
