# Validation contract — Client delivery modules (Architecture + Brief)

_Mission: 20260910-182104_
_Status: DRAFT until `APPROVED` exists. Immutable thereafter._

Flat, numbered, falsifiable. Every assertion is assigned to at least one
feature in `plan.md`. Never edit or delete an ID after approval; append
new IDs instead.

---

## Architecture — model and cross-view identity

AS-001: A page created on the Architecture board exists as a task with a page slug set.
AS-002: A page created on the board carries the workspace's "Page" task type.
AS-003: A section created under a page exists as a subtask of that page's task.
AS-004: A page created on the board appears in the project's existing task list view.
AS-005: A section created on the board appears as a subtask in the project's existing task detail view.
AS-006: Renaming a page on the board changes the task title shown in the task list view.
AS-007: Renaming a section outside the board changes the section name shown on the board.
AS-008: Deleting a page deletes its sections.
AS-009: A page belongs to exactly one project.
AS-010: A section belongs to exactly one page.
AS-011: A project has exactly one Architecture board.
AS-012: A page carries a page kind of static, cms, or utility.

## Architecture — slugs

AS-013: Creating a page proposes a URL slug derived from the page name.
AS-014: The proposed slug can be edited before the page is saved.
AS-015: An edited slug is preserved when the page name later changes.
AS-016: A slug may contain nested path segments.
AS-017: Two pages in the same project cannot have the same slug.
AS-018: A page cannot be saved with an empty slug.

## Architecture — board rendering

AS-019: The board renders one column per page.
AS-020: A page column shows the page name.
AS-021: A page column shows the page description when one is set.
AS-022: A page column shows a badge indicating its kind.
AS-023: A CMS page's badge is visually distinct from a static page's badge.
AS-024: A page column lists its sections in stored order.
AS-025: A section card shows the section name.
AS-026: The board renders columns in the project's stored page order.
AS-027: The board scrolls horizontally when columns exceed the viewport width.
AS-028: The board shows an empty state when the project has no pages.
AS-029: A page column shows a control for adding a section.
AS-030: The board shows a control for adding a page.

## Architecture — page and section editing

AS-031: A new page is created with kind static by default.
AS-032: A page's kind can be changed after creation.
AS-033: A page can be renamed inline on the board.
AS-034: A section can be renamed inline on the board.
AS-035: A section can be deleted from the board.
AS-036: A page can be deleted from the board.
AS-037: A newly created page is placed at the end of the column order.
AS-038: A newly created section is placed at the end of its page's section list.
AS-039: A page cannot be saved with an empty name.
AS-040: A section cannot be saved with an empty name.

## Architecture — drag and drop

AS-041: A section can be reordered within its page by dragging.
AS-042: A section reordered within its page keeps its new position after reload.
AS-043: A section can be dragged from one page to another.
AS-044: A section moved to another page becomes a subtask of that page's task.
AS-045: A section moved to another page keeps its component link.
AS-046: A page column can be reordered by dragging.
AS-047: A reordered page column keeps its new position after reload.
AS-048: Section reordering can be performed using the keyboard.
AS-049: Page reordering can be performed using the keyboard.
AS-050: A cancelled drag leaves the original order unchanged.

## Architecture — components

AS-051: A section can be turned into a component.
AS-052: Turning a section into a component creates a component named after that section.
AS-053: An existing component can be linked to a section.
AS-054: A section linked to a component displays the component's name.
AS-055: A section linked to a component can additionally carry its own local title.
AS-056: A section's local title is displayed secondary to the component name.
AS-057: Renaming a component changes the name displayed on every one of its instances.
AS-058: A single section can be unlinked from its component without affecting other instances.
AS-059: A section unlinked from its component keeps its own name.
AS-060: Deleting a component leaves its instance sections in place.
AS-061: Deleting a component clears the component link on all its instances.
AS-062: A section can be linked to at most one component.
AS-063: A component belongs to exactly one project.
AS-064: A component from one project cannot be linked to a section in another project.
AS-065: Two components in the same project cannot have the same name.
AS-066: A component cannot be saved with an empty name.
AS-067: The component picker lists the project's existing components.
AS-068: The component picker offers creating a new component from the typed name.

## Architecture — component highlighting and colour

AS-069: A section linked to a component is visually distinguished from an unlinked section.
AS-070: Hovering a component instance highlights every instance of that component on the board.
AS-071: Hovering a component instance does not highlight instances of other components.
AS-072: Hovering an unlinked section highlights no other section.
AS-073: The highlight is removed when the pointer leaves the instance.
AS-074: The hover highlight changes only border and background, not size, position, or shadow.
AS-075: Component colouring resolves in the light theme.
AS-076: Component colouring resolves in the dark theme.
AS-077: CMS page colouring resolves in the light theme.
AS-078: CMS page colouring resolves in the dark theme.
AS-079: No colour token introduced by this mission is defined only inside one theme block.
AS-080: No colour token introduced by this mission is a hand-written hex value.

## Architecture — component panel

AS-081: The board offers a panel listing all of the project's components.
AS-082: The component panel shows each component's instance count.
AS-083: A component with no instances shows a count of zero.
AS-084: Clicking a component instance opens that component's detail.
AS-085: A component's detail lists every page on which it appears.
AS-086: Selecting a page in the component detail brings that page into view on the board.
AS-087: A component can be renamed from the panel.
AS-088: A component can be deleted from the panel.

