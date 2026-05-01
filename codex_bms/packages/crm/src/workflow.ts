import type {
  AuditEvent,
  AuditSink,
  LeadPipelineStage,
  LeadRecord,
  LeadStatus,
  NotificationDispatch,
  NotificationSink,
  ProjectRequestRecord,
  ProjectRequestRepository,
  ProjectRequestReviewAction,
  ProjectRequestReviewActionType,
  ProjectRequestStatus,
  PublicProjectRequestSubmissionInput,
  PublicProjectRequestValidationIssue,
  ShortTermCustomerRestriction
} from "../../types/src/index.ts";
import { validatePublicProjectRequestSubmission } from "./validation.ts";

const SHORT_TERM_RESTRICTIONS: readonly ShortTermCustomerRestriction[] = [
  {
    code: "minimal_identity",
    label: "Short-term requests only store the minimum contact profile needed for intake."
  },
  {
    code: "no_portal_access",
    label: "Short-term requesters do not receive customer portal access automatically."
  },
  {
    code: "auto_expire_after_30_days",
    label: "Short-term request records expire after 30 days of inactivity."
  },
  {
    code: "legal_and_accounting_retention",
    label: "Legal and accounting records are retained when required even after expiry."
  }
] as const;

const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  reviewing: "Under review",
  awaiting_customer: "Needs more info",
  consultation_scheduled: "Consultation scheduled",
  rejected: "Rejected",
  expired: "Expired",
  converted_project_draft: "Project draft created",
  invited_long_term_customer: "Invited long-term"
};

function addDays(now: Date, days: number): string {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function defaultIdGenerator() {
  let counter = 0;
  return (prefix: string) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

export class IntakeValidationError extends Error {
  readonly issues: readonly PublicProjectRequestValidationIssue[];

  constructor(issues: readonly PublicProjectRequestValidationIssue[]) {
    super("Public project request validation failed.");
    this.name = "IntakeValidationError";
    this.issues = issues;
  }
}

export class IntakeTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeTransitionError";
  }
}

export interface IntakeWorkflowDependencies {
  repository: ProjectRequestRepository;
  auditSink?: AuditSink;
  notificationSink?: NotificationSink;
  idGenerator?: (prefix: string) => string;
  organizationId?: string;
  now?: () => Date;
}

export interface PublicSubmissionResult {
  request: ProjectRequestRecord;
  lead: LeadRecord;
  notifications: readonly NotificationDispatch[];
  audits: readonly AuditEvent[];
}

export interface ReviewActionResult {
  request: ProjectRequestRecord;
  lead: LeadRecord;
  notifications: readonly NotificationDispatch[];
  audits: readonly AuditEvent[];
}

function mapRequestStatusToLeadStatus(status: ProjectRequestStatus): LeadStatus {
  switch (status) {
    case "submitted":
      return "new";
    case "under_review":
      return "reviewing";
    case "needs_more_info":
      return "awaiting_customer";
    case "consultation_scheduled":
      return "consultation_scheduled";
    case "rejected":
      return "rejected";
    case "expired":
      return "expired";
    case "project_draft_created":
      return "converted_project_draft";
    case "long_term_invited":
      return "invited_long_term_customer";
  }
}

function createAuditEvent(
  now: string,
  eventType: AuditEvent["eventType"],
  resourceType: string,
  resourceId: string,
  reason: string,
  actorUserId?: string | null,
  metadata?: Record<string, unknown>
): AuditEvent {
  return {
    eventType,
    outcome: "success",
    actorUserId: actorUserId ?? null,
    resourceType,
    resourceId,
    reason,
    viaPublicLink: false,
    sensitive: true,
    occurredAt: now,
    metadata
  };
}

function statusAllowsAction(status: ProjectRequestStatus, actionType: ProjectRequestReviewActionType): boolean {
  if (status === "rejected" || status === "expired" || status === "long_term_invited") {
    return false;
  }

  if (status === "project_draft_created") {
    return actionType === "invite_as_long_term_customer";
  }

  if (status === "submitted") {
    return true;
  }

  if (status === "under_review" || status === "needs_more_info" || status === "consultation_scheduled") {
    return actionType !== "start_review";
  }

  return false;
}

