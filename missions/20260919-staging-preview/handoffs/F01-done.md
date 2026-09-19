# F01 handoff
**Status:** COMPLETE
**Assertions covered:** SP-001, SP-002, SP-003, SP-004
**Files changed:** lib/queries/project-site.ts
**Notes:** Added `StagingLinkKind` type export, `getProjectStagingLinks`, and `getClientVisibleStagingLinks` after `getClientVisiblePortalAccounts`. Both use `.in("kind", ["staging", "live"])` + `.order("position")` + `mapLinkRow`. Client-visible variant adds `.eq("client_visible", true)`. Header comment explains double-guard rationale and why 'live' is grouped with 'staging'. `tsc --noEmit` and `npm run lint` both pass clean. No migration changes.
