import {
  authorizeOrThrow,
  hashPublicLinkToken,
  issueSignedPublicLinkToken,
  materializeResolvedPublicLink,
  tokenPrefix,
  verifySignedPublicLinkToken
} from "../../auth/src/server/index.ts";
import type {
  AuditEvent,
  AuthorizationActor,
  ChangeOrderRecord,
  ProjectChangeRequestRecord,
  ProjectPhaseRecord,
  ProjectProgressUpdateRecord,
  ProjectPublicShareLinkRecord,
  ProjectRecord,
  ProjectTaskRecord,
  ProjectTimelineEventRecord,
  RoleKey,
  VisibilityFlag
} from "../../types/src/index.ts";
import {
  authorizeProjectMutationOrThrow,
  authorizeProjectProgressCreateOrThrow,
  authorizeProjectView,
  authorizeProjectViewOrThrow,
  toApprovedRequestResourceRecord,
  toChangeOrderResourceRecord,
  toProjectChangeRequestResourceRecord,
  toProjectResourceRecord
} from "./authorization.ts";
import type { ProjectsRuntime } from "./runtime.ts";
import type {
  CreateAssignmentInput,
  CreatePhaseInput,
  CreateProjectFromApprovedRequestInput,
  CreateTaskInput,
  ProjectDetail,
  PublishProgressUpdateInput,
  ReviewChangeRequestInput,
  SubmitCustomerChangeRequestInput,
  UpdateChangeOrderStatusInput,
  UpdateProjectStatusInput,
  UpdateProjectVisibilityInput
} from "./workflow.ts";

const ROLE_VISIBILITY_ACCESS: Record<RoleKey, readonly VisibilityFlag[]> = {
  owner: ["internal", "customer", "subcontractor", "supercontractor", "public_link"],
  administrator: ["internal", "customer", "subcontractor", "supercontractor", "public_link"],
  developer: ["internal"],
  employee: ["internal", "customer", "subcontractor", "supercontractor", "public_link"],
  applicant: [],
  customer: ["customer", "public_link"],
  subcontractor: ["subcontractor", "public_link"],
  supercontractor: ["subcontractor", "supercontractor", "public_link"]
};

function actorVisibleFlags(actor: AuthorizationActor | undefined): readonly VisibilityFlag[] {
  if (!actor) {
    return [];
  }

  return [
    ...new Set(
      actor.memberships.flatMap((membership) => ROLE_VISIBILITY_ACCESS[membership.role] ?? [])
    )
  ];
}

function filterByVisibility<T extends { visibilityFlags: readonly VisibilityFlag[] }>(
  records: readonly T[],
  allowedFlags: readonly VisibilityFlag[]
): readonly T[] {
  return records.filter((record) => record.visibilityFlags.some((flag) => allowedFlags.includes(flag)));
}

function buildPublicLinkAuditEvent(
  eventType: AuditEvent["eventType"],
  projectId: string,
  occurredAt: string,
  actorUserId?: string | null,
  metadata?: Record<string, unknown>
): AuditEvent {
  return {
    eventType,
    outcome: eventType === "public_link.issue" ? "issued" : eventType === "public_link.revoke" ? "revoked" : "success",
    actorUserId: actorUserId ?? null,
    resourceType: "project",
    resourceId: projectId,
    viaPublicLink: eventType === "public_link.access",
    sensitive: true,
    occurredAt,
    metadata
  };
}

