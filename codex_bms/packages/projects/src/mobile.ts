import type {
  AuthorizationActor,
  ProjectDetail,
  ProjectPhaseRecord,
  ProjectProgressUpdateRecord,
  ProjectRecord,
  ProjectTaskRecord,
  ProjectTimelineEventRecord,
  RoleKey,
  VisibilityFlag
} from "../../types/src/index.ts";
import {
  authorizeProjectProgressCreateOrThrow,
  authorizeProjectView,
  authorizeProjectViewOrThrow
} from "./authorization.ts";
import type { ProjectsRuntime } from "./runtime.ts";
import type { PublishProgressUpdateInput } from "./workflow.ts";

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
    phases: filterByVisibility(detail.phases, allowedFlags) as readonly ProjectPhaseRecord[],
    tasks: filterByVisibility(detail.tasks, allowedFlags) as readonly ProjectTaskRecord[],
    assignments: detail.assignments,
    progressUpdates: filterByVisibility(detail.progressUpdates, allowedFlags) as readonly ProjectProgressUpdateRecord[],
    changeRequests: filterByVisibility(detail.changeRequests, allowedFlags),
    changeOrders: filterByVisibility(detail.changeOrders, allowedFlags),
    timeline: filterByVisibility(detail.timeline, allowedFlags) as readonly ProjectTimelineEventRecord[],
    publicShareLinks: detail.publicShareLinks
  };
}

export async function publishProjectProgressUpdateForActor(
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
