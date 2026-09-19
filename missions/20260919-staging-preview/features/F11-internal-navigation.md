# F11 — interna navigacija u proxy modu

**Status:** [CLARIFIED] · **Estimate:** 35 min · **Depends on:** F04, F09
**Assertions:** SP-070 … SP-074

## Zašto

U `srcdoc` modu iframe nema pravi origin, pa klik na `href="/kontakt"`
navigira frejm na `https://sajt.webflow.io/kontakt` — što onda udari u CSP i
pukne. Moden ovo rešava presretanjem klika i re-fetch-om kroz proxy
(`setupIframeLinkHandler` u njihovom kodu). Radimo isto.

## Implementacija

Pošto je frejm sandbox-ovan bez `allow-same-origin`, **ne možemo** da
pristupimo `iframe.contentDocument` iz parent-a. Zato interceptor mora da
bude **injektovan u HTML** koji proxy vraća, i da komunicira preko
`postMessage`.

### Deo 1 — injekcija u F09 proxy (dopuni F09 rutu)

Odmah pre `</body>`, injektuj malu skriptu:

```html
<script>
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a');
  if (!a) return;
  var href = a.getAttribute('href');
  if (!href) return;
  if (href.charAt(0) === '#') return;                      /* SP-072 */
  if (href.slice(0, 11).toLowerCase() === 'javascript:') return;  /* SP-072 */
  var abs;
  try { abs = new URL(href, document.baseURI).href; } catch (err) { return; }
  e.preventDefault();
  parent.postMessage({ __sitePreviewNav: abs }, '*');
}, true);
</script>
```

`'*'` kao targetOrigin je neophodan — frejm je u opaque origin-u i ne zna
naš. Parent strana **mora** da validira poruku (vidi deo 2).

Napiši ovo kao izvoznu konstantu `NAV_INTERCEPTOR_SCRIPT` u
`lib/site-preview/guards.ts` (ili novom `lib/site-preview/inject.ts`), tako
da F12 može da testira injekciju.

### Deo 2 — listener u `SitePreviewFrame`

```ts
useEffect(() => {
  function onMessage(e: MessageEvent) {
    // Frejm je u opaque origin-u, pa e.origin je "null" — ne možemo da
    // proverimo origin. Zato proveravamo da poruka dolazi iz NAŠEG frejma
    // (e.source === iframeRef.current?.contentWindow) i da payload ima
    // tačno očekivan oblik. Bez te dve provere bi bilo koji tab mogao da
    // nam pošalje navigaciju.
    if (e.source !== iframeRef.current?.contentWindow) return;
    const next = e.data?.__sitePreviewNav;
    if (typeof next !== "string") return;
    handleNavigate(next);
  }
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}, []);
```

### `handleNavigate(next: string)`

```
1. Parsiraj next. Neparsiv → ignoriši.
2. Host !== host trenutnog URL-a  →  window.open(next, "_blank",
     "noopener,noreferrer")  i NE menjaj frejm.            (SP-071)
3. Isti host  →  push trenutni URL na history stack,
     setCurrentUrl(next), re-fetch proxy, zameni srcdoc.   (SP-070)
```

## Toolbar dopune

- **Back dugme (SP-073):** vidljivo uvek kad je `srcdoc` mod. `disabled` kad
  je `history.length === 0` — disabled, ne skriveno. Klik: pop sa stack-a,
  navigiraj tamo bez push-a.
- **Path (SP-074):** prikaži `new URL(currentUrl).pathname` pored hostname-a,
  mono font. Root je `/`, ne prazno.

Hostname ostaje URL originalnog linka; path se menja s navigacijom. Tako
klijent uvek vidi i koji sajt i gde je u njemu.

## "Open in new tab" i reload posle navigacije

Oba moraju da koriste `currentUrl`, ne originalni `link.url` — ako je klijent
otišao na `/kontakt`, "otvori u novom tabu" vodi tamo, ne na root.

## Definition of done

- [ ] Interceptor skripta injektovana u proxy HTML, kao izvozna konstanta.
- [ ] `e.source` provera prisutna — komentar objašnjava zašto `e.origin` ne
      može da se koristi.
- [ ] Interni link ostaje u frejmu; eksterni ide u novi tab sa `noopener`.
- [ ] `#anchor` i `javascript:` se ne presreću.
- [ ] Back dugme disabled na dubini 0.
- [ ] Path u toolbar-u, mono.
- [ ] `npx tsc --noEmit`, `npm run lint` čisti.
- [ ] Commit pre izlaska.
