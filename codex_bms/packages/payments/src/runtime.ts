import type {
  AuditEvent,
  AuditSink,
  InvoiceRecord,
  InvoiceActivityRecord,
  InvoiceReminderRecord,
  VisibilityFlag
} from "../../types/src/index.ts";
import { createInMemorySecurityContext, resolveRuntimeSecret, type InMemorySecurityContext } from "../../security/src/index.ts";
import {
  REPORTING_DEMO_INVOICE_LINE_ITEMS,
  REPORTING_DEMO_INVOICES,
  REPORTING_DEMO_PAYMENTS
} from "../../reporting/src/fixtures.ts";
import { MemoryStripePaymentProvider } from "./provider.ts";
import { InMemoryInvoiceRepository } from "./repository.ts";

const DEMO_INVOICE_REMINDERS: readonly InvoiceReminderRecord[] = [
  {
    id: "invoice-reminder-demo-1",
    invoiceId: "invoice-report-1",
    reminderType: "payment_received",
    recipientEmail: "customer-aria@portal.local",
    subject: "Payment received",
    body: "Your partial payment has been recorded.",
    createdAt: "2026-04-18T16:05:00.000Z"
  },
  {
    id: "invoice-reminder-demo-2",
    invoiceId: "invoice-report-2",
    reminderType: "invoice_sent",
    recipientEmail: "customer-aria@portal.local",
    subject: "New invoice available",
    body: "Milestone two billing is now available in the portal.",
    createdAt: "2026-04-27T12:05:00.000Z"
  }
] as const;

const DEMO_INVOICE_ACTIVITIES: readonly InvoiceActivityRecord[] = [
  {
    id: "invoice-activity-demo-1",
    invoiceId: "invoice-report-1",
    eventType: "invoice_created",
    actorUserId: "alex.owner",
    summary: "Progress billing invoice created.",
    visibilityFlags: ["internal", "customer", "public_link"],
    occurredAt: "2026-03-31T12:00:00.000Z"
  },
  {
    id: "invoice-activity-demo-2",
    invoiceId: "invoice-report-1",
    eventType: "payment_recorded",
    actorUserId: "alex.owner",
    summary: "Partial card payment recorded.",
    visibilityFlags: ["internal", "customer", "public_link"],
    occurredAt: "2026-04-18T16:00:00.000Z"
  },
  {
    id: "invoice-activity-demo-3",
    invoiceId: "invoice-report-2",
    eventType: "invoice_sent",
    actorUserId: "alex.owner",
    summary: "Milestone two invoice sent to the portal customer.",
    visibilityFlags: ["internal", "customer", "public_link"],
    occurredAt: "2026-04-27T12:00:00.000Z"
  }
] as const;

export class MemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  write(event: AuditEvent): void {
    this.events.push(event);
  }

  list(): readonly AuditEvent[] {
    return [...this.events].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }
}

export interface PaymentsRuntime {
  repository: InMemoryInvoiceRepository;
  auditSink: MemoryAuditSink;
  provider: MemoryStripePaymentProvider;
  publicLinkSecret: string;
  security: InMemorySecurityContext;
  now: () => Date;
  nextId: (prefix: string) => string;
  brandName: string;
  brandAccent: string;
  organizationLabel: string;
}

function createInvoicesWithPublicLinkVisibility(): readonly InvoiceRecord[] {
  return REPORTING_DEMO_INVOICES.map((invoice) =>
    invoice.customerAccountId === "customer-aria"
      ? {
          ...invoice,
          visibilityFlags: [...new Set<VisibilityFlag>([...invoice.visibilityFlags, "public_link"])]
        }
      : invoice
  );
}

function createRuntime(): PaymentsRuntime {
  let counter = 5000;
  const runtimeNow = () => new Date("2026-04-28T16:30:00.000Z");
  const repository = new InMemoryInvoiceRepository({
    invoices: createInvoicesWithPublicLinkVisibility(),
    lineItems: REPORTING_DEMO_INVOICE_LINE_ITEMS,
    payments: REPORTING_DEMO_PAYMENTS,
    reminders: DEMO_INVOICE_REMINDERS,
    activities: DEMO_INVOICE_ACTIVITIES
  });
  const auditSink = new MemoryAuditSink();
  const security = createInMemorySecurityContext({
    auditSink,
    now: runtimeNow
  });
  const stripeWebhookSecret = resolveRuntimeSecret({
    envKey: "BMS_STRIPE_WEBHOOK_SECRET",
    fallbackSecret: "stripe-demo-secret-2026-hardening",
    auditSink,
    logger: security.logger,
    monitoringHook: security.monitoringHook,
    now: runtimeNow
  });

  return {
    repository,
    auditSink,
    provider: new MemoryStripePaymentProvider(stripeWebhookSecret, runtimeNow),
    publicLinkSecret: resolveRuntimeSecret({
      envKey: "BMS_PAYMENT_PUBLIC_LINK_SECRET",
      fallbackSecret: "payments-demo-secret-2026-hardening",
      auditSink,
      logger: security.logger,
      monitoringHook: security.monitoringHook,
      now: runtimeNow
    }),
    security,
    now: runtimeNow,
    nextId: (prefix: string) => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
    brandName: "BMS Finance",
    brandAccent: "#2847a1",
    organizationLabel: "BMS General Contracting"
  };
}

let runtime: PaymentsRuntime | undefined;

export function getPaymentsRuntime(): PaymentsRuntime {
  runtime ??= createRuntime();
  return runtime;
}

export function resetPaymentsRuntime(): PaymentsRuntime {
  runtime = createRuntime();
  return runtime;
}