export async function listVisibleProjectsForActor(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly ProjectRecord[]> {
  const projects = runtime.service.listProjects();
  const visible: ProjectRecord[] = [];

  for (const project of projects) {
    const decision = await authorizeProjectView(actor, project, runtime.auditSink);

    if (decision.allowed) {
      visible.push(project);
    }
  }

  return visible;
}

export async function getProjectDetailForActor(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  projectId: string
): Promise<ProjectDetail | undefined> {
  const detail = runtime.service.getProjectDetail(projectId);

  if (!detail.project) {
    return undefined;
  }

  await authorizeProjectViewOrThrow(actor, detail.project, runtime.auditSink);

  const allowedFlags = actorVisibleFlags(actor);

  return {
    project: detail.project,
    phases: filterByVisibility(detail.phases, allowedFlags),
    tasks: filterByVisibility(detail.tasks, allowedFlags),
    assignments: detail.assignments,
    progressUpdates: filterByVisibility(detail.progressUpdates, allowedFlags),
    changeRequests: filterByVisibility(detail.changeRequests, allowedFlags),
    changeOrders: filterByVisibility(detail.changeOrders, allowedFlags),
    timeline: filterByVisibility(detail.timeline, allowedFlags),
    publicShareLinks: detail.publicShareLinks
  };
}

export async function createProjectFromApprovedRequestServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateProjectFromApprovedRequestInput
): Promise<ProjectRecord> {
  await authorizeProjectMutationOrThrow(
    actor,
    "project.create.org",
    toApprovedRequestResourceRecord(input.request),
    runtime.auditSink
  );

  return runtime.service.createProjectFromApprovedRequest(input);
}

