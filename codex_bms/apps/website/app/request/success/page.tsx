import { PageHeader, SectionGrid, SimpleList, StatsCard } from "../../../../../packages/ui/src/react/index.tsx";
import { WebsitePageShell } from "../../../lib/page-shell.tsx";

export default async function WebsiteRequestSuccessPage({
  searchParams
}: {
  searchParams?: Promise<{ requestId?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestId = resolvedSearchParams?.requestId;

  return (
    <WebsitePageShell>
      <PageHeader
        eyebrow="Request received"
        title="Your request is in the intake review queue."
        description="The workflow foundation records the submission as a short-term customer request, emits an internal review notification, and sends a requester confirmation."
        actions={[
          { label: "Submit another request", href: "/request" },
          { label: "Review access paths", href: "/access" }
        ]}
        badges={["Short-term request", "Admin review pending", "Consultation preference captured"]}
      />
      <SectionGrid>
        <StatsCard
          title="What happens next"
          description="Internal reviewers can request more information, schedule a consultation, reject, create a project draft, or invite you as a long-term customer."
          stats={[
            { label: "Status", value: "Submitted" },
            { label: "Review queue", value: "Active" },
            { label: "Notifications", value: "Sent" },
            { label: "Request ID", value: requestId ?? "Generated on submit" }
          ]}
          span="4"
        />
        <SimpleList
          title="Expected follow-up"
          description="The intake workflow is modeled before final persistence and email delivery wiring."
          items={[
            { title: "Submission receipt", body: "A requester confirmation notification is issued immediately." },
            { title: "Internal review", body: "Admins review the request inside the CRM intake queue." },
            { title: "Next step", body: "You may be asked for more info, offered a consultation, or invited to continue as a long-term customer." },
            requestId
              ? { title: "Reference", body: `Keep request ID ${requestId} for support follow-up if needed.` }
              : { title: "Reference", body: "A request identifier is created on submission and can be used for support follow-up." }
          ]}
          span="8"
        />
      </SectionGrid>
    </WebsitePageShell>
  );
}
