# Internationalization maintenance

The desktop supports Follow system, Simplified Chinese and English. Explicit choices persist locally; system mode resolves the preferred system language at startup and when the app receives focus.

## Resource design

- UI message keys and complete templates: `src/shared/locales/zh-CN.json` and `en.json`.
- Language registration: `src/shared/locales/languages.json`.
- Stable error codes map to localized display text; saved history and remote output remain unchanged.
- Add matching keys and interpolation variables to each resource whenever changing a user-facing feature.
- Do not translate credentials, user content, protocol identifiers, command source or server output.

## Acceptance

Run `npm run check` for resource completeness and `npm run test:i18n-native` for isolated macOS switching, tray labels, minimum-size English settings/forms and restart persistence. Inspect populated lists as well as empty states; long labels must wrap or stay within independently scrolling tables.

Windows physical GUI validation remains a next-release task. Screenshot fixtures must use synthetic data.
