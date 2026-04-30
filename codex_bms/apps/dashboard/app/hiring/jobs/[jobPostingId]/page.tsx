import { KeyValueSummary, PageHeader, SectionGrid, SimpleList } from "../../../../../../packages/ui/src/react/index.tsx";
import { DashboardPageShell } from "../../../../lib/page-shell.tsx";
import { getHiringJobPostingDetailData } from "../../../../lib/hiring-data.ts";

export default async function DashboardHiringJobPostingPage({
  params
}: {
  params: Promise<{ jobPostingId: string }>;
}) {
  const { jobPostingId } = await params;
  const detail = await getHiringJobPostingDetailData(jobPostingId);

  return (
    <DashboardPageShell activeHref="/hiring" title="Job posting detail" subtitle="Public posting controls and applicant feed">
      <PageHeader
        eyebrow="Hiring job post"
        title={detail?.jobPosting?.title ?? "Job posting not found"}
        description="Published postings appear on the public career board. Applications remain internal until an applicant signs into the applicant portal."
        actions={[{ label: "Back to hiring", href: "/hiring" }]}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Posting summary"
          description="This view is owner/admin only."
          items={
            detail?.jobPosting
              ? [
                  { label: "Department", value: detail.jobPosting.department },
                  { label: "Location", value: detail.jobPosting.location },
                  { label: "Employment type", value: detail.jobPosting.employmentType.replaceAll("_", " ") },
                  { label: "Status", value: detail.jobPosting.status }
                ]
              : [{ label: "Status", value: "Missing" }]
          }
          span="4"
        />
        <SimpleList
          title="Applications"
          description="Applications linked to this posting can be reviewed from their detail routes."
          items={
            detail?.applications.map((application) => ({
              title: `${application.id} -> /hiring/applications/${application.id}`,
              body: application.status.replaceAll("_", " "),
              meta: application.submittedAt ?? application.createdAt
            })) ?? []
          }
          span="8"
        />
      </SectionGrid>
    </DashboardPageShell>
  );
}