function buildSubmissionNotifications(
  now: string,
  request: ProjectRequestRecord,
  lead: LeadRecord,
  idGenerator: (prefix: string) => string
): NotificationDispatch[] {
  return [
    {
      id: idGenerator("notification"),
      type: "intake.submitted",
      audience: "internal_review_queue",
      requestId: request.id,
      leadId: lead.id,
      recipientRole: "administrator",
      title: "New public project request",
      body: `${request.submitterName} submitted ${request.projectTitle}.`,
      createdAt: now
    },
    {
      id: idGenerator("notification"),
      type: "intake.submission.receipt",
      audience: "requester",
      requestId: request.id,
      leadId: lead.id,
      recipientEmail: request.email,
      title: "We received your project request",
      body: "Your request has been recorded as a short-term customer intake and is waiting for review.",
      createdAt: now
    }
  ];
}

function buildReviewNotifications(
  now: string,
  request: ProjectRequestRecord,
  lead: LeadRecord,
  action: ProjectRequestReviewAction,
  idGenerator: (prefix: string) => string
): NotificationDispatch[] {
  switch (action.type) {
    case "start_review":
      return [];
    case "request_more_info":
      return [
        {
          id: idGenerator("notification"),
          type: "intake.review.request_more_info",
          audience: "requester",
          requestId: request.id,
          leadId: lead.id,
          recipientEmail: request.email,
          title: "More information requested",
          body: action.message,
          createdAt: now
        }
      ];
    case "schedule_consultation":
      return [
        {
          id: idGenerator("notification"),
          type: "intake.review.consultation_scheduled",
          audience: "requester",
          requestId: request.id,
          leadId: lead.id,
          recipientEmail: request.email,
          title: "Consultation scheduled",
          body: `A consultation was scheduled for ${action.scheduledAt}.`,
          createdAt: now
        }
      ];
    case "reject":
      return [
        {
          id: idGenerator("notification"),
          type: "intake.review.rejected",
          audience: "requester",
          requestId: request.id,
          leadId: lead.id,
          recipientEmail: request.email,
          title: "Request closed",
          body: action.reason,
          createdAt: now
        }
      ];
    case "convert_to_project_draft":
      return [
        {
          id: idGenerator("notification"),
          type: "intake.review.project_draft_created",
          audience: "project_ops",
          requestId: request.id,
          leadId: lead.id,
          recipientRole: "employee",
          title: "Project draft created",
          body: `${request.projectTitle} was converted into a project draft shell.`,
          createdAt: now
        }
      ];
    case "invite_as_long_term_customer":
      return [
        {
          id: idGenerator("notification"),
          type: "intake.review.long_term_invited",
          audience: "requester",
          requestId: request.id,
          leadId: lead.id,
          recipientEmail: action.inviteEmail ?? request.email,
          title: "Long-term customer invitation",
          body: "You have been invited to continue as a long-term customer.",
          createdAt: now
        }
      ];
  }
}

export function getShortTermCustomerRestrictions(): readonly ShortTermCustomerRestriction[] {
  return SHORT_TERM_RESTRICTIONS;
}

export function getLeadPipelineLabel(status: LeadStatus): string {
  return LEAD_STATUS_LABELS[status];
}

export function getAvailableReviewActions(status: ProjectRequestStatus): readonly ProjectRequestReviewActionType[] {
  if (status === "rejected" || status === "expired" || status === "long_term_invited") {
    return [];
  }

  if (status === "submitted") {
    return [
      "start_review",
      "request_more_info",
      "schedule_consultation",
      "reject",
      "convert_to_project_draft",
      "invite_as_long_term_customer"
    ];
  }

  if (status === "project_draft_created") {
    return ["invite_as_long_term_customer"];
  }

  return ["request_more_info", "schedule_consultation", "reject", "convert_to_project_draft", "invite_as_long_term_customer"];
}

