import {
  EmptyState,
  FormCard,
  FormGrid,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList,
  TextAreaField,
  TextField
} from "../../../../../../packages/ui/src/react/index.tsx";
import { DashboardPageShell } from "../../../../lib/page-shell.tsx";
import { getRequestDetailData } from "../../../../lib/crm-data.ts";
import { getDashboardActor } from "../../../../lib/shell-data.ts";
import { applyProjectRequestReviewAction } from "../actions.ts";

function getFeedbackItem(searchParams?: {
  result?: string;
  error?: string;
}) {
  if (searchParams?.result) {
    return {
      title: "Review action completed",
      body: `The workflow accepted ${searchParams.result.replaceAll("_", " ")} and updated the request state.`,
      meta: "Success"
    };
  }

  if (searchParams?.error === "transition") {
    return {
      title: "Action blocked by workflow state",
      body: "The selected action is not valid from the current request status.",
      meta: "Transition denied"
    };
  }

  if (searchParams?.error === "authorization") {
    return {
      title: "Action blocked by authorization",
      body: "The current actor is not allowed to perform this review action for the request record.",
      meta: "Access denied"
    };
  }

  if (searchParams?.error === "parse") {
    return {
      title: "Action payload incomplete",
      body: "The review form was missing required fields for the selected action.",
      meta: "Input required"
    };
  }

  return undefined;
}

function HiddenReviewFields({
  requestId,
  actorUserId,
  actionType
}: {
  requestId: string;
  actorUserId: string;
  actionType: string;
}) {
  return (
    <>
      <input name="requestId" type="hidden" value={requestId} />
      <input name="actorUserId" type="hidden" value={actorUserId} />
      <input name="actionType" type="hidden" value={actionType} />
    </>
  );
}

