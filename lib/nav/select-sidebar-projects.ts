// F011 (SB-041, SB-042): pure selection helper for the sidebar's
// "Projects" section.
//
// Rules (per the clarified spec):
//   - With >=1 favourite, the section shows up to 5 favourited projects.
//   - With 0 favourites, the section shows up to 5 RECENTLY VISITED
//     projects that are still visible to the caller (recent ids are
//     intersected against `visible`, in recency order).
//   - If neither favourites nor a recognised recent visit exists, the
//     section degrades to the first 5 visible projects rather than
//     rendering a hard empty state — an empty state is reserved for the
//     case where there are truly no visible projects at all (see
//     project-nav-list.tsx's own pre-existing empty state, which this
//     helper doesn't own). This keeps a brand-new session (no
//     `localStorage` history yet) from looking empty even though the
//     caller genuinely has projects.
//
// Kept as a pure function (no React, no localStorage) precisely so it's
// testable against the assertion text alone, independent of how
// project-nav-list.tsx wires it in.
export function selectSidebarProjects<T extends { id: string }>(
  favorites: T[],
  recentIds: string[],
  visible: T[],
  limit = 5,
): T[] {
  if (favorites.length > 0) {
    return favorites.slice(0, limit);
  }

  if (recentIds.length > 0) {
    const byId = new Map(visible.map((project) => [project.id, project]));
    const recentVisible = recentIds
      .map((id) => byId.get(id))
      .filter((project): project is T => Boolean(project));

    if (recentVisible.length > 0) {
      return recentVisible.slice(0, limit);
    }
  }

  return visible.slice(0, limit);
}