export async function createPhaseServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreatePhaseInput
): Promise<ProjectPhaseRecord> {
  const project = runtime.repository.getProjectById(input.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${input.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(actor, "project.phase.manage.org", toProjectResourceRecord(project), runtime.auditSink);
  return runtime.service.createPhase(input);
}

export async function createTaskServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateTaskInput
): Promise<ProjectTaskRecord> {
  const project = runtime.repository.getProjectById(input.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${input.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(actor, "project.task.manage.org", toProjectResourceRecord(project), runtime.auditSink);
  return runtime.service.createTask(input);
}

export async function assignProjectParticipantServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateAssignmentInput
) {
  const project = runtime.repository.getProjectById(input.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${input.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(actor, "project.assign.org", toProjectResourceRecord(project), runtime.auditSink);
  return runtime.service.assignParticipant(input);
}

export async function publishProjectProgressUpdateServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: PublishProgressUpdateInput
): Promise<ProjectProgressUpdateRecord> {
  const project = runtime.repository.getProjectById(input.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${input.projectId} was not found.`));
  }

  await authorizeProjectProgressCreateOrThrow(actor, project, runtime.auditSink);
  return runtime.service.publishProgressUpdate(input);
}

export async function submitProjectChangeRequestServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: SubmitCustomerChangeRequestInput
): Promise<ProjectChangeRequestRecord> {
  const project = runtime.repository.getProjectById(input.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${input.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(
    actor,
    "project.change_request.create.self",
    toProjectResourceRecord(project),
    runtime.auditSink
  );

  return runtime.service.submitCustomerChangeRequest(input);
}

export async function reviewProjectChangeRequestServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: ReviewChangeRequestInput
) {
  const changeRequest = runtime.repository.getChangeRequestById(input.changeRequestId);

  if (!changeRequest) {
    return Promise.reject(new Error(`Change request ${input.changeRequestId} was not found.`));
  }

  const project = runtime.repository.getProjectById(changeRequest.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${changeRequest.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(
    actor,
    "project.change_order.review.org",
    toProjectChangeRequestResourceRecord(project, changeRequest),
    runtime.auditSink
  );

  return runtime.service.reviewChangeRequest(input);
}

export async function updateProjectStatusServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateProjectStatusInput
): Promise<ProjectRecord> {
  const project = runtime.repository.getProjectById(input.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${input.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(actor, "project.status.manage.org", toProjectResourceRecord(project), runtime.auditSink);
  return runtime.service.updateProjectStatus(input);
}

export async function updateProjectVisibilityServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateProjectVisibilityInput
): Promise<ProjectRecord> {
  const project = runtime.repository.getProjectById(input.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${input.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(actor, "project.visibility.manage.org", toProjectResourceRecord(project), runtime.auditSink);
  return runtime.service.updateProjectVisibility(input);
}

export async function updateChangeOrderStatusServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateChangeOrderStatusInput
): Promise<ChangeOrderRecord> {
  const changeOrder = runtime.repository.getChangeOrderById(input.changeOrderId);

  if (!changeOrder) {
    return Promise.reject(new Error(`Change order ${input.changeOrderId} was not found.`));
  }

  const project = runtime.repository.getProjectById(changeOrder.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${changeOrder.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(
    actor,
    "project.change_order.review.org",
    toChangeOrderResourceRecord(project, changeOrder),
    runtime.auditSink
  );

  return runtime.service.updateChangeOrderStatus(input);
}

export async function respondToCustomerChangeOrderServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: {
    changeOrderId: string;
    actorUserId: string;
    status: "approved" | "rejected";
  }
): Promise<ChangeOrderRecord> {
  const changeOrder = runtime.repository.getChangeOrderById(input.changeOrderId);

  if (!changeOrder) {
    return Promise.reject(new Error(`Change order ${input.changeOrderId} was not found.`));
  }

  const project = runtime.repository.getProjectById(changeOrder.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${changeOrder.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(
    actor,
    "project.change_order.approve.self",
    toChangeOrderResourceRecord(project, changeOrder),
    runtime.auditSink
  );

  return runtime.service.updateChangeOrderStatus(input);
}

export async function issueProjectPublicLinkServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: {
    projectId: string;
    actorUserId: string;
    expiresAt: string;
    maxUses?: number | null;
    approvalId?: string;
  }
): Promise<{ link: ProjectPublicShareLinkRecord; token: string }> {
  const project = runtime.repository.getProjectById(input.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${input.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(actor, "public_link.issue.org", toProjectResourceRecord(project), runtime.auditSink);
  await runtime.security.approvals.assertApproved({
    approvalId: input.approvalId,
    actionKey: "public_link.issue",
    actorUserId: input.actorUserId,
    resourceType: "project",
    resourceId: project.id,
    now: runtime.now()
  });

  if (!project.visibilityFlags.includes("public_link")) {
    return Promise.reject(new Error("Project visibility must include public_link before issuing a public share."));
  }

  const occurredAt = runtime.now().toISOString();
  const linkId = `project-link-${hashPublicLinkToken(`${project.id}:${input.expiresAt}:${occurredAt}`).slice(0, 12)}`;
  const payload = {
    linkId,
    resourceType: "project",
    resourceId: project.id,
    permissionKeys: ["project.view.public_link"] as const,
    expiresAt: input.expiresAt,
    nonce: hashPublicLinkToken(`${project.id}:${input.actorUserId}:${occurredAt}`).slice(0, 24),
    issuedAt: occurredAt
  };
  const token = issueSignedPublicLinkToken(payload, runtime.publicLinkSecret, {
    auditSink: runtime.auditSink,
    logger: runtime.security.logger,
    monitoringHook: runtime.security.monitoringHook,
    resourceType: "project",
    resourceId: project.id
  });
  const link: ProjectPublicShareLinkRecord = {
    id: linkId,
    projectId: project.id,
    permissionKeys: payload.permissionKeys,
    tokenHash: hashPublicLinkToken(token),
    tokenPrefix: tokenPrefix(token),
    expiresAt: input.expiresAt,
    revokedAt: null,
    maxUses: input.maxUses ?? null,
    useCount: 0,
    createdByUserId: input.actorUserId,
    createdAt: occurredAt
  };

  runtime.repository.createPublicShareLink(link);
  runtime.repository.createTimelineEvent({
    id: `timeline-${link.id}`,
    projectId: project.id,
    eventType: "public_link_issued",
    actorUserId: input.actorUserId,
    summary: "Signed public project link issued.",
    visibilityFlags: ["internal"],
    occurredAt
  });
  runtime.auditSink.write(
    buildPublicLinkAuditEvent("public_link.issue", project.id, occurredAt, input.actorUserId, {
      linkId,
      expiresAt: input.expiresAt
    })
  );

  return { link, token };
}

export async function revokeProjectPublicLinkServer(
  runtime: ProjectsRuntime,
  actor: AuthorizationActor | undefined,
  input: {
    linkId: string;
    actorUserId: string;
  }
) {
  const link = runtime.repository.getPublicShareLinkById(input.linkId);

  if (!link) {
    return Promise.reject(new Error(`Public link ${input.linkId} was not found.`));
  }

  const project = runtime.repository.getProjectById(link.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${link.projectId} was not found.`));
  }

  await authorizeProjectMutationOrThrow(actor, "public_link.revoke.org", toProjectResourceRecord(project), runtime.auditSink);
  const occurredAt = runtime.now().toISOString();
  const updatedLink = {
    ...link,
    revokedAt: occurredAt
  };
  runtime.repository.updatePublicShareLink(updatedLink);
  runtime.repository.createTimelineEvent({
    id: `timeline-revoke-${link.id}`,
    projectId: project.id,
    eventType: "public_link_revoked",
    actorUserId: input.actorUserId,
    summary: "Signed public project link revoked.",
    visibilityFlags: ["internal"],
    occurredAt
  });
  runtime.auditSink.write(
    buildPublicLinkAuditEvent("public_link.revoke", project.id, occurredAt, input.actorUserId, {
      linkId: link.id
    })
  );

  return updatedLink;
}

export async function viewProjectViaPublicLinkServer(
  runtime: ProjectsRuntime,
  token: string,
  now = new Date()
): Promise<{
  project: ProjectRecord;
  phases: readonly ProjectPhaseRecord[];
  tasks: readonly ProjectTaskRecord[];
  progressUpdates: readonly ProjectProgressUpdateRecord[];
  timeline: readonly ProjectTimelineEventRecord[];
}> {
  const verified = verifySignedPublicLinkToken(token, runtime.publicLinkSecret, now, {
    auditSink: runtime.auditSink,
    logger: runtime.security.logger,
    monitoringHook: runtime.security.monitoringHook,
    resourceType: "project"
  });

  if (!verified.valid || !verified.payload) {
    return Promise.reject(new Error(`Public link token is invalid: ${verified.reason ?? "unknown"}.`));
  }

  const link = runtime.repository.getPublicShareLinkById(verified.payload.linkId);

  if (!link || link.tokenHash !== hashPublicLinkToken(token)) {
    return Promise.reject(new Error("Public link record was not found."));
  }

  const project = runtime.repository.getProjectById(link.projectId);

  if (!project) {
    return Promise.reject(new Error(`Project ${link.projectId} was not found.`));
  }

  const resolvedPublicLink = materializeResolvedPublicLink({
    id: link.id,
    resourceType: "project",
    resourceId: project.id,
    permissionKeys: link.permissionKeys,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    maxUses: link.maxUses,
    useCount: link.useCount
  });

  await authorizeOrThrow(
    {
      permissionKey: "project.view.public_link",
      record: toProjectResourceRecord(project),
      publicLink: resolvedPublicLink,
      now
    },
    runtime.auditSink
  );

  const updatedLink = {
    ...link,
    useCount: link.useCount + 1
  };
  runtime.repository.updatePublicShareLink(updatedLink);
  const occurredAt = now.toISOString();
  runtime.repository.createTimelineEvent({
    id: `timeline-access-${link.id}-${updatedLink.useCount}`,
    projectId: project.id,
    eventType: "public_link_viewed",
    summary: "Project viewed through a signed public link.",
    visibilityFlags: ["internal"],
    occurredAt
  });
  runtime.auditSink.write(
    buildPublicLinkAuditEvent("public_link.access", project.id, occurredAt, null, {
      linkId: link.id,
      useCount: updatedLink.useCount
    })
  );

  const publicFlags: readonly VisibilityFlag[] = ["public_link"];
  const detail = runtime.service.getProjectDetail(project.id);

  return {
    project,
    phases: filterByVisibility(detail.phases, publicFlags),
    tasks: filterByVisibility(detail.tasks, publicFlags),
    progressUpdates: filterByVisibility(detail.progressUpdates, publicFlags),
    timeline: filterByVisibility(detail.timeline, publicFlags)
  };
}
