import { BoardEmptyState } from "@/components/board/board-empty-state";

// F030 placeholder, specialized by F032 (AS-041): the real Board view
// (drag-and-drop task columns) lands in F042+, and tasks themselves don't
// exist until F035+. Until then, every project has exactly zero tasks, so
// this page always renders the board's empty state — via the reusable
// `BoardEmptyState` component that F042 will compose into the real board
// once it fetches actual task data, rather than duplicating this markup.
export default function ProjectBoardPage() {
  return <BoardEmptyState />;
}
