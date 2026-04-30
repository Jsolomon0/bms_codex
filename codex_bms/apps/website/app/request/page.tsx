import {
  FileField,
  FormCard,
  FormGrid,
  KeyValueSummary,
  PageHeader,
  SectionGrid,
  SelectField,
  SimpleList,
  TextAreaField,
  TextField
} from "../../../../packages/ui/src/react/index.tsx";
import { WebsitePageShell } from "../../lib/page-shell.tsx";
import {
  getPublicRequestFormOptions,
  getPublicRequestUploadRules,
  getShortTermRestrictionLabels
} from "../../lib/intake-data.ts";
import { submitProjectRequestAction } from "./actions.ts";

function getSubmissionAlert(searchParams?: {
  error?: string;
  fields?: string;
}) {
  if (searchParams?.error === "validation") {
    const fields = searchParams.fields
      ? searchParams.fields
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean)
      : [];

    return {
      title: "Submission needs correction",
      body: fields.length > 0 ? `Check these fields before resubmitting: ${fields.join(", ")}.` : "Check the required fields and upload rules before resubmitting.",
      meta: "Validation"
    };
  }

  if (searchParams?.error === "submission") {
    return {
      title: "Submission did not complete",
      body: "The request workflow rejected the submission. Retry after reviewing the input rules.",
      meta: "Retry needed"
    };
  }

  return undefined;
}

export default async function WebsiteRequestPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; fields?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const consultationOptions = getPublicRequestFormOptions();
  const restrictionLabels = getShortTermRestrictionLabels();
  const uploadRules = getPublicRequestUploadRules();
  const submissionAlert = getSubmissionAlert(resolvedSearchParams);

  return (
    <WebsitePageShell>
      <PageHeader
        eyebrow="Public intake"
        title="Start a project request as a short-term customer."
        description="This form records the minimum required intake profile: name and email are required, an image upload is optional, and consultation preference is captured up front."
        actions={[
          { label: "Review access paths", href: "/access" },
          { label: "Return home", href: "/" }
        ]}
        badges={["Name + email required", "Optional image upload", "Short-term restrictions apply"]}
      />
      <SectionGrid>
        <div style={{ gridColumn: "span 8" }}>
          <FormCard
            title="Project request form"
            description="Submissions flow into the shared intake workflow service, create a short-term customer request record, and trigger review notifications."
          >
            {submissionAlert ? (
              <div className="bms-form-note" style={{ marginBottom: 18 }}>
                <strong>{submissionAlert.title}</strong> {submissionAlert.body}
              </div>
            ) : null}
            <form action={submitProjectRequestAction} encType="multipart/form-data">
              <FormGrid>
                <TextField label="Full name" name="submitterName" placeholder="Jordan Reed" required span="6" />
                <TextField label="Email address" name="email" placeholder="jordan@example.com" required type="email" span="6" />
                <TextField label="Phone number" name="phone" placeholder="Optional" type="tel" span="6" />
                <TextField label="Project title" name="projectTitle" placeholder="Kitchen and entry remodel" required span="6" />
                <TextAreaField
                  label="Project summary"
                  name="projectSummary"
                  placeholder="Describe scope, timeline pressure, and anything the review team should know."
                  required
                />
                <SelectField label="Consultation preference" name="consultationPreference" options={consultationOptions} defaultValue="within_7_days" />
                <FileField
                  label="Optional reference image"
                  name="imageUpload"
                  note="A single reference image can be attached for intake review."
                  rules={uploadRules}
                />
              </FormGrid>
              <div className="bms-actions">
                <button className="bms-button bms-button--primary" type="submit">
                  Submit request
                </button>
                <a className="bms-button bms-button--secondary" href="/access">
                  View access options
                </a>
              </div>
            </form>
          </FormCard>
        </div>
        <KeyValueSummary
          title="Submission rules"
          description="These rules match the validation and retention posture enforced by the intake workflow."
          items={[
            { label: "Customer type", value: "Short-term" },
            { label: "Required identity", value: "Name and email" },
            { label: "Upload rule", value: "Validated image only" },
            { label: "Retention posture", value: "Records retained when required" }
          ]}
          span="4"
        />
        <SimpleList
          title="Short-term restrictions"
          description="Submitting this form does not create a long-term customer account."
          items={restrictionLabels.map((label, index) => ({
            title: `Restriction ${index + 1}`,
            body: label
          }))}
          span="4"
        />
        {submissionAlert ? (
          <SimpleList
            title="Submission feedback"
            description="The request was not accepted yet."
            items={[submissionAlert]}
            span="4"
          />
        ) : null}
      </SectionGrid>
    </WebsitePageShell>
  );
}
