import { KeyValueSummary, PageHeader, SectionGrid, SimpleList } from "../../../../../packages/ui/src/react/index.tsx";
import { PortalPageShell } from "../../../lib/page-shell.tsx";
import { getApplicantApplicationDetail } from "../../../lib/hiring-data.ts";

export default async function ApplicantApplicationDetailPage({
  params
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const detail = await getApplicantApplicationDetail(applicationId);

  return (
    <PortalPageShell activeHref="/applications" title="Application status" subtitle="Hiring activity for your own record">
      <PageHeader
        eyebrow="Application detail"
        title={detail?.jobPosting?.title ?? "Application not found"}
        description="This view shows your submission, documents, interview schedule, and sent offers without exposing internal hiring notes or interviewer feedback."
        actions={[{ label: "Back to applications", href: "/applications" }]}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Status summary"
          description="Application status changes are audited and visible here."
          items={
            detail?.application
              ? [
                  { label: "Status", value: detail.application.status.replaceAll("_", " ") },
                  { label: "Submitted", value: detail.application.submittedAt ?? "Draft" },
                  { label: "Posting", value: detail.jobPosting?.title ?? detail.application.jobPostingId },
                  { label: "Interview count", value: String(detail.interviews.length) }
                ]
              : [{ label: "Status", value: "Missing" }]
          }
          span="4"
        />
        <SimpleList
          title="Documents"
          description="Uploads remain scoped to your own application."
          items={
            detail?.documents.map((document) => ({
              title: document.fileName,
              body: `${document.documentType} | ${document.contentType}`,
              meta: document.uploadedAt
            })) ?? []
          }
          span="8"
        />
        <SimpleList
          title="Interviews"
          description="Interview schedules and responses remain limited to the applicant and assigned interviewers."
          items={
            detail?.interviews.map((interview) => ({
              title: `${interview.interviewType.replaceAll("_", " ")} | ${interview.status}`,
              body: interview.locationOrMeetingUrl,
              meta: interview.scheduledStart ?? interview.createdAt
            })) ?? []
          }
          span="8"
        />
        <SimpleList
          title="Offers"
          description="Only sent or later-stage offers appear in the applicant portal."
          items={
            detail?.offers.map((offer) => ({
              title: offer.status.replaceAll("_", " "),
              body: JSON.stringify(offer.offerDetails),
              meta: offer.sentAt ?? offer.createdAt
            })) ?? []
          }
          span="4"
        />
      </SectionGrid>
    </PortalPageShell>
  );
}
