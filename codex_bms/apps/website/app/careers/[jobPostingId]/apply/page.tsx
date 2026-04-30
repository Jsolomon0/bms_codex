import {
  FileField,
  FormCard,
  FormGrid,
  KeyValueSummary,
  PageHeader,
  SectionGrid,
  TextAreaField,
  TextField
} from "../../../../../../packages/ui/src/react/index.tsx";
import { WebsitePageShell } from "../../../../lib/page-shell.tsx";
import { getPublicJobPostingData, getPublicJobBoardData } from "../../../../lib/hiring-data.ts";
import { submitJobApplicationAction } from "../../../careers/actions.ts";

function getSubmissionAlert(searchParams?: { error?: string; fields?: string }) {
  if (searchParams?.error === "validation") {
    const fields = searchParams.fields
      ? searchParams.fields
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean)
      : [];

    return {
      title: "Application needs correction",
      body: fields.length > 0 ? `Check these fields before resubmitting: ${fields.join(", ")}.` : "Review the required fields and upload rules before resubmitting."
    };
  }

  if (searchParams?.error === "rate_limit") {
    return {
      title: "Application temporarily blocked",
      body: "Too many recent attempts were submitted for this role. Wait before retrying."
    };
  }

  if (searchParams?.error === "submission") {
    return {
      title: "Application did not submit",
      body: "The hiring workflow rejected the submission. Retry after reviewing the input rules."
    };
  }

  return undefined;
}

export default async function WebsiteCareerApplyPage({
  params,
  searchParams
}: {
  params: Promise<{ jobPostingId: string }>;
  searchParams?: Promise<{ error?: string; fields?: string }>;
}) {
  const { jobPostingId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const jobPosting = await getPublicJobPostingData(jobPostingId);
  const boardData = await getPublicJobBoardData();
  const submissionAlert = getSubmissionAlert(resolvedSearchParams);

  return (
    <WebsitePageShell>
      <PageHeader
        eyebrow="Apply"
        title={jobPosting ? `Apply for ${jobPosting.title}` : "Job posting not found"}
        description="Applications require name, email, resume upload, screening answers, and consent. Internal notes and interviewer feedback remain hidden from applicants."
        actions={[{ label: "Back to careers", href: "/careers" }]}
        badges={["Resume required", "Consent required", "Rate-limited public route"]}
      />
      <SectionGrid>
        <div style={{ gridColumn: "span 8" }}>
          <FormCard
            title="Application form"
            description="Submissions create an applicant profile, a submitted job application, applicant document records, audit events, and hiring notifications."
          >
            {submissionAlert ? (
              <div className="bms-form-note" style={{ marginBottom: 18 }}>
                <strong>{submissionAlert.title}</strong> {submissionAlert.body}
              </div>
            ) : null}
            <form action={submitJobApplicationAction} encType="multipart/form-data">
              <input name="jobPostingId" type="hidden" value={jobPostingId} />
              <FormGrid>
                <TextField label="First name" name="firstName" required span="6" />
                <TextField label="Last name" name="lastName" required span="6" />
                <TextField label="Email address" name="email" required type="email" span="6" />
                <TextField label="Phone number" name="phone" type="tel" span="6" />
                <TextField label="Portfolio URL" name="portfolioUrl" span="6" />
                <TextField label="LinkedIn URL" name="linkedinUrl" span="6" />
                <TextAreaField label="Cover letter" name="coverLetter" placeholder="Optional context for the hiring team." />
                {jobPosting?.screeningQuestions.map((question) => (
                  <TextAreaField
                    key={question.id}
                    label={`${question.prompt}${question.required ? " *" : ""}`}
                    name={`screeningAnswer:${question.id}`}
                    required={question.required}
                  />
                ))}
                <FileField
                  label="Resume upload"
                  name="resumeUpload"
                  note="PDF and common image formats are accepted by the current secure upload validator."
                  rules={boardData.uploadRules}
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                />
              </FormGrid>
              <label style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <input name="consentGranted" type="checkbox" value="true" />
                <span>I confirm that the submitted hiring information is accurate.</span>
              </label>
              <div className="bms-actions">
                <button className="bms-button bms-button--primary" type="submit">
                  Submit application
                </button>
                <a className="bms-button bms-button--secondary" href={`/careers/${jobPostingId}`}>
                  Review posting
                </a>
              </div>
            </form>
          </FormCard>
        </div>
        <KeyValueSummary
          title="Application controls"
          description="These controls match the shared validation and security layer."
          items={[
            { label: "Posting status", value: jobPosting?.status ?? "Missing" },
            { label: "Upload validation", value: "Server-side" },
            { label: "Applicant portal", value: "Own records only" },
            { label: "Internal notes", value: "Hidden from applicants" }
          ]}
          span="4"
        />
      </SectionGrid>
    </WebsitePageShell>
  );
}
