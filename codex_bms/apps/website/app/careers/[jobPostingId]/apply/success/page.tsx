import { KeyValueSummary, PageHeader, SectionGrid } from "../../../../../../../packages/ui/src/react/index.tsx";
import { WebsitePageShell } from "../../../../../lib/page-shell.tsx";

export default async function WebsiteCareerApplySuccessPage({
  searchParams
}: {
  searchParams?: Promise<{ applicationId?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <WebsitePageShell>
      <PageHeader
        eyebrow="Application submitted"
        title="Your application was received."
        description="The hiring team can review the application internally while the applicant portal exposes only your own status, interview schedule, offers, and onboarding steps."
        actions={[
          { label: "Return to careers", href: "/careers" },
          { label: "Open portal", href: "/access" }
        ]}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Submission receipt"
          description="Submission created hiring records without granting access to any non-hiring modules."
          items={[
            { label: "Application id", value: resolvedSearchParams?.applicationId ?? "Generated" },
            { label: "Applicant scope", value: "Self only" },
            { label: "Internal review", value: "Owner/admin only" },
            { label: "Audit trail", value: "Recorded" }
          ]}
          span="4"
        />
      </SectionGrid>
    </WebsitePageShell>
  );
}
