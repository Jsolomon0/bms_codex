import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { WebsitePageShell } from "../../../lib/page-shell.tsx";
import { getPublicSharedProject } from "../../../lib/project-data.ts";

export default async function PublicProjectSharePage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  try {
    const detail = await getPublicSharedProject(token);

    return (
      <WebsitePageShell>
        <PageHeader
          eyebrow="Project share"
          title={detail.project.name}
          description="This no-login project view is constrained to signed-link access and public-link visibility only."
          actions={[{ label: "Request a project", href: "/request" }]}
          badges={["Signed link", "No login", "Public-link visibility only"]}
        />
        <SectionGrid>
          <KeyValueSummary
            title="Shared project summary"
            description="Only project fields and child records marked for public-link visibility are returned."
            items={[
              { label: "Status", value: detail.project.status },
              { label: "Project", value: detail.project.name },
              { label: "Visible phases", value: String(detail.phases.length) },
              { label: "Visible tasks", value: String(detail.tasks.length) },
              { label: "Visible progress updates", value: String(detail.progressUpdates.length) }
            ]}
            span="4"
          />
          <SimpleList
            title="Public progress feed"
            description="If no child records are marked public-link, the share still exposes the project-level summary only."
            items={detail.progressUpdates.map((update) => ({
              title: update.note,
              body: `Attachments: ${update.attachments.length}`,
              meta: update.createdAt.slice(0, 16).replace("T", " ")
            }))}
            span="8"
          />
        </SectionGrid>
      </WebsitePageShell>
    );
  } catch {
    return (
      <WebsitePageShell>
        <PlaceholderPanel
          title="Project share unavailable"
          description="The signed project link is invalid, expired, revoked, or no longer authorized for public viewing."
          emptyState={{
            title: "Share unavailable",
            description: "Request a fresh link from the project team if you still need access.",
            action: { label: "Return home", href: "/" }
          }}
        >
          <EmptyState
            content={{
              title: "Share unavailable",
              description: "Request a fresh link from the project team if you still need access.",
              action: { label: "Return home", href: "/" }
            }}
          />
        </PlaceholderPanel>
      </WebsitePageShell>
    );
  }
}
