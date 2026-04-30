import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { DashboardPageShell } from "../../../lib/page-shell.tsx";
import { getDashboardDocumentDetail } from "../../../lib/document-data.ts";

export default async function DashboardDocumentDetailPage({
  params
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const detail = getDashboardDocumentDetail(documentId);

  if (!detail.document) {
    return (
      <DashboardPageShell activeHref="/documents" title="Document detail" subtitle="Document not found">
        <PlaceholderPanel
          title="Missing document"
          description="The document runtime does not contain this record."
          emptyState={{
            title: "Document not found",
            description: "Use one of the seeded document ids from the documents workspace.",
            action: { label: "Back to documents", href: "/documents" }
          }}
        >
          <EmptyState
            content={{
              title: "Document not found",
              description: "Use one of the seeded document ids from the documents workspace.",
              action: { label: "Back to documents", href: "/documents" }
            }}
          />
        </PlaceholderPanel>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell activeHref="/documents" title="Document detail" subtitle={detail.document.title}>
      <PageHeader
        eyebrow="Document detail"
        title={detail.document.title}
        description="Document records keep version history, retention and archive metadata, access rules, and public-share state in one place."
        actions={[{ label: "Back to documents", href: "/documents" }]}
        badges={detail.document.visibilityFlags}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Document snapshot"
          description="Authorization-related ownership and visibility fields are stored directly on the document record."
          items={[
            { label: "Category", value: detail.document.category },
            { label: "Archive state", value: detail.document.archiveState },
            { label: "Customer account", value: detail.document.customerAccountId ?? "None" },
            { label: "Project", value: detail.document.projectId ?? "None" },
            { label: "Partner orgs", value: detail.document.partnerOrgIds.join(", ") || "None" },
            { label: "Retention", value: detail.document.retentionFlags.join(", ") || "None" }
          ]}
          span="8"
        />
        <SimpleList
          title="Version history"
          description="Versions are immutable, storage-backed records."
          items={detail.versions.map((version) => ({
            title: `v${version.versionNumber} - ${version.fileName}`,
            body: `${version.contentType} | ${version.byteSize} bytes | malware: ${version.malwareStatus}`,
            meta: version.createdAt.slice(0, 16).replace("T", " ")
          }))}
          span="4"
        />
        <SimpleList
          title="Access rules"
          description="Explicit access rules can further constrain non-admin access."
          items={detail.accessRules.map((rule) => ({
            title: `${rule.principalType}:${rule.principalId}`,
            body: `Actions: ${rule.actions.join(", ")}`,
            meta: rule.createdAt.slice(0, 16).replace("T", " ")
          }))}
          span="4"
        />
        <SimpleList
          title="Public share links"
          description="Signed share links support expiration and revocation."
          items={detail.publicShareLinks.map((link) => ({
            title: `${link.id} (${link.shareScope})`,
            body: `Expires ${link.expiresAt.slice(0, 10)} | uses ${link.useCount}/${link.maxUses ?? "unlimited"}`,
            meta: link.revokedAt ? `Revoked ${link.revokedAt.slice(0, 10)}` : "Active"
          }))}
          span="4"
        />
        <SimpleList
          title="Activity"
          description="Document lifecycle events remain visible alongside the record."
          items={detail.activities.map((activity) => ({
            title: activity.eventType,
            body: activity.summary,
            meta: activity.occurredAt.slice(0, 16).replace("T", " ")
          }))}
          span="8"
        />
      </SectionGrid>
    </DashboardPageShell>
  );
}
