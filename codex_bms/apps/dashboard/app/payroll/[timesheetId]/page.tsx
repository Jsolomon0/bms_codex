import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { DashboardPageShell } from "../../../lib/page-shell.tsx";
import { getDashboardTimesheetDetail } from "../../../lib/payroll-data.ts";

export default async function DashboardTimesheetDetailPage({
  params
}: {
  params: Promise<{ timesheetId: string }>;
}) {
  const { timesheetId } = await params;
  const { detail, formatMinutes } = await getDashboardTimesheetDetail(timesheetId);

  if (!detail?.timesheet) {
    return (
      <DashboardPageShell activeHref="/payroll" title="Timesheet detail" subtitle="Timesheet not found">
        <PlaceholderPanel
          title="Missing timesheet"
          description="The payroll runtime does not contain this timesheet or the current actor cannot view it."
          emptyState={{
            title: "Timesheet unavailable",
            description: "Use one of the seeded ids from the payroll review queue to inspect a live detail record.",
            action: { label: "Back to payroll", href: "/payroll" }
          }}
        >
          <EmptyState
            content={{
              title: "Timesheet unavailable",
              description: "Use one of the seeded ids from the payroll review queue to inspect a live detail record.",
              action: { label: "Back to payroll", href: "/payroll" }
            }}
          />
        </PlaceholderPanel>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell activeHref="/payroll" title="Timesheet detail" subtitle={detail.timesheet.employeeUserId}>
      <PageHeader
        eyebrow="Timesheet detail"
        title={detail.timesheet.id}
        description="Submitted and reviewed timesheets preserve entry state plus immutable audit snapshots for later payroll export and dispute handling."
        actions={[{ label: "Back to payroll", href: "/payroll" }]}
        badges={[detail.timesheet.status, detail.timesheet.payrollExportState]}
      />
      <SectionGrid>
        <KeyValueSummary
          title="Timesheet summary"
          description="Org ownership, self ownership, and export state remain explicit on the record."
          items={[
            { label: "Employee", value: detail.timesheet.employeeUserId },
            { label: "Organization", value: detail.timesheet.organizationId },
            { label: "Pay period", value: detail.payPeriod ? `${detail.payPeriod.periodStart} to ${detail.payPeriod.periodEnd}` : detail.timesheet.payPeriodId },
            { label: "Status", value: detail.timesheet.status },
            { label: "Total", value: formatMinutes(detail.timesheet.totalMinutes) },
            { label: "Export state", value: detail.timesheet.payrollExportState }
          ]}
          span="4"
        />
        <SimpleList
          title="Time entries"
          description="Entries stay attached to project/task context and inherit timesheet approval state."
          items={detail.timeEntries.map((entry) => ({
            title: `${entry.workDate} | ${formatMinutes(entry.minutesWorked)}`,
            body: `${entry.projectId ?? "No project"} | ${entry.taskId ?? "No task"} | ${entry.status}`,
            meta: entry.notes ?? "No notes"
          }))}
          span="8"
        />
        <SimpleList
          title="Clock timeline"
          description="The employee event stream is append-only, which makes invalid sequences easier to detect."
          items={detail.clockEvents.map((event) => ({
            title: `${event.eventType} | ${event.eventSource}`,
            body: `${event.projectId ?? "No project"} | ${event.taskId ?? "No task"}`,
            meta: event.occurredAt.slice(0, 16).replace("T", " ")
          }))}
          span="4"
        />
        <SimpleList
          title="Immutable audit records"
          description="Submission and approval snapshots are stored separately from the mutable timesheet row."
          items={detail.auditRecords.map((record) => ({
            title: `${record.action} | ${record.actorUserId}`,
            body: `${record.snapshot.status} | ${formatMinutes(record.snapshot.totalMinutes)} | export ${record.snapshot.payrollExportState}`,
            meta: record.occurredAt.slice(0, 16).replace("T", " ")
          }))}
          span="8"
        />
      </SectionGrid>
    </DashboardPageShell>
  );
}
