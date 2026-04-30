import { KeyValueSummary, PageHeader, SectionGrid, SimpleList } from "../../../../../packages/ui/src/react/index.tsx";
import { WebsitePageShell } from "../../../lib/page-shell.tsx";
import { getPublicJobPostingData } from "../../../lib/hiring-data.ts";

export default async function WebsiteCareerPostingPage({
  params
}: {
  params: Promise<{ jobPostingId: string }>;
}) {
  const { jobPostingId } = await params;
  const jobPosting = await getPublicJobPostingData(jobPostingId);

  return (
    <WebsitePageShell>
      <PageHeader
        eyebrow="Career posting"
        title={jobPosting?.title ?? "Job posting not found"}
        description={jobPosting?.description ?? "Only published job postings are available on the public site."}
        actions={jobPosting ? [{ label: "Apply now", href: `/careers/${jobPosting.id}/apply` }] : [{ label: "Back to careers", href: "/careers" }]}
        badges={jobPosting ? [jobPosting.department, jobPosting.location, jobPosting.employmentType.replaceAll("_", " ")] : undefined}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Role summary"
          description="The public posting remains read-only until an application is submitted."
          items={
            jobPosting
              ? [
                  { label: "Department", value: jobPosting.department },
                  { label: "Location", value: jobPosting.location },
                  { label: "Employment type", value: jobPosting.employmentType.replaceAll("_", " ") },
                  { label: "Compensation", value: jobPosting.compensationRange ?? "Discussed later" }
                ]
              : [{ label: "Status", value: "Missing" }]
          }
          span="4"
        />
        <SimpleList
          title="Screening questions"
          description="Required answers are validated before the application is accepted."
          items={
            jobPosting?.screeningQuestions.map((question) => ({
              title: question.prompt,
              body: question.required ? "Required" : "Optional"
            })) ?? []
          }
          span="8"
        />
      </SectionGrid>
    </WebsitePageShell>
  );
}
