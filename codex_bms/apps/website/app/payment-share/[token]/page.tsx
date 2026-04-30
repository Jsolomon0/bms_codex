import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { WebsitePageShell } from "../../../lib/page-shell.tsx";
import { getPublicSharedInvoice } from "../../../lib/payment-data.ts";

function formatCurrency(amountCents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(amountCents / 100);
}

export default async function PublicPaymentSharePage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  try {
    const detail = await getPublicSharedInvoice(token);

    return (
      <WebsitePageShell>
        <PageHeader
          eyebrow="Payment share"
          title={detail.invoice.invoiceNumber}
          description="This no-login billing view is constrained to signed-link access and only exposes the customer-safe invoice and payment fields allowed by the share scope."
          actions={[{ label: "Request a project", href: "/request" }]}
          badges={["Signed link", "No login", "Selected payment scope only"]}
        />
        <SectionGrid>
          <KeyValueSummary
            title="Shared invoice"
            description="Public payment shares stay narrower than authenticated customer portal billing."
            items={[
              { label: "Invoice", value: detail.invoice.invoiceNumber },
              { label: "Status", value: detail.invoice.status },
              { label: "Total", value: formatCurrency(detail.invoice.totalCents, detail.invoice.currency) },
              { label: "Balance due", value: formatCurrency(detail.invoice.balanceDueCents, detail.invoice.currency) },
              { label: "Can pay", value: detail.canCollectPayment ? "Yes" : "View only" }
            ]}
            span="4"
          />
          <SimpleList
            title="Shared line items"
            description="Only line items for the scoped invoice are returned."
            items={detail.lineItems.map((item) => ({
              title: item.description,
              body: `${item.quantity} x ${formatCurrency(item.unitAmountCents, detail.invoice.currency)}`,
              meta: formatCurrency(item.lineTotalCents, detail.invoice.currency)
            }))}
            span="4"
          />
          <SimpleList
            title="Recent shared activity"
            description="The public link only exposes customer-safe billing activity."
            items={detail.activities.slice(0, 5).map((activity) => ({
              title: activity.eventType,
              body: activity.summary,
              meta: activity.occurredAt.slice(0, 16).replace("T", " ")
            }))}
            span="4"
          />
        </SectionGrid>
      </WebsitePageShell>
    );
  } catch {
    return (
      <WebsitePageShell>
        <PlaceholderPanel
          title="Payment share unavailable"
          description="The signed billing link is invalid, expired, revoked, or no longer authorized for public viewing."
          emptyState={{
            title: "Share unavailable",
            description: "Request a fresh payment link from the project team if you still need access.",
            action: { label: "Return home", href: "/" }
          }}
        >
          <EmptyState
            content={{
              title: "Share unavailable",
              description: "Request a fresh payment link from the project team if you still need access.",
              action: { label: "Return home", href: "/" }
            }}
          />
        </PlaceholderPanel>
      </WebsitePageShell>
    );
  }
}