## Architecture — access control

AS-089: A workspace writer can create, rename, and delete pages on the board.
AS-090: A workspace writer can create, rename, and delete components.
AS-091: A client of a portal-enabled project can view the board.
AS-092: A client cannot create, rename, or delete a page.
AS-093: A client cannot create, rename, or delete a component.
AS-094: A client cannot reorder sections or pages.
AS-095: A client cannot view the board of a project whose portal is disabled.
AS-096: A client cannot view the board of a project they are not a member of.
AS-097: A viewer-role team member cannot modify the board.
AS-098: A client's board view omits pages that are not client-visible.

## Brief — schema and questionnaire authoring

AS-099: A project has at most one brief.
AS-100: A brief is in one of the states draft, submitted, or approved.
AS-101: A team member can add a question to a project's questionnaire.
AS-102: A question carries a category.
AS-103: A question carries an answer type of short text, long text, single choice, or multi choice.
AS-104: A question can carry help text.
AS-105: A question can be marked required.
AS-106: A choice question carries its selectable options.
AS-107: Questions can be reordered by dragging.
AS-108: A reordered question keeps its position after reload.
AS-109: A question can be deleted.
AS-110: Deleting a question preserves answers already given to it.
AS-111: An answer to a deleted question still displays the question text it was answered against.
AS-112: A question cannot be saved with empty prompt text.

## Brief — client answering

AS-113: A client of a portal-enabled project can open the questionnaire.
AS-114: The questionnaire presents one question at a time.
AS-115: The questionnaire shows progress through the question set.
AS-116: An answer is saved without the client pressing a save control.
AS-117: A client returning to the questionnaire resumes at the first unanswered question.
AS-118: A saved answer survives a page reload.
AS-119: A short-text question accepts a single-line answer.
AS-120: A long-text question accepts a multi-line answer.
AS-121: A single-choice question accepts exactly one option.
AS-122: A multi-choice question accepts more than one option.
AS-123: A required question must be answered before the brief can be submitted.
AS-124: A client can submit the questionnaire.
AS-125: Submitting sets the brief state to submitted.
AS-126: Submitting does not prevent further edits to answers.

## Brief — revisions

AS-127: Changing a saved answer records the previous value.
AS-128: A revision record names the user who made the change.
AS-129: A revision record carries the time of the change.
AS-130: The team sees an indication that an answer has been edited.
AS-131: The client sees an indication that an answer has been edited.
AS-132: The full revision history of an answer can be expanded.
AS-133: An answer cannot be changed without a revision being recorded.
AS-134: A revision record cannot be updated by anyone.
AS-135: A revision record cannot be deleted by anyone.
AS-136: Changing an answer after submission notifies the configured recipients.
AS-137: Changing an answer before submission sends no notification.
AS-138: The recipients of the change notification are configurable per project.

## Brief — document and approval

AS-139: The team can generate a brief document from the answers.
AS-140: The generated document contains four fixed sections.
AS-141: The generated document quotes the client's answers under the relevant section.
AS-142: The generated document is stored as a project document of kind brief.
AS-143: The generated document is not client-visible until the team makes it so.
AS-144: The team can edit the generated document's text.
AS-145: The team can request approval of the brief document.
AS-146: An approval request for a brief records the document as its subject.
AS-147: Approving the brief sets the brief state to approved.
AS-148: Approving the brief makes its answers read-only.
AS-149: A client cannot change an answer once the brief is approved.
AS-150: A team member cannot change an answer once the brief is approved.
AS-151: Withdrawing the approval makes answers editable again.
AS-152: Brief approvals appear in a dedicated discovery approvals section.

## Brief — access control and multiple client contacts

AS-153: All client contacts on a project see the same brief answers.
AS-154: Any client contact on a project can edit any answer.
AS-155: A revision records which client contact made the change.
AS-156: A client can read the project's questions.
AS-157: A client cannot create, edit, or delete a question.
AS-158: A client cannot read questions of a project they are not a member of.
AS-159: A client cannot read answers of a project they are not a member of.
AS-160: A client cannot answer when the project's portal is disabled.
AS-161: A viewer-role team member cannot edit questions.
AS-162: A client cannot see the brief document while it is not client-visible.
AS-163: An unfinished brief appears in the client's outstanding-items list.
AS-164: A submitted brief does not appear in the client's outstanding-items list.

## Templates and module boundaries

AS-165: A project template can carry a set of brief questions.
AS-166: Creating a project from a template copies its brief questions.
AS-167: Creating a project from a template copies no answers.
AS-168: The brief's revision history is presented separately from the project's general activity feed.
AS-169: The board and the brief are presented as separate portal views.
AS-170: The board offers no approval step.
AS-171: The board does not become read-only as a result of any event.
AS-172: The board offers no commenting.

## Quality and constraints

AS-173: The board remains interactive with forty pages of twelve sections each.
AS-174: Behaviour introduced by this mission is covered by automated tests.
AS-175: The project type-checks with no errors.
AS-176: The project lints with no errors.
AS-177: Every interactive board control can be reached using the keyboard.
AS-178: Every interactive board control exposes an accessible name.
AS-179: Text on section cards and page columns meets WCAG AA contrast in both themes.
AS-180: No credential value is written into any file tracked by git.
