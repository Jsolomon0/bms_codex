import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { PortalPageShell } from "../../../lib/page-shell.tsx";
import { getPortalDocumentDetail } from "../../../lib/document-data.ts";

export default async function PortalDocumentDetailPage({
  params
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;

  try {
    const detail = await getPortalDocumentDetail(documentId);

    if (!detail.document) {
      throw new Error("missing");
    }

    return (
      <PortalPageShell activeHref="/documents" title="Document detail" subtitle={detail.document.title}>
        <PageHeader
          eyebrow="Document detail"
          title={detail.document.title}
          description="Portal viewers see document metadata and activity that survive both visibility filtering and access-rule checks."
          actions={[{ label: "Back to documents", href: "/documents" }]}
          badges={detail.document.visibilityFlags.filter((flag) => flag !== "internal")}
        />
        <SectionGrid>
          <KeyValueSummary
            title="Document summary"
            description="Internal management fields stay out of the portal response."
            items={[
              { label: "Category", value: detail.document.category },
              { label: "Archive state", value: detail.document.archiveState },
              { label: "Versions", value: String(detail.versions.length) },
              { label: "Activities", value: String(detail.activities.length) }
            ]}
            span="4"
          />
          <SimpleList
            title="Version history"
            description="External viewers can see the document's version chain without internal access controls."
            items={detail.versions.map((version) => ({
              title: `v${version.versionNumber} - ${version.fileName}`,
              body: `${version.contentType} | ${version.byteSize} bytes`,
              meta: version.createdAt.slice(0, 16).replace("T", " ")
            }))}
            span="4"
          />
          <SimpleList
            title="Activity"
            description="Only activity entries visible to this actor are returned."
            items={detail.activities.map((activity) => ({
              title: activity.eventType,
              body: activity.summary,
              meta: activity.occurredAt.slice(0, 16).replace("T", " ")
            }))}
            span="4"
          />
        </SectionGrid>
      </PortalPageShell>
    );
  } catch {
    return (
      <PortalPageShell activeHref="/documents" title="Document detail" subtitle="Not available">
        <PlaceholderPanel
          title="Document unavailable"
          description="The current portal actor is not authorized to view this document or the record does not exist."
          emptyState={{
            title: "Document unavailable",
            description: "Visibility, record scope, and document access rules all apply before files are exposed.",
            action: { label: "Back to documents", href: "/documents" }
          }}
        >
          <EmptyState
            content={{
              title: "Document unavailable",
              description: "Visibility, record scope, and document access rules all apply before files are exposed.",
              action: { label: "Back to documents", href: "/documents" }
            }}
          />
        </PlaceholderPanel>
      </PortalPageShell>
    );
  }
}
