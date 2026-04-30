import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { DashboardPageShell } from "../../../lib/page-shell.tsx";
import { getDashboardProjectDetail } from "../../../lib/project-data.ts";

export default async function DashboardProjectDetailPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const detail = getDashboardProjectDetail(projectId);

  if (!detail.project) {
    return (
      <DashboardPageShell activeHref="/projects" title="Project detail" subtitle="Project not found">
        <PlaceholderPanel
          title="Missing project"
          description="The project runtime does not contain this record."
          emptyState={{
            title: "Project not found",
            description: "Use one of the seeded project ids from the projects workspace.",
            action: { label: "Back to projects", href: "/projects" }
          }}
        >
          <EmptyState
            content={{
              title: "Project not found",
              description: "Use one of the seeded project ids from the projects workspace.",
              action: { label: "Back to projects", href: "/projects" }
            }}
          />
        </PlaceholderPanel>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell activeHref="/projects" title="Project detail" subtitle={detail.project.name}>
      <PageHeader
        eyebrow="Project detail"
        title={detail.project.name}
        description="This detail route exposes phases, tasks, assignments, progress updates, timeline events, and change workflows from the shared project runtime."
        actions={[
          { label: "Back to projects", href: "/projects" },
          { label: "Open portal view", href: "/projects" }
        ]}
        badges={detail.project.visibilityFlags}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Project snapshot"
          description="Project records keep the authorization fields required for strict server-side checks."
          items={[
            { label: "Status", value: detail.project.status },
            { label: "Organization", value: detail.project.organizationId },
            { label: "Customer account", value: detail.project.customerAccountId ?? "None" },
            { label: "Partner orgs", value: detail.project.partnerOrgIds.join(", ") || "None" },
            { label: "Assigned users", value: detail.project.assignedUserIds.join(", ") || "None" },
            { label: "Source request", value: detail.project.sourceRequestId }
          ]}
          span="8"
        />
        <SimpleList
          title="Phases"
          description="Phases follow their own lifecycle and visibility settings."
          items={detail.phases.map((phase) => ({
            title: phase.name,
            body: `${phase.status} | visibility: ${phase.visibilityFlags.join(", ")}`,
            meta: `Sequence ${phase.sequence}`
          }))}
          span="4"
        />
        <SimpleList
          title="Tasks"
          description="Task visibility can be narrower than project visibility."
          items={detail.tasks.map((task) => ({
            title: task.title,
            body: `${task.status} | visibility: ${task.visibilityFlags.join(", ")}`,
            meta: `Assigned users: ${task.assignedUserIds.join(", ") || "None"}`
          }))}
          span="8"
        />
        <SimpleList
          title="Progress updates"
          description="Updates support notes, attachments, and audience-specific publication."
          items={detail.progressUpdates.map((update) => ({
            title: update.note,
            body: `Visibility: ${update.visibilityFlags.join(", ")} | Attachments: ${update.attachments.length}`,
            meta: update.createdAt.slice(0, 16).replace("T", " ")
          }))}
          span="4"
        />
        <SimpleList
          title="Customer change requests"
          description="Customer-originated requests can be converted into managed change orders."
          items={detail.changeRequests.map((request) => ({
            title: request.title,
            body: `${request.status} | visibility: ${request.visibilityFlags.join(", ")}`,
            meta: request.updatedAt.slice(0, 16).replace("T", " ")
          }))}
          span="4"
        />
        <SimpleList
          title="Change orders"
          description="Change orders are tracked separately from customer requests."
          items={detail.changeOrders.map((changeOrder) => ({
            title: changeOrder.title,
            body: `${changeOrder.status} | amount delta: ${changeOrder.estimatedAmountDelta ?? 0}`,
            meta: `Schedule delta: ${changeOrder.estimatedScheduleDeltaDays ?? 0} days`
          }))}
          span="4"
        />
        <SimpleList
          title="Timeline"
          description="Timeline events provide an auditable project narrative."
          items={detail.timeline.map((event) => ({
            title: event.eventType,
            body: event.summary,
            meta: event.occurredAt.slice(0, 16).replace("T", " ")
          }))}
          span="8"
        />
      </SectionGrid>
    </DashboardPageShell>
  );
}
