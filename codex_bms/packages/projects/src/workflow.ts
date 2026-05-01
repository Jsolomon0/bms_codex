import type {
  ApprovedProjectRequestSnapshot,
  AuditEvent,
  AuditSink,
  ChangeOrderRecord,
  ChangeOrderStatus,
  ProjectAssignmentRecord,
  ProjectAttachment,
  ProjectChangeRequestRecord,
  ProjectChangeRequestStatus,
  ProjectPhaseRecord,
  ProjectPhaseStatus,
  ProjectProgressUpdateRecord,
  ProjectPublicShareLinkRecord,
  ProjectRecord,
  ProjectRepository,
  ProjectStatus,
  ProjectTaskRecord,
  ProjectTaskStatus,
  ProjectTimelineEventRecord,
  VisibilityFlag
} from "../../types/src/index.ts";
import {
  ensureApprovedProjectRequest,
  ensureChangeOrderStatusTransition,
  ensureChangeRequestStatusTransition,
  ensurePhaseStatusTransition,
  ensureProjectStatusTransition,
  ensureTaskStatusTransition,
  ensureVisibilitySubset,
  ProjectTransitionError,
  ProjectValidationError,
  validateProjectAttachments,
  validateProjectVisibilityFlags
} from "./validation.ts";

function defaultIdGenerator() {
  let counter = 0;
  return (prefix: string) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(Boolean))];
}

function addTimelineEvent(
  repository: ProjectRepository,
  idGenerator: (prefix: string) => string,
  event: Omit<ProjectTimelineEventRecord, "id">
): ProjectTimelineEventRecord {
  const record: ProjectTimelineEventRecord = {
    id: idGenerator("project-timeline"),
    ...event
  };
  repository.createTimelineEvent(record);
  return record;
}

function createAuditEvent(
  occurredAt: string,
  eventType: AuditEvent["eventType"],
  resourceType: string,
  resourceId: string,
  actorUserId: string | null,
  metadata?: Record<string, unknown>
): AuditEvent {
  return {
    eventType,
    outcome: "success",
    actorUserId,
    resourceType,
    resourceId,
    viaPublicLink: false,
    sensitive: true,
    occurredAt,
    metadata
  };
}

export interface ProjectWorkflowDependencies {
  repository: ProjectRepository;
  auditSink?: AuditSink;
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
}

export interface CreateProjectFromApprovedRequestInput {
  request: ApprovedProjectRequestSnapshot;
  actorUserId: string;
  ownerUserId: string;
  customerAccountId?: string;
  partnerOrgIds?: readonly string[];
  assignedUserIds?: readonly string[];
  name?: string;
  description?: string;
  visibilityFlags?: readonly VisibilityFlag[];
}

export interface CreatePhaseInput {
  projectId: string;
  actorUserId: string;
  name: string;
  description?: string;
  sequence: number;
  visibilityFlags?: readonly VisibilityFlag[];
}

export interface CreateTaskInput {
  projectId: string;
  phaseId: string;
  actorUserId: string;
  title: string;
  description?: string;
  visibilityFlags?: readonly VisibilityFlag[];
  dueAt?: string;
  attachments?: readonly ProjectAttachment[];
}

export interface CreateAssignmentInput {
  projectId: string;
  actorUserId: string;
  target: ProjectAssignmentRecord["target"];
  userId?: string;
  partnerOrgId?: string;
  taskId?: string;
  notes?: string;
}

export interface PublishProgressUpdateInput {
  projectId: string;
  actorUserId: string;
  note: string;
  visibilityFlags: readonly VisibilityFlag[];
  attachments?: readonly ProjectAttachment[];
}

export interface SubmitCustomerChangeRequestInput {
  projectId: string;
  requesterUserId: string;
  title: string;
  description: string;
  attachments?: readonly ProjectAttachment[];
}

export interface ReviewChangeRequestInput {
  changeRequestId: string;
  actorUserId: string;
  action: "start_review" | "approve" | "reject" | "convert_to_change_order";
  changeOrderTitle?: string;
  changeOrderDescription?: string;
  estimatedAmountDelta?: number;
  estimatedScheduleDeltaDays?: number;
  attachments?: readonly ProjectAttachment[];
}

export interface UpdateProjectStatusInput {
  projectId: string;
  actorUserId: string;
  status: ProjectStatus;
}

export interface UpdateProjectVisibilityInput {
  projectId: string;
  actorUserId: string;
  visibilityFlags: readonly VisibilityFlag[];
}

