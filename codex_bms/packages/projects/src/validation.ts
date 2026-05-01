import type {
  ApprovedProjectRequestSnapshot,
  ChangeOrderStatus,
  ProjectAttachment,
  ProjectChangeRequestStatus,
  ProjectPhaseStatus,
  ProjectStatus,
  ProjectTaskStatus,
  VisibilityFlag
} from "../../types/src/index.ts";

export const MAX_PROJECT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_PROJECT_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
] as const;

const ALLOWED_APPROVED_REQUEST_STATUSES: readonly ApprovedProjectRequestSnapshot["requestStatus"][] = [
  "project_draft_created",
  "long_term_invited"
];

const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["active", "on_hold", "cancelled"],
  active: ["on_hold", "awaiting_change_order_approval", "completed", "cancelled"],
  on_hold: ["planning", "active", "cancelled"],
  awaiting_change_order_approval: ["active", "on_hold", "cancelled"],
  completed: [],
  cancelled: []
};

const PHASE_STATUS_TRANSITIONS: Record<ProjectPhaseStatus, readonly ProjectPhaseStatus[]> = {
  planned: ["in_progress", "blocked", "completed"],
  in_progress: ["blocked", "completed"],
  blocked: ["in_progress", "completed"],
  completed: []
};

const TASK_STATUS_TRANSITIONS: Record<ProjectTaskStatus, readonly ProjectTaskStatus[]> = {
  todo: ["in_progress", "blocked", "done"],
  in_progress: ["blocked", "done"],
  blocked: ["in_progress", "done"],
  done: []
};

const CHANGE_REQUEST_STATUS_TRANSITIONS: Record<ProjectChangeRequestStatus, readonly ProjectChangeRequestStatus[]> = {
  submitted: ["under_review", "approved", "rejected", "converted_change_order"],
  under_review: ["approved", "rejected", "converted_change_order"],
  approved: ["converted_change_order"],
  rejected: [],
  converted_change_order: []
};

const CHANGE_ORDER_STATUS_TRANSITIONS: Record<ChangeOrderStatus, readonly ChangeOrderStatus[]> = {
  draft: ["submitted", "rejected"],
  submitted: ["approved", "rejected"],
  approved: ["implemented"],
  rejected: [],
  implemented: []
};

export class ProjectValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super("Project validation failed.");
    this.name = "ProjectValidationError";
    this.issues = issues;
  }
}

export class ProjectTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectTransitionError";
  }
}

export function ensureApprovedProjectRequest(request: ApprovedProjectRequestSnapshot): void {
  if (!ALLOWED_APPROVED_REQUEST_STATUSES.includes(request.requestStatus)) {
    throw new ProjectTransitionError(
      `Request ${request.requestId} is not approved for project creation from status ${request.requestStatus}.`
    );
  }
}

export function validateProjectVisibilityFlags(visibilityFlags: readonly VisibilityFlag[]): readonly string[] {
  const issues: string[] = [];

  if (visibilityFlags.length === 0) {
    issues.push("At least one visibility flag is required.");
  }

  if (!visibilityFlags.includes("internal")) {
    issues.push("Project visibility must always include internal.");
  }

  return issues;
}

export function ensureVisibilitySubset(
  parentVisibilityFlags: readonly VisibilityFlag[],
  recordVisibilityFlags: readonly VisibilityFlag[],
  label: string
): void {
  const invalidFlags = recordVisibilityFlags.filter((flag) => !parentVisibilityFlags.includes(flag));

  if (invalidFlags.length > 0) {
    throw new ProjectValidationError([
      `${label} visibility contains flags not present on the project: ${invalidFlags.join(", ")}.`
    ]);
  }
}

export function validateProjectAttachments(
  attachments: readonly ProjectAttachment[],
  label: string
): readonly string[] {
  const issues: string[] = [];

  for (const attachment of attachments) {
    if (!attachment.fileName.trim()) {
      issues.push(`${label} attachments require a file name.`);
    }

    if (!ALLOWED_PROJECT_ATTACHMENT_MIME_TYPES.includes(attachment.mimeType as (typeof ALLOWED_PROJECT_ATTACHMENT_MIME_TYPES)[number])) {
      issues.push(`${label} attachments must use an allowed mime type.`);
    }

    if (!Number.isFinite(attachment.byteSize) || attachment.byteSize <= 0) {
      issues.push(`${label} attachments must include a positive byte size.`);
    }

    if (attachment.byteSize > MAX_PROJECT_ATTACHMENT_BYTES) {
      issues.push(`${label} attachments must be 10 MB or smaller.`);
    }
  }

  return issues;
}

export function ensureProjectStatusTransition(currentStatus: ProjectStatus, nextStatus: ProjectStatus): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!PROJECT_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new ProjectTransitionError(`Project status cannot move from ${currentStatus} to ${nextStatus}.`);
  }
}

export function ensurePhaseStatusTransition(currentStatus: ProjectPhaseStatus, nextStatus: ProjectPhaseStatus): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!PHASE_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new ProjectTransitionError(`Phase status cannot move from ${currentStatus} to ${nextStatus}.`);
  }
}

export function ensureTaskStatusTransition(currentStatus: ProjectTaskStatus, nextStatus: ProjectTaskStatus): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!TASK_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new ProjectTransitionError(`Task status cannot move from ${currentStatus} to ${nextStatus}.`);
  }
}

export function ensureChangeRequestStatusTransition(
  currentStatus: ProjectChangeRequestStatus,
  nextStatus: ProjectChangeRequestStatus
): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!CHANGE_REQUEST_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new ProjectTransitionError(`Change request status cannot move from ${currentStatus} to ${nextStatus}.`);
  }
}

export function ensureChangeOrderStatusTransition(
  currentStatus: ChangeOrderStatus,
  nextStatus: ChangeOrderStatus
): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!CHANGE_ORDER_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new ProjectTransitionError(`Change order status cannot move from ${currentStatus} to ${nextStatus}.`);
  }
}
