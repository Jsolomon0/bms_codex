import {
  KeyValueSummary,
  PageHeader,
  PipelineBoard,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { DashboardPageShell } from "../../../lib/page-shell.tsx";
import { getCrmHomeData, getRequestQueueData } from "../../../lib/crm-data.ts";

export default async function DashboardCrmRequestsPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; requestId?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requests = getRequestQueueData();
  const home = getCrmHomeData();
  const feedback =
    resolvedSearchParams?.error === "missing_request"
      ? [
          {
            title: "Request not found",
            body: resolvedSearchParams.requestId
              ? `The request ${resolvedSearchParams.requestId} is not present in the current intake runtime.`
              : "The selected request is not present in the current intake runtime.",
            meta: "Queue mismatch"
          }
        ]
      : [];

  return (
    <DashboardPageShell activeHref="/crm" title="Intake review queue" subtitle="Public requests and conversion actions">
      <PageHeader
        eyebrow="Intake review"
        title="Internal admins review short-term customer requests here."
        description="Each request can move through review, request-more-info, consultation, rejection, project-draft conversion, or long-term invitation without exposing internal controls on the public site."
        actions={[{ label: "Return to CRM overview", href: "/crm" }]}
      />
      <SectionGrid>
        <PipelineBoard
          title="Queue by pipeline stage"
          description="Counts come from the same workflow status model used in tests."
          stages={home.pipeline.map((stage) => ({
            title: stage.label,
            count: String(stage.requestCount)
          }))}
        />
        <KeyValueSummary
          title="Review guardrails"
          description="These policies apply to every request in the queue."
          items={[
            { label: "Customer model", value: "Short-term until invited" },
            { label: "Required fields", value: "Name and email" },
            { label: "Audit policy", value: "Every status change logged" },
            { label: "Upload policy", value: "Validated image only" }
          ]}
          span="4"
        />
        <SimpleList
          title="Open request queue"
          description="Each entry links to a request detail review page."
          items={requests.map((request) => ({
            title: `${request.projectTitle} -> /crm/requests/${request.id}`,
            body: `${request.submitterName} - ${request.email} - ${request.status.replaceAll("_", " ")}`,
            meta: `Consultation: ${request.consultationPreference}`
          }))}
          span="8"
        />
        <SimpleList
          title="Available review actions"
          description="These actions call the shared intake workflow service and are authorized per action type."
          items={[
            { title: "Request more info", body: "Moves the request into an awaiting-customer state." },
            { title: "Schedule consultation", body: "Captures consultation timing and notifies the requester." },
            { title: "Reject", body: "Closes the request with an audited reason." },
            { title: "Convert to project draft", body: "Creates a project-draft placeholder ID without opening a full project flow." },
            { title: "Invite as long-term customer", body: "Preserves short-term restrictions until the invite is accepted." }
          ]}
          span="4"
        />
        {feedback.length > 0 ? (
          <SimpleList title="Queue feedback" description="Recent queue-level routing issues are shown here." items={feedback} span="4" />
        ) : null}
      </SectionGrid>
    </DashboardPageShell>
  );
}
