import { KeyValueSummary, PageHeader, SectionGrid, SimpleList } from "../../../../../../packages/ui/src/react/index.tsx";
import { DashboardPageShell } from "../../../../lib/page-shell.tsx";
import { getHiringApplicationDetailData } from "../../../../lib/hiring-data.ts";

export default async function DashboardHiringApplicationDetailPage({
  params
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const detail = await getHiringApplicationDetailData(applicationId);

  return (
    <DashboardPageShell activeHref="/hiring" title="Application detail" subtitle="Review, interviews, offers, and conversion">
      <PageHeader
        eyebrow="Applicant review"
        title={detail?.applicantProfile ? `${detail.applicantProfile.firstName} ${detail.applicantProfile.lastName}` : "Application not found"}
        description="Internal-only hiring notes and interviewer feedback stay in this route and never reach the applicant portal."
        actions={[{ label: "Back to hiring", href: "/hiring" }]}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Application"
          description="The shared hiring workflow enforces status transitions and audit events."
          items={
            detail?.application
              ? [
                  { label: "Status", value: detail.application.status.replaceAll("_", " ") },
                  { label: "Posting", value: detail.jobPosting?.title ?? detail.application.jobPostingId },
                  { label: "Submitted", value: detail.application.submittedAt ?? "Draft" },
                  { label: "Applicant email", value: detail.applicantProfile?.email ?? "Unknown" }
                ]
              : [{ label: "Status", value: "Missing" }]
          }
          span="4"
        />
        <SimpleList
          title="Applicant documents"
          description="Resume and supporting files use the existing storage and upload validation pipeline."
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
          title="Internal hiring notes"
          description="These notes are visible only to owner/admin reviewers."
          items={
            detail?.internalNotes.map((note) => ({
              title: note.authorUserId,
              body: note.note,
              meta: note.createdAt
            })) ?? []
          }
          span="8"
        />
        <SimpleList
          title="Interviews and feedback"
          description="Assigned interviewer access is enforced server-side."
          items={
            detail?.interviews.map((interview) => ({
              title: `${interview.interviewType.replaceAll("_", " ")} | ${interview.status}`,
              body: `${interview.locationOrMeetingUrl} | ${interview.interviewerUserIds.join(", ")}`,
              meta: interview.scheduledStart ?? interview.createdAt
            })) ?? []
          }
          span="4"
        />
      </SectionGrid>
    </DashboardPageShell>
  );
}
