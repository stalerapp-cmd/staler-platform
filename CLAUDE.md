# Working on S-Taler / TalerBank

- Standing rule from the owner: whenever a feature is added or changed, update the
  "كيف بتشتغل" guide (`apps/staler-web/src/pages/Help.tsx`) in the same change —
  the right role group (`all`, `merchant`, `exchange`, `admin`), both languages,
  and the `to:` link. No need to be asked.
- Every server error message needs Arabic in both `apps/*/src/lib/serverText.ts`
  (literal strings; the serverText test checks it).
- Hooks never after an early return; `useEffect` bodies are blocks, never expressions.
- Check new screens at phone width (390px) for overflow and the crash text «صار خلل بعرض».
- Calls: TURN credentials come from the call server repo `stalerapp-cmd/server`
  (Vercel, `staler-call-server.vercel.app/api/ice`) through `GET /api/calls/ice`;
  the API needs `ICE_URL` and `ICE_SECRET`.