export interface UpdatePhaseStatusInput {
  phaseId: string;
  actorUserId: string;
  status: ProjectPhaseStatus;
}

export interface UpdateTaskStatusInput {
  taskId: string;
  actorUserId: string;
  status: ProjectTaskStatus;
}

export interface UpdateChangeOrderStatusInput {
  changeOrderId: string;
  actorUserId: string;
  status: ChangeOrderStatus;
}

export interface ProjectDetail {
  project?: ProjectRecord;
  phases: readonly ProjectPhaseRecord[];
  tasks: readonly ProjectTaskRecord[];
  assignments: readonly ProjectAssignmentRecord[];
  progressUpdates: readonly ProjectProgressUpdateRecord[];
  changeRequests: readonly ProjectChangeRequestRecord[];
  changeOrders: readonly ChangeOrderRecord[];
  timeline: readonly ProjectTimelineEventRecord[];
  publicShareLinks: readonly ProjectPublicShareLinkRecord[];
}

export class ProjectManagementService {
  private readonly repository: ProjectRepository;
  private readonly auditSink?: AuditSink;
  private readonly idGenerator: (prefix: string) => string;
  private readonly now: () => Date;

  constructor(dependencies: ProjectWorkflowDependencies) {
    this.repository = dependencies.repository;
    this.auditSink = dependencies.auditSink;
    this.idGenerator = dependencies.idGenerator ?? defaultIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  listProjects(): readonly ProjectRecord[] {
    return this.repository.listProjects();
  }

  getProjectDetail(projectId: string): ProjectDetail {
    return {
      project: this.repository.getProjectById(projectId),
      phases: this.repository.listPhasesByProjectId(projectId),
      tasks: this.repository.listTasksByProjectId(projectId),
      assignments: this.repository.listAssignmentsByProjectId(projectId),
      progressUpdates: this.repository.listProgressUpdatesByProjectId(projectId),
      changeRequests: this.repository.listChangeRequestsByProjectId(projectId),
      changeOrders: this.repository.listChangeOrdersByProjectId(projectId),
      timeline: this.repository.listTimelineEventsByProjectId(projectId),
      publicShareLinks: this.repository.listPublicShareLinksByProjectId(projectId)
    };
  }

  private async writeAudits(audits: readonly AuditEvent[]): Promise<void> {
    for (const audit of audits) {
      await this.auditSink?.write(audit);
    }
  }

  async createProjectFromApprovedRequest(input: CreateProjectFromApprovedRequestInput): Promise<ProjectRecord> {
    ensureApprovedProjectRequest(input.request);
    const visibilityFlags = dedupeStrings(input.visibilityFlags ?? ["internal", "customer"]) as readonly VisibilityFlag[];
    const visibilityIssues = validateProjectVisibilityFlags(visibilityFlags);

    if (visibilityIssues.length > 0) {
      throw new ProjectValidationError(visibilityIssues);
    }

    const nowIso = this.now().toISOString();
    const project: ProjectRecord = {
      id: this.idGenerator("project"),
      organizationId: input.request.organizationId,
      sourceRequestId: input.request.requestId,
      sourceRequestStatus: input.request.requestStatus,
      ownerUserId: input.ownerUserId,
      customerAccountId: input.customerAccountId,
      partnerOrgIds: dedupeStrings(input.partnerOrgIds ?? []),
      name: input.name?.trim() || input.request.projectTitle.trim(),
      description: input.description?.trim() || input.request.projectSummary.trim(),
      status: "draft",
      visibilityFlags,
      assignedUserIds: dedupeStrings(input.assignedUserIds ?? []),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.repository.createProject(project);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "project_created",
      actorUserId: input.actorUserId,
      summary: `Project ${project.name} created from approved request ${input.request.requestId}.`,
      visibilityFlags: project.visibilityFlags,
      occurredAt: nowIso,
      metadata: {
        sourceRequestStatus: input.request.requestStatus
      }
    });

    await this.writeAudits([
      createAuditEvent(nowIso, "project.created", "project", project.id, input.actorUserId, {
        sourceRequestId: project.sourceRequestId,
        visibilityFlags: project.visibilityFlags
      })
    ]);

    return project;
  }