export class IntakeWorkflowService {
  private readonly repository: ProjectRequestRepository;
  private readonly auditSink?: AuditSink;
  private readonly notificationSink?: NotificationSink;
  private readonly idGenerator: (prefix: string) => string;
  private readonly organizationId: string;
  private readonly now: () => Date;

  constructor(dependencies: IntakeWorkflowDependencies) {
    this.repository = dependencies.repository;
    this.auditSink = dependencies.auditSink;
    this.notificationSink = dependencies.notificationSink;
    this.idGenerator = dependencies.idGenerator ?? defaultIdGenerator();
    this.organizationId = dependencies.organizationId ?? "org-hq";
    this.now = dependencies.now ?? (() => new Date());
  }

  listRequests(): readonly ProjectRequestRecord[] {
    return this.repository.listRequests();
  }

  listLeads(): readonly LeadRecord[] {
    return this.repository.listLeads();
  }

  getRequestDetail(requestId: string): {
    request: ProjectRequestRecord | undefined;
    lead: LeadRecord | undefined;
    availableActions: readonly ProjectRequestReviewActionType[];
  } {
    const request = this.repository.getRequestById(requestId);
    const lead = request ? this.repository.getLeadById(request.leadId) : undefined;

    return {
      request,
      lead,
      availableActions: request ? getAvailableReviewActions(request.status) : []
    };
  }

  listLeadPipelineStages(): readonly LeadPipelineStage[] {
    const counts = new Map<LeadStatus, number>();
    const orderedStatuses: readonly LeadStatus[] = [
      "new",
      "reviewing",
      "awaiting_customer",
      "consultation_scheduled",
      "converted_project_draft",
      "invited_long_term_customer",
      "expired",
      "rejected"
    ];

    for (const lead of this.repository.listLeads()) {
      counts.set(lead.status, (counts.get(lead.status) ?? 0) + 1);
    }

    return orderedStatuses.map((status) => ({
      status,
      label: LEAD_STATUS_LABELS[status],
      requestCount: counts.get(status) ?? 0
    }));
  }

