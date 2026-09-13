// F016 (AS-017): favourites' own fetch, isolated into its own file per
// this feature's file list. Unlike the other figures in this directory,
// this one is NOT deferred behind its own `<Suspense>` boundary in the
// layout: `getFavoriteProjectIds`'s result is merged into the `projects`
// array (`isFavorite` per project) *before* that array is handed to
// `<ProjectNavList>`'s `onNavigate` callback (owned by the client-side
// `SidebarContent`, for closing the mobile nav sheet on click) -- since
// that callback only exists client-side, the merged project list cannot
// be produced by a server-rendered slot without either losing the
// mobile-sheet-close behaviour (a real behaviour change, forbidden by
// AS-025) or duplicating `<ProjectNavList>`'s render logic here. The
// favourites section IS also arguably "required to render the
// navigation" (AS-017's own carve-out: the Projects section is part of
// the primary nav), so leaving it out of a Suspense boundary does not
// violate AS-017's wording either way. This function is still called by
// the layout exactly as it always was -- only its "own file" location is
// new.
export { getFavoriteProjectIds } from "@/lib/queries/projects";
