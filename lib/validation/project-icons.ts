// Feature request "Project ikonica/emoji": fixed allow-list of ~30 common
// emoji a project can pick as its icon, per the request's own "grid od ~30
// čestih emoji-ja za izbor, ne treba pun emoji picker biblioteka" answer —
// no emoji-picker dependency, same allow-list-in-a-const convention
// REACTION_EMOJI_ALLOWLIST (lib/validation/comment-reactions.ts) already
// established for chat/comment reactions.
export const PROJECT_ICON_ALLOWLIST = [
  "🚀",
  "🎯",
  "📌",
  "📊",
  "📈",
  "🛠️",
  "⚙️",
  "🧩",
  "💡",
  "🔥",
  "✅",
  "📝",
  "📅",
  "🗂️",
  "📦",
  "🎨",
  "🧪",
  "🔧",
  "🏗️",
  "🛒",
  "💰",
  "📣",
  "🌐",
  "🔒",
  "🐛",
  "⭐",
  "🎉",
  "🧭",
  "📱",
  "☁️",
] as const;

export type ProjectIconEmoji = (typeof PROJECT_ICON_ALLOWLIST)[number];