  async submitPublicProjectRequest(input: PublicProjectRequestSubmissionInput): Promise<PublicSubmissionResult> {
    const issues = validatePublicProjectRequestSubmission(input);

    if (issues.length > 0) {
      throw new IntakeValidationError(issues);
    }

    const now = this.now();
    const nowIso = now.toISOString();

    const request: ProjectRequestRecord = {
      id: this.idGenerator("request"),
      leadId: this.idGenerator("lead"),
      shortTermCustomerId: this.idGenerator("short-term-customer"),
      organizationId: this.organizationId,
      customerType: "short_term",
      status: "submitted",
      submitterName: input.submitterName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim(),
      projectTitle: input.projectTitle.trim(),
      projectSummary: input.projectSummary.trim(),
      consultationPreference: input.consultationPreference,
      imageUpload: input.imageUpload,
      visibilityFlags: ["internal", "customer"],
      shortTermRestrictions: SHORT_TERM_RESTRICTIONS,
      submittedAt: nowIso,
      lastStatusChangedAt: nowIso,
      lastActivityAt: nowIso,
      shortTermExpiresAt: addDays(now, 30)
    };

    const lead: LeadRecord = {
      id: request.leadId,
      requestId: request.id,
      organizationId: request.organizationId,
      status: "new",
      pipelineLabel: LEAD_STATUS_LABELS.new,
      visibilityFlags: ["internal"],
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.repository.createRequest(request);
    this.repository.createLead(lead);

    const audits = [
      createAuditEvent(nowIso, "intake.project_request.submitted", "project_request", request.id, "public_submission", null, {
        organizationId: request.organizationId,
        customerType: request.customerType,
        consultationPreference: request.consultationPreference
      }),
      createAuditEvent(nowIso, "intake.lead.status_changed", "lead", lead.id, "public_submission", null, {
        organizationId: lead.organizationId,
        status: lead.status
      })
    ];

    const notifications = buildSubmissionNotifications(nowIso, request, lead, this.idGenerator);

    for (const audit of audits) {
      await this.auditSink?.write(audit);
    }

    for (const notification of notifications) {
      await this.notificationSink?.write(notification);
    }

    return {
      request,
      lead,
      notifications,
      audits
    };
  }

  async applyReviewAction(requestId: string, action: ProjectRequestReviewAction): Promise<ReviewActionResult> {
    const request = this.repository.getRequestById(requestId);

    if (!request) {
      throw new IntakeTransitionError(`Request ${requestId} was not found.`);
    }

    const lead = this.repository.getLeadById(request.leadId);

    if (!lead) {
      throw new IntakeTransitionError(`Lead ${request.leadId} was not found.`);
    }

    if (!statusAllowsAction(request.status, action.type)) {
      throw new IntakeTransitionError(`Action ${action.type} is not allowed from status ${request.status}.`);
    }

    const now = this.now();
    const nowIso = now.toISOString();
    const previousRequestStatus = request.status;
    const previousLeadStatus = lead.status;

    const updatedRequest: ProjectRequestRecord = {
      ...request,
      lastActivityAt: nowIso,
      lastStatusChangedAt: nowIso,
      shortTermExpiresAt: addDays(now, 30)
    };

    switch (action.type) {
      case "start_review":
        updatedRequest.status = "under_review";
        break;
      case "request_more_info":
        if (!action.message.trim()) {
          throw new IntakeTransitionError("A request-more-info action requires a message.");
        }
        updatedRequest.status = "needs_more_info";
        updatedRequest.requestedMoreInfoMessage = action.message.trim();
        break;
      case "schedule_consultation":
        if (Number.isNaN(new Date(action.scheduledAt).getTime())) {
          throw new IntakeTransitionError("A consultation must include a valid scheduled date.");
        }
        updatedRequest.status = "consultation_scheduled";
        updatedRequest.consultationScheduledAt = action.scheduledAt;
        break;
      case "reject":
        if (!action.reason.trim()) {
          throw new IntakeTransitionError("A rejection requires a reason.");
        }
        updatedRequest.status = "rejected";
        updatedRequest.rejectionReason = action.reason.trim();
        break;
      case "convert_to_project_draft":
        updatedRequest.status = "project_draft_created";
        updatedRequest.projectDraftId = updatedRequest.projectDraftId ?? this.idGenerator("project-draft");
        break;
      case "invite_as_long_term_customer":
        if (updatedRequest.customerType !== "short_term") {
          throw new IntakeTransitionError("Only short-term customers can be invited as long-term customers from intake.");
        }
        updatedRequest.status = "long_term_invited";
        updatedRequest.longTermInviteId = updatedRequest.longTermInviteId ?? this.idGenerator("invite");
        break;
    }

    const nextLeadStatus = mapRequestStatusToLeadStatus(updatedRequest.status);
    const updatedLead: LeadRecord = {
      ...lead,
      status: nextLeadStatus,
      pipelineLabel: LEAD_STATUS_LABELS[nextLeadStatus],
      updatedAt: nowIso
    };

    this.repository.updateRequest(updatedRequest);
    this.repository.updateLead(updatedLead);

    const audits = [
      createAuditEvent(nowIso, "intake.project_request.status_changed", "project_request", updatedRequest.id, action.type, action.actorUserId, {
        organizationId: updatedRequest.organizationId,
        previousStatus: previousRequestStatus,
        nextStatus: updatedRequest.status
      }),
      createAuditEvent(nowIso, "intake.lead.status_changed", "lead", updatedLead.id, action.type, action.actorUserId, {
        organizationId: updatedLead.organizationId,
        previousStatus: previousLeadStatus,
        nextStatus: updatedLead.status
      })
    ];

    const notifications = buildReviewNotifications(nowIso, updatedRequest, updatedLead, action, this.idGenerator);

    for (const audit of audits) {
      await this.auditSink?.write(audit);
    }

    for (const notification of notifications) {
      await this.notificationSink?.write(notification);
    }

    return {
      request: updatedRequest,
      lead: updatedLead,
      notifications,
      audits
    };
  }
}