export default async function DashboardCrmRequestDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ requestId: string }>;
  searchParams?: Promise<{ result?: string; error?: string }>;
}) {
  const { requestId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const detail = getRequestDetailData(requestId);
  const feedbackItem = getFeedbackItem(resolvedSearchParams);
  const actorUserId = getDashboardActor().userId;

  if (!detail.request || !detail.lead) {
    return (
      <DashboardPageShell activeHref="/crm" title="Request detail" subtitle="Intake request not found">
        <PlaceholderPanel
          title="Missing request"
          description="This intake request is not available in the current repository state."
          emptyState={{
            title: "Request not found",
            description: "The review detail route expects one of the active request IDs in the intake runtime.",
            action: { label: "Back to queue", href: "/crm/requests" }
          }}
        >
          <EmptyState
            content={{
              title: "Request not found",
              description: "The review detail route expects one of the active request IDs in the intake runtime.",
              action: { label: "Back to queue", href: "/crm/requests" }
            }}
          />
        </PlaceholderPanel>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell activeHref="/crm" title="Request detail" subtitle={detail.request.projectTitle}>
      <PageHeader
        eyebrow="Request detail"
        title={detail.request.projectTitle}
        description="The request detail page surfaces the short-term requester, current lead stage, upload metadata, and the live review actions that are still permitted."
        actions={[
          { label: "Back to queue", href: "/crm/requests" },
          { label: "Open public form", href: "/request" }
        ]}
        badges={[detail.request.status.replaceAll("_", " "), detail.lead.pipelineLabel]}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Request snapshot"
          description="The detail surface is designed around authorization-safe attributes."
          items={[
            { label: "Requester", value: detail.request.submitterName },
            { label: "Email", value: detail.request.email },
            { label: "Customer type", value: detail.request.customerType },
            { label: "Consultation preference", value: detail.request.consultationPreference },
            { label: "Lead status", value: detail.lead.pipelineLabel },
            { label: "Organization", value: detail.request.organizationId },
            { label: "Expires", value: detail.request.shortTermExpiresAt.slice(0, 10) }
          ]}
          span="8"
        />
        <SimpleList
          title="Allowed actions"
          description="The workflow service decides which actions remain valid from the current state."
          items={detail.availableActions.map((action) => ({
            title: action,
            body:
              action === "request_more_info"
                ? "Prompt the requester for clarification and move the lead into an awaiting-customer state."
                : action === "schedule_consultation"
                  ? "Capture a consultation time and notify the requester."
                  : action === "reject"
                    ? "Close the request with an audited rejection reason."
                    : action === "convert_to_project_draft"
                      ? "Create a draft project shell and move the lead into a converted state."
                      : action === "invite_as_long_term_customer"
                        ? "Invite the short-term requester to become a long-term customer."
                        : "Move the request into active internal review."
          }))}
          span="4"
        />
        <SimpleList
          title="Short-term restrictions"
          description="These restrictions apply until the requester explicitly becomes a long-term customer."
          items={detail.request.shortTermRestrictions.map((restriction) => ({
            title: restriction.code,
            body: restriction.label
          }))}
          span="4"
        />
        <SimpleList
          title="Submission detail"
          description="Initial intake content stays visible to reviewers in one place."
          items={[
            {
              title: "Summary",
              body: detail.request.projectSummary
            },
            {
              title: "Optional image upload",
              body: detail.request.imageUpload
                ? `${detail.request.imageUpload.fileName} - ${detail.request.imageUpload.mimeType} - ${detail.request.imageUpload.byteSize} bytes`
                : "No image uploaded"
            }
          ]}
          span="8"
        />
        {feedbackItem ? (
          <SimpleList title="Latest workflow feedback" description="The most recent action outcome is shown here." items={[feedbackItem]} span="4" />
        ) : null}
        <div style={{ gridColumn: "span 8", display: "grid", gap: 16 }}>
          {detail.availableActions.includes("start_review") ? (
            <FormCard title="Start review" description="Moves the request from submitted into under-review status.">
              <form action={applyProjectRequestReviewAction}>
                <HiddenReviewFields actionType="start_review" actorUserId={actorUserId} requestId={detail.request.id} />
                <div className="bms-actions">
                  <button className="bms-button bms-button--primary" type="submit">
                    Start review
                  </button>
                </div>
              </form>
            </FormCard>
          ) : null}
          {detail.availableActions.includes("request_more_info") ? (
            <FormCard title="Request more information" description="Sends a requester-facing message and pauses the lead in an awaiting-customer state.">
              <form action={applyProjectRequestReviewAction}>
                <HiddenReviewFields actionType="request_more_info" actorUserId={actorUserId} requestId={detail.request.id} />
                <FormGrid>
                  <TextAreaField
                    defaultValue={detail.request.requestedMoreInfoMessage}
                    label="Message to requester"
                    name="message"
                    placeholder="List the specific details the requester still owes the review team."
                    required
                  />
                </FormGrid>
                <div className="bms-actions">
                  <button className="bms-button bms-button--primary" type="submit">
                    Send request
                  </button>
                </div>
              </form>
            </FormCard>
          ) : null}
          {detail.availableActions.includes("schedule_consultation") ? (
            <FormCard title="Schedule consultation" description="Captures the requested consultation time and notifies the short-term customer.">
              <form action={applyProjectRequestReviewAction}>
                <HiddenReviewFields actionType="schedule_consultation" actorUserId={actorUserId} requestId={detail.request.id} />
                <FormGrid>
                  <TextField
                    defaultValue={detail.request.consultationScheduledAt?.slice(0, 16)}
                    label="Consultation time"
                    name="scheduledAt"
                    required
                    type="datetime-local"
                    span="6"
                  />
                  <TextField label="Note" name="note" placeholder="Optional internal note" span="6" />
                </FormGrid>
                <div className="bms-actions">
                  <button className="bms-button bms-button--primary" type="submit">
                    Schedule consultation
                  </button>
                </div>
              </form>
            </FormCard>
          ) : null}
          {detail.availableActions.includes("reject") ? (
            <FormCard title="Reject request" description="Closes the request with an audited reason and requester notification.">
              <form action={applyProjectRequestReviewAction}>
                <HiddenReviewFields actionType="reject" actorUserId={actorUserId} requestId={detail.request.id} />
                <FormGrid>
                  <TextAreaField
                    defaultValue={detail.request.rejectionReason}
                    label="Rejection reason"
                    name="reason"
                    placeholder="Explain why the request cannot proceed."
                    required
                  />
                </FormGrid>
                <div className="bms-actions">
                  <button className="bms-button bms-button--primary" type="submit">
                    Reject request
                  </button>
                </div>
              </form>
            </FormCard>
          ) : null}
          {detail.availableActions.includes("convert_to_project_draft") ? (
            <FormCard title="Convert to project draft" description="Creates a draft project shell and shifts the lead into converted status.">
              <form action={applyProjectRequestReviewAction}>
                <HiddenReviewFields actionType="convert_to_project_draft" actorUserId={actorUserId} requestId={detail.request.id} />
                <FormGrid>
                  <TextField
                    defaultValue={detail.request.projectDraftId}
                    label="Draft project label"
                    name="projectName"
                    placeholder="Optional draft project label"
                    span="6"
                  />
                </FormGrid>
                <div className="bms-actions">
                  <button className="bms-button bms-button--primary" type="submit">
                    Convert to draft
                  </button>
                </div>
              </form>
            </FormCard>
          ) : null}
          {detail.availableActions.includes("invite_as_long_term_customer") ? (
            <FormCard title="Invite as long-term customer" description="Keeps the request under short-term restrictions until the long-term invite is accepted.">
              <form action={applyProjectRequestReviewAction}>
                <HiddenReviewFields actionType="invite_as_long_term_customer" actorUserId={actorUserId} requestId={detail.request.id} />
                <FormGrid>
                  <TextField
                    defaultValue={detail.request.email}
                    label="Invite email"
                    name="inviteEmail"
                    placeholder="requester@example.com"
                    type="email"
                    span="6"
                  />
                </FormGrid>
                <div className="bms-actions">
                  <button className="bms-button bms-button--primary" type="submit">
                    Send long-term invite
                  </button>
                </div>
              </form>
            </FormCard>
          ) : null}
        </div>
      </SectionGrid>
    </DashboardPageShell>
  );
}
