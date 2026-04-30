import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { PortalPageShell } from "../../../lib/page-shell.tsx";
import { getPortalProjectDetail } from "../../../lib/project-data.ts";

export default async function PortalProjectDetailPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  try {
    const detail = await getPortalProjectDetail(projectId);

    if (!detail?.project) {
      throw new Error("missing");
    }

    return (
      <PortalPageShell activeHref="/projects" title="Project detail" subtitle={detail.project.name}>
        <PageHeader
          eyebrow="Project detail"
          title={detail.project.name}
          description="This portal detail route only includes child records whose visibility flags match the actor's external role."
          actions={[{ label: "Back to projects", href: "/projects" }]}
          badges={detail.project.visibilityFlags.filter((flag) => flag !== "internal")}
        />
        <SectionGrid>
          <KeyValueSummary
            title="Project snapshot"
            description="Project summaries remain visible while internal-only children stay hidden."
            items={[
              { label: "Status", value: detail.project.status },
              { label: "Customer account", value: detail.project.customerAccountId ?? "None" },
              { label: "Visible phases", value: String(detail.phases.length) },
              { label: "Visible tasks", value: String(detail.tasks.length) },
              { label: "Visible progress updates", value: String(detail.progressUpdates.length) },
              { label: "Visible change orders", value: String(detail.changeOrders.length) }
            ]}
            span="4"
          />
          <SimpleList
            title="Visible phases"
            description="Only stakeholder-safe phases appear here."
            items={detail.phases.map((phase) => ({
              title: phase.name,
              body: `${phase.status} | visibility: ${phase.visibilityFlags.join(", ")}`,
              meta: `Sequence ${phase.sequence}`
            }))}
            span="8"
          />
          <SimpleList
            title="Visible tasks"
            description="Internal-only tasks are removed from the portal response."
            items={detail.tasks.map((task) => ({
              title: task.title,
              body: `${task.status} | visibility: ${task.visibilityFlags.join(", ")}`,
              meta: `Attachments: ${task.attachments.length}`
            }))}
            span="4"
          />
          <SimpleList
            title="Progress feed"
            description="Progress updates are filtered before they reach the portal route."
            items={detail.progressUpdates.map((update) => ({
              title: update.note,
              body: `Visibility: ${update.visibilityFlags.join(", ")}`,
              meta: update.createdAt.slice(0, 16).replace("T", " ")
            }))}
            span="4"
          />
          <SimpleList
            title="Change orders"
            description="Only customer-visible change workflow records are shown."
            items={detail.changeOrders.map((changeOrder) => ({
              title: changeOrder.title,
              body: `${changeOrder.status} | amount delta: ${changeOrder.estimatedAmountDelta ?? 0}`,
              meta: `Schedule delta: ${changeOrder.estimatedScheduleDeltaDays ?? 0} days`
            }))}
            span="4"
          />
        </SectionGrid>
      </PortalPageShell>
    );
  } catch {
    return (
      <PortalPageShell activeHref="/projects" title="Project detail" subtitle="Not available">
        <PlaceholderPanel
          title="Project unavailable"
          description="The current portal actor is not authorized to view this project or the record does not exist."
          emptyState={{
            title: "Project unavailable",
            description: "Portal visibility is constrained by role, record scope, and per-record visibility flags.",
            action: { label: "Back to projects", href: "/projects" }
          }}
        >
          <EmptyState
            content={{
              title: "Project unavailable",
              description: "Portal visibility is constrained by role, record scope, and per-record visibility flags.",
              action: { label: "Back to projects", href: "/projects" }
            }}
          />
        </PlaceholderPanel>
      </PortalPageShell>
    );
  }
}
