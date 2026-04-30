import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { WebsitePageShell } from "../../../lib/page-shell.tsx";
import { getPublicSharedDocumentPreview } from "../../../lib/document-data.ts";

export default async function PublicDocumentSharePage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  try {
    const preview = await getPublicSharedDocumentPreview(token);

    return (
      <WebsitePageShell>
        <PageHeader
          eyebrow="Document share"
          title={preview.document.title}
          description="This no-login document route is constrained to signed-link access and the document's public-link visibility."
          actions={[{ label: "Request a project", href: "/request" }]}
          badges={["Signed link", "No login", "Public-link visibility only"]}
        />
        <SectionGrid>
          <KeyValueSummary
            title="Shared document"
            description="The link resolves to the latest clean version only."
            items={[
              { label: "Category", value: preview.document.category },
              { label: "Latest version", value: `v${preview.version.versionNumber}` },
              { label: "File", value: preview.version.fileName },
              { label: "Preview URL", value: preview.previewUrl }
            ]}
            span="4"
          />
          <SimpleList
            title="Public share rules"
            description="No-login access remains narrower than authenticated document access."
            items={[
              { title: "Share scope", body: "This route only renders when the signed link allows preview." },
              { title: "Visibility gate", body: "The document must explicitly include public-link visibility." },
              { title: "Latest clean version", body: "Infected or missing latest versions are blocked from preview." }
            ]}
            span="8"
          />
        </SectionGrid>
      </WebsitePageShell>
    );
  } catch {
    return (
      <WebsitePageShell>
        <PlaceholderPanel
          title="Document share unavailable"
          description="The signed document link is invalid, expired, revoked, or no longer authorized for preview."
          emptyState={{
            title: "Share unavailable",
            description: "Request a fresh document link from the project team if you still need access.",
            action: { label: "Return home", href: "/" }
          }}
        >
          <EmptyState
            content={{
              title: "Share unavailable",
              description: "Request a fresh document link from the project team if you still need access.",
              action: { label: "Return home", href: "/" }
            }}
          />
        </PlaceholderPanel>
      </WebsitePageShell>
    );
  }
}