  async createPhase(input: CreatePhaseInput): Promise<ProjectPhaseRecord> {
    const project = this.repository.getProjectById(input.projectId);

    if (!project) {
      throw new ProjectTransitionError(`Project ${input.projectId} was not found.`);
    }

    const visibilityFlags = dedupeStrings(input.visibilityFlags ?? project.visibilityFlags) as readonly VisibilityFlag[];
    ensureVisibilitySubset(project.visibilityFlags, visibilityFlags, "Phase");
    const nowIso = this.now().toISOString();
    const phase: ProjectPhaseRecord = {
      id: this.idGenerator("project-phase"),
      projectId: project.id,
      name: input.name.trim(),
      description: input.description?.trim(),
      sequence: input.sequence,
      status: "planned",
      visibilityFlags,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.repository.createPhase(phase);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "phase_created",
      actorUserId: input.actorUserId,
      summary: `Phase ${phase.name} created.`,
      visibilityFlags: phase.visibilityFlags,
      occurredAt: nowIso
    });

    return phase;
  }

  async createTask(input: CreateTaskInput): Promise<ProjectTaskRecord> {
    const project = this.repository.getProjectById(input.projectId);
    const phase = this.repository.getPhaseById(input.phaseId);

    if (!project || !phase || phase.projectId !== input.projectId) {
      throw new ProjectTransitionError("Task creation requires a valid project and phase.");
    }

    const attachments = input.attachments ?? [];
    const issues = validateProjectAttachments(attachments, "Task");

    if (issues.length > 0) {
      throw new ProjectValidationError(issues);
    }

    const visibilityFlags = dedupeStrings(input.visibilityFlags ?? phase.visibilityFlags) as readonly VisibilityFlag[];
    ensureVisibilitySubset(project.visibilityFlags, visibilityFlags, "Task");
    const nowIso = this.now().toISOString();
    const task: ProjectTaskRecord = {
      id: this.idGenerator("project-task"),
      projectId: project.id,
      phaseId: phase.id,
      title: input.title.trim(),
      description: input.description?.trim(),
      status: "todo",
      visibilityFlags,
      assignedUserIds: [],
      partnerOrgIds: [],
      attachments,
      dueAt: input.dueAt,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.repository.createTask(task);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "task_created",
      actorUserId: input.actorUserId,
      summary: `Task ${task.title} created in phase ${phase.name}.`,
      visibilityFlags: task.visibilityFlags,
      occurredAt: nowIso
    });

    return task;
  }

  async assignParticipant(input: CreateAssignmentInput): Promise<ProjectAssignmentRecord> {
    const project = this.repository.getProjectById(input.projectId);

    if (!project) {
      throw new ProjectTransitionError(`Project ${input.projectId} was not found.`);
    }

    const task = input.taskId ? this.repository.getTaskById(input.taskId) : undefined;

    if (input.taskId && (!task || task.projectId !== project.id)) {
      throw new ProjectTransitionError(`Task ${input.taskId} was not found for project ${project.id}.`);
    }

    if ((input.target === "employee" && !input.userId) || (input.target !== "employee" && !input.partnerOrgId)) {
      throw new ProjectValidationError(["Assignments require a user id for employees or a partner org id for partner roles."]);
    }

    const nowIso = this.now().toISOString();
    const assignment: ProjectAssignmentRecord = {
      id: this.idGenerator("project-assignment"),
      projectId: project.id,
      taskId: input.taskId,
      target: input.target,
      userId: input.userId,
      partnerOrgId: input.partnerOrgId,
      assignedByUserId: input.actorUserId,
      notes: input.notes?.trim(),
      createdAt: nowIso
    };

    this.repository.createAssignment(assignment);

    if (task) {
      const updatedTask: ProjectTaskRecord = {
        ...task,
        assignedUserIds: dedupeStrings(task.assignedUserIds.concat(input.userId ? [input.userId] : [])),
        partnerOrgIds: dedupeStrings(task.partnerOrgIds.concat(input.partnerOrgId ? [input.partnerOrgId] : [])),
        updatedAt: nowIso
      };
      this.repository.updateTask(updatedTask);
    } else {
      const updatedProject: ProjectRecord = {
        ...project,
        assignedUserIds: dedupeStrings(project.assignedUserIds.concat(input.userId ? [input.userId] : [])),
        partnerOrgIds: dedupeStrings(project.partnerOrgIds.concat(input.partnerOrgId ? [input.partnerOrgId] : [])),
        updatedAt: nowIso
      };
      this.repository.updateProject(updatedProject);
    }

    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "assignment_created",
      actorUserId: input.actorUserId,
      summary: input.userId
        ? `Assigned ${input.target} ${input.userId}${task ? ` to task ${task.title}` : " to the project"}.`
        : `Assigned ${input.target} organization ${input.partnerOrgId}${task ? ` to task ${task?.title}` : " to the project"}.`,
      visibilityFlags: project.visibilityFlags,
      occurredAt: nowIso
    });

    return assignment;
  }

  async publishProgressUpdate(input: PublishProgressUpdateInput): Promise<ProjectProgressUpdateRecord> {
    const project = this.repository.getProjectById(input.projectId);

    if (!project) {
      throw new ProjectTransitionError(`Project ${input.projectId} was not found.`);
    }

    const attachments = input.attachments ?? [];
    const issues = [...validateProjectAttachments(attachments, "Progress update")];

    if (!input.note.trim()) {
      issues.push("Progress updates require a note.");
    }

    if (issues.length > 0) {
      throw new ProjectValidationError(issues);
    }

    ensureVisibilitySubset(project.visibilityFlags, input.visibilityFlags, "Progress update");
    const nowIso = this.now().toISOString();
    const update: ProjectProgressUpdateRecord = {
      id: this.idGenerator("project-update"),
      projectId: project.id,
      authorUserId: input.actorUserId,
      note: input.note.trim(),
      visibilityFlags: dedupeStrings(input.visibilityFlags) as readonly VisibilityFlag[],
      attachments,
      createdAt: nowIso
    };

    this.repository.createProgressUpdate(update);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "progress_update_published",
      actorUserId: input.actorUserId,
      summary: "Progress update published.",
      visibilityFlags: update.visibilityFlags,
      occurredAt: nowIso
    });

    return update;
  }

  async submitCustomerChangeRequest(input: SubmitCustomerChangeRequestInput): Promise<ProjectChangeRequestRecord> {
    const project = this.repository.getProjectById(input.projectId);

    if (!project) {
      throw new ProjectTransitionError(`Project ${input.projectId} was not found.`);
    }

    const attachments = input.attachments ?? [];
    const issues = [...validateProjectAttachments(attachments, "Change request")];

    if (!input.title.trim()) {
      issues.push("Change requests require a title.");
    }

    if (!input.description.trim()) {
      issues.push("Change requests require a description.");
    }

    if (issues.length > 0) {
      throw new ProjectValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const changeRequest: ProjectChangeRequestRecord = {
      id: this.idGenerator("project-change-request"),
      projectId: project.id,
      requesterUserId: input.requesterUserId,
      requesterRole: "customer",
      title: input.title.trim(),
      description: input.description.trim(),
      status: "submitted",
      visibilityFlags: ["internal", "customer"],
      attachments,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.repository.createChangeRequest(changeRequest);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "change_request_submitted",
      actorUserId: input.requesterUserId,
      summary: `Customer change request ${changeRequest.title} submitted.`,
      visibilityFlags: changeRequest.visibilityFlags,
      occurredAt: nowIso
    });

    return changeRequest;
  }

  async reviewChangeRequest(input: ReviewChangeRequestInput): Promise<{
    changeRequest: ProjectChangeRequestRecord;
    changeOrder?: ChangeOrderRecord;
  }> {
    const changeRequest = this.repository.getChangeRequestById(input.changeRequestId);

    if (!changeRequest) {
      throw new ProjectTransitionError(`Change request ${input.changeRequestId} was not found.`);
    }

    const project = this.repository.getProjectById(changeRequest.projectId);

    if (!project) {
      throw new ProjectTransitionError(`Project ${changeRequest.projectId} was not found.`);
    }

    const nowIso = this.now().toISOString();
    let nextStatus: ProjectChangeRequestStatus = changeRequest.status;

    switch (input.action) {
      case "start_review":
        nextStatus = "under_review";
        break;
      case "approve":
        nextStatus = "approved";
        break;
      case "reject":
        nextStatus = "rejected";
        break;
      case "convert_to_change_order":
        nextStatus = "converted_change_order";
        break;
    }

    ensureChangeRequestStatusTransition(changeRequest.status, nextStatus);

    const updatedChangeRequest: ProjectChangeRequestRecord = {
      ...changeRequest,
      status: nextStatus,
      updatedAt: nowIso
    };
    this.repository.updateChangeRequest(updatedChangeRequest);

    let changeOrder: ChangeOrderRecord | undefined;

    if (input.action === "convert_to_change_order") {
      const attachments = input.attachments ?? updatedChangeRequest.attachments;
      const issues = validateProjectAttachments(attachments, "Change order");

      if (issues.length > 0) {
        throw new ProjectValidationError(issues);
      }

      changeOrder = {
        id: this.idGenerator("change-order"),
        projectId: project.id,
        sourceChangeRequestId: updatedChangeRequest.id,
        title: input.changeOrderTitle?.trim() || updatedChangeRequest.title,
        description: input.changeOrderDescription?.trim() || updatedChangeRequest.description,
        status: "draft",
        visibilityFlags: ["internal", "customer"],
        attachments,
        estimatedAmountDelta: input.estimatedAmountDelta,
        estimatedScheduleDeltaDays: input.estimatedScheduleDeltaDays,
        createdByUserId: input.actorUserId,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      this.repository.createChangeOrder(changeOrder);

      if (project.status === "active") {
        const updatedProject: ProjectRecord = {
          ...project,
          status: "awaiting_change_order_approval",
          updatedAt: nowIso
        };
        this.repository.updateProject(updatedProject);
        addTimelineEvent(this.repository, this.idGenerator, {
          projectId: project.id,
          eventType: "project_status_changed",
          actorUserId: input.actorUserId,
          summary: "Project moved to awaiting change-order approval.",
          visibilityFlags: updatedProject.visibilityFlags,
          occurredAt: nowIso,
          metadata: {
            previousStatus: project.status,
            nextStatus: updatedProject.status
          }
        });

        await this.writeAudits([
          createAuditEvent(nowIso, "project.status_changed", "project", project.id, input.actorUserId, {
            previousStatus: project.status,
            nextStatus: updatedProject.status
          })
        ]);
      }
    }

    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "change_request_status_changed",
      actorUserId: input.actorUserId,
      summary: `Change request ${updatedChangeRequest.title} moved to ${updatedChangeRequest.status}.`,
      visibilityFlags: updatedChangeRequest.visibilityFlags,
      occurredAt: nowIso
    });

    await this.writeAudits([
      createAuditEvent(nowIso, "project.change_request.status_changed", "project_change_request", updatedChangeRequest.id, input.actorUserId, {
        previousStatus: changeRequest.status,
        nextStatus: updatedChangeRequest.status
      })
    ]);

    return {
      changeRequest: updatedChangeRequest,
      changeOrder
    };
  }

  async updateProjectStatus(input: UpdateProjectStatusInput): Promise<ProjectRecord> {
    const project = this.repository.getProjectById(input.projectId);

    if (!project) {
      throw new ProjectTransitionError(`Project ${input.projectId} was not found.`);
    }

    ensureProjectStatusTransition(project.status, input.status);
    const nowIso = this.now().toISOString();
    const updatedProject: ProjectRecord = {
      ...project,
      status: input.status,
      updatedAt: nowIso,
      startedAt: input.status === "active" && !project.startedAt ? nowIso : project.startedAt,
      completedAt: input.status === "completed" ? nowIso : project.completedAt
    };

    this.repository.updateProject(updatedProject);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "project_status_changed",
      actorUserId: input.actorUserId,
      summary: `Project status changed from ${project.status} to ${updatedProject.status}.`,
      visibilityFlags: updatedProject.visibilityFlags,
      occurredAt: nowIso
    });

    await this.writeAudits([
      createAuditEvent(nowIso, "project.status_changed", "project", project.id, input.actorUserId, {
        previousStatus: project.status,
        nextStatus: updatedProject.status
      })
    ]);

    return updatedProject;
  }

  async updateProjectVisibility(input: UpdateProjectVisibilityInput): Promise<ProjectRecord> {
    const project = this.repository.getProjectById(input.projectId);

    if (!project) {
      throw new ProjectTransitionError(`Project ${input.projectId} was not found.`);
    }

    const visibilityFlags = dedupeStrings(input.visibilityFlags) as readonly VisibilityFlag[];
    const issues = validateProjectVisibilityFlags(visibilityFlags);

    if (issues.length > 0) {
      throw new ProjectValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const updatedProject: ProjectRecord = {
      ...project,
      visibilityFlags,
      updatedAt: nowIso
    };

    this.repository.updateProject(updatedProject);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: project.id,
      eventType: "project_visibility_changed",
      actorUserId: input.actorUserId,
      summary: `Project visibility changed to ${visibilityFlags.join(", ")}.`,
      visibilityFlags: updatedProject.visibilityFlags,
      occurredAt: nowIso
    });

    await this.writeAudits([
      createAuditEvent(nowIso, "project.visibility_changed", "project", project.id, input.actorUserId, {
        previousVisibilityFlags: project.visibilityFlags,
        nextVisibilityFlags: updatedProject.visibilityFlags
      })
    ]);

    return updatedProject;
  }

  async updatePhaseStatus(input: UpdatePhaseStatusInput): Promise<ProjectPhaseRecord> {
    const phase = this.repository.getPhaseById(input.phaseId);

    if (!phase) {
      throw new ProjectTransitionError(`Phase ${input.phaseId} was not found.`);
    }

    ensurePhaseStatusTransition(phase.status, input.status);
    const nowIso = this.now().toISOString();
    const updatedPhase: ProjectPhaseRecord = {
      ...phase,
      status: input.status,
      updatedAt: nowIso
    };

    this.repository.updatePhase(updatedPhase);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: phase.projectId,
      eventType: "phase_status_changed",
      actorUserId: input.actorUserId,
      summary: `Phase ${phase.name} moved to ${updatedPhase.status}.`,
      visibilityFlags: phase.visibilityFlags,
      occurredAt: nowIso
    });

    await this.writeAudits([
      createAuditEvent(nowIso, "project.phase.status_changed", "project_phase", phase.id, input.actorUserId, {
        previousStatus: phase.status,
        nextStatus: updatedPhase.status
      })
    ]);

    return updatedPhase;
  }

  async updateTaskStatus(input: UpdateTaskStatusInput): Promise<ProjectTaskRecord> {
    const task = this.repository.getTaskById(input.taskId);

    if (!task) {
      throw new ProjectTransitionError(`Task ${input.taskId} was not found.`);
    }

    ensureTaskStatusTransition(task.status, input.status);
    const nowIso = this.now().toISOString();
    const updatedTask: ProjectTaskRecord = {
      ...task,
      status: input.status,
      updatedAt: nowIso,
      completedAt: input.status === "done" ? nowIso : task.completedAt
    };

    this.repository.updateTask(updatedTask);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: task.projectId,
      eventType: "task_status_changed",
      actorUserId: input.actorUserId,
      summary: `Task ${task.title} moved to ${updatedTask.status}.`,
      visibilityFlags: task.visibilityFlags,
      occurredAt: nowIso
    });

    await this.writeAudits([
      createAuditEvent(nowIso, "project.task.status_changed", "project_task", task.id, input.actorUserId, {
        previousStatus: task.status,
        nextStatus: updatedTask.status
      })
    ]);

    return updatedTask;
  }

  async updateChangeOrderStatus(input: UpdateChangeOrderStatusInput): Promise<ChangeOrderRecord> {
    const changeOrder = this.repository.getChangeOrderById(input.changeOrderId);

    if (!changeOrder) {
      throw new ProjectTransitionError(`Change order ${input.changeOrderId} was not found.`);
    }

    ensureChangeOrderStatusTransition(changeOrder.status, input.status);
    const nowIso = this.now().toISOString();
    const updatedChangeOrder: ChangeOrderRecord = {
      ...changeOrder,
      status: input.status,
      updatedAt: nowIso
    };

    this.repository.updateChangeOrder(updatedChangeOrder);
    addTimelineEvent(this.repository, this.idGenerator, {
      projectId: changeOrder.projectId,
      eventType: "change_order_status_changed",
      actorUserId: input.actorUserId,
      summary: `Change order ${changeOrder.title} moved to ${updatedChangeOrder.status}.`,
      visibilityFlags: changeOrder.visibilityFlags,
      occurredAt: nowIso
    });

    if (updatedChangeOrder.status === "implemented") {
      const project = this.repository.getProjectById(changeOrder.projectId);

      if (project && project.status === "awaiting_change_order_approval") {
        const updatedProject: ProjectRecord = {
          ...project,
          status: "active",
          updatedAt: nowIso
        };
        this.repository.updateProject(updatedProject);
        addTimelineEvent(this.repository, this.idGenerator, {
          projectId: project.id,
          eventType: "project_status_changed",
          actorUserId: input.actorUserId,
          summary: "Project returned to active after change-order implementation.",
          visibilityFlags: updatedProject.visibilityFlags,
          occurredAt: nowIso
        });

        await this.writeAudits([
          createAuditEvent(nowIso, "project.status_changed", "project", project.id, input.actorUserId, {
            previousStatus: project.status,
            nextStatus: updatedProject.status
          })
        ]);
      }
    }

    await this.writeAudits([
      createAuditEvent(nowIso, "project.change_order.status_changed", "change_order", changeOrder.id, input.actorUserId, {
        previousStatus: changeOrder.status,
        nextStatus: updatedChangeOrder.status
      })
    ]);

    return updatedChangeOrder;
  }
}
