# F03 — probe unit tests

**Status:** [CLARIFIED] · **Estimate:** 30 min · **Depends on:** F02
**Assertions:** SP-050, SP-051

## Task

`app/api/site-preview/probe/route.test.ts` (vitest, po obrascu postojećih
`*.test.ts` u repo-u — proveri `vitest.config.ts` za include glob).

## Tabela za `readFramingPolicy` (SP-050)

| header | vrednost | očekivano |
|---|---|---|
| `x-frame-options` | `DENY` | false |
| `x-frame-options` | `sameorigin` | false |
| `x-frame-options` | `  SAMEORIGIN ` | false (trim + case) |
| `content-security-policy` | `frame-ancestors 'none'` | false |
| `content-security-policy` | `frame-ancestors https://other.com` | false |
| `content-security-policy` | `frame-ancestors *` | true |
| `content-security-policy` | `frame-ancestors https://self.test` | true (= selfOrigin) |
| `content-security-policy` | `default-src 'self'` | true (nema frame-ancestors) |
| — | nijedan | true |

## Tabela za `isBlockedAddress` (SP-051)

Blokirani: `127.0.0.1`, `127.1.2.3`, `10.0.0.1`, `172.16.0.1`, `172.31.255.255`,
`192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `::1`, `fc00::1`, `fe80::1`.
Dozvoljeni: `1.1.1.1`, `172.32.0.1`, `192.169.0.1`, `2606:4700::1111`.

`172.32.0.1` i `192.169.0.1` su tu namerno — off-by-one na granici opsega je
najčešća greška u ručno pisanom CIDR checku.

## Definition of done

- [ ] `npx vitest run app/api/site-preview` zeleno.
- [ ] Svaki red obe tabele je zaseban `it.each` case, ne jedan blob.
- [ ] Commit pre izlaska.
