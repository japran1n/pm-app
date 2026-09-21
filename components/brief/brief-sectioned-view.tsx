// F011: groups brief answers by section (BR-030) and wires the sticky
// TOC (BR-031..BR-034). Server Component; BriefToc is the client island.
import { BriefToc } from "@/components/brief/brief-toc";
import {
  TeamAnswersView,
  type TeamAnswersViewQuestion,
} from "@/components/brief/team-answers-view";
import { groupBySection } from "@/lib/brief/group-by-section";
import { slugifySection } from "@/lib/brief/slugify-section";

function isAnswered({ answer }: TeamAnswersViewQuestion): boolean {
  return (
    !!answer && ((answer.answerOptions?.length ?? 0) > 0 || !!answer.answerText)
  );
}

export function BriefSectionedView({
  items,
}: {
  items: TeamAnswersViewQuestion[];
}) {
  const byId = new Map(items.map((item) => [item.question.id, item]));
  const sections = groupBySection(items.map((i) => i.question)).map(
    (section) => {
      const sectionItems = section.questions
        .map((q) => byId.get(q.id))
        .filter((i): i is TeamAnswersViewQuestion => !!i);
      return {
        name: section.name,
        items: sectionItems,
        answeredCount: sectionItems.filter(isAnswered).length,
        totalCount: sectionItems.length,
      };
    },
  );

  // Single section: no TOC, no headings, layout unchanged.
  if (sections.length <= 1) return <TeamAnswersView items={items} />;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      <BriefToc
        sections={sections.map(({ name, answeredCount, totalCount }) => ({
          name,
          answeredCount,
          totalCount,
        }))}
      />
      <div className="flex min-w-0 max-w-[720px] w-full flex-col gap-10">
        {sections.map((section) => (
          <section
            key={section.name}
            id={`section-${slugifySection(section.name)}`}
            className="scroll-mt-6"
          >
            <h2 className="mb-4 text-sm font-semibold text-foreground">
              {section.name}
            </h2>
            <TeamAnswersView items={section.items} />
          </section>
        ))}
      </div>
    </div>
  );
}
