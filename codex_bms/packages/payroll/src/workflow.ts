import type {
  ActiveClockSession,
  AuditEvent,
  AuditSink,
  ClockEventRecord,
  ClockEventSource,
  EmployeePayrollProfileRecord,
  EmployeePayrollSensitiveProfileRecord,
  PayPeriodRecord,
  PayrollDocumentRecord,
  PayrollExportState,
  PayrollLaborCostAllocationRecord,
  PayrollRepository,
  PayrollRunAuditAction,
  PayrollRunAuditRecord,
  PayrollRunDetail,
  PayrollRunRecord,
  TimeEntryRecord,
  TimesheetAuditAction,
  TimesheetAuditRecord,
  TimesheetDetail,
  TimesheetRecord
} from "../../types/src/index.ts";
import type { PayrollProviderAdapter, PayrollProviderRunSnapshot } from "./provider.ts";
import {
  ensureTimesheetEditable,
  ensureTimesheetReviewable,
  ensureTimesheetSubmittable,
  PayrollValidationError,
  PayrollWorkflowError,
  validateClockContext,
  validateClockTransition
} from "./validation.ts";

function defaultIdGenerator() {
  let counter = 0;
  return (prefix: string) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

function toIsoDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

function minutesBetween(startedAt: string, endedAt: string): number {
  const deltaMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, Math.round(deltaMs / 60000));
}

function sumMinutes(entries: readonly TimeEntryRecord[]): number {
  return entries.reduce((sum, entry) => sum + entry.minutesWorked, 0);
}

function createAuditEvent(
  occurredAt: string,
  eventType: AuditEvent["eventType"],
  resourceType: string,
  resourceId: string,
  actorUserId: string | null,
  metadata?: Record<string, unknown>
): AuditEvent {
  return {
    eventType,
    outcome: "success",
    actorUserId,
    resourceType,
    resourceId,
    viaPublicLink: false,
    sensitive: true,
    occurredAt,
    metadata
  };
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export interface ClockActionInput {
  organizationId: string;
  employeeUserId: string;
  actorUserId: string;
  occurredAt: string;
  eventSource: ClockEventSource;
  projectId?: string;
  taskId?: string;
  notes?: string;
}

export interface SubmitTimesheetInput {
  timesheetId: string;
  actorUserId: string;
}

export interface ReviewTimesheetInput {
  timesheetId: string;
  actorUserId: string;
  action: "approve" | "reject";
  rejectionReason?: string;
}

export interface UpsertEmployeePayrollProfileInput {
  organizationId: string;
  employeeUserId: string;
  actorUserId: string;
  workEmail: string;
  legalName: string;
  compensationType: EmployeePayrollProfileRecord["compensationType"];
  paySchedule: EmployeePayrollProfileRecord["paySchedule"];
  overtimeEligible: boolean;
  laborCostRateCents: number;
}

export interface CreatePayrollExportRunInput {
  payPeriodId: string;
  actorUserId: string;
}

export interface SyncPayrollRunStatusInput {
  payrollRunId: string;
  actorUserId: string;
}

export interface PayrollWorkflowDependencies {
  repository: PayrollRepository;
  provider: PayrollProviderAdapter;
  auditSink?: AuditSink;
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
}

export class PayrollService {
  private readonly repository: PayrollRepository;
  private readonly provider: PayrollProviderAdapter;
  private readonly auditSink?: AuditSink;
  private readonly idGenerator: (prefix: string) => string;
  private readonly now: () => Date;

  constructor(dependencies: PayrollWorkflowDependencies) {
    this.repository = dependencies.repository;
    this.provider = dependencies.provider;
    this.auditSink = dependencies.auditSink;
    this.idGenerator = dependencies.idGenerator ?? defaultIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  listPayPeriods(): readonly PayPeriodRecord[] {
    return this.repository.listPayPeriods();
  }

  listTimesheets(): readonly TimesheetRecord[] {
    return this.repository.listTimesheets();
  }

  listTimeEntries(): readonly TimeEntryRecord[] {
    return this.repository.listTimeEntries();
  }

  listClockEvents(): readonly ClockEventRecord[] {
    return this.repository.listClockEvents();
  }

  listEmployeePayrollProfiles(): readonly EmployeePayrollProfileRecord[] {
    return this.repository.listEmployeePayrollProfiles();
  }

  listPayrollRuns(): readonly PayrollRunRecord[] {
    return this.repository.listPayrollRuns();
  }

  listPayrollDocuments(): readonly PayrollDocumentRecord[] {
    return this.repository.listPayrollDocuments();
  }

  listPayrollLaborCostAllocations(): readonly PayrollLaborCostAllocationRecord[] {
    return this.repository.listPayrollLaborCostAllocations();
  }

  getEmployeePayrollProfile(employeeUserId: string): {
    profile?: EmployeePayrollProfileRecord;
    sensitive?: EmployeePayrollSensitiveProfileRecord;
  } {
    const profile = this.repository.getEmployeePayrollProfileByEmployeeUserId(employeeUserId);

    return {
      profile,
      sensitive: profile ? this.repository.getEmployeePayrollSensitiveProfileByProfileId(profile.id) : undefined
    };
  }

  getTimesheetDetail(timesheetId: string): TimesheetDetail {
    const timesheet = this.repository.getTimesheetById(timesheetId);

    return {
      payPeriod: timesheet ? this.repository.getPayPeriodById(timesheet.payPeriodId) : undefined,
      timesheet,
      timeEntries: timesheet ? this.repository.listTimeEntriesByTimesheetId(timesheet.id) : [],
      clockEvents: timesheet ? this.repository.listClockEventsByEmployeeUserId(timesheet.employeeUserId) : [],
      auditRecords: this.repository.listTimesheetAuditRecordsByTimesheetId(timesheetId)
    };
  }

  getPayrollRunDetail(payrollRunId: string): PayrollRunDetail {
    const payrollRun = this.repository.getPayrollRunById(payrollRunId);
    const payPeriod = payrollRun ? this.repository.getPayPeriodById(payrollRun.payPeriodId) : undefined;
    const timeEntries = payrollRun
      ? this.repository
          .listTimeEntriesByPayPeriodId(payrollRun.payPeriodId)
          .filter((entry) => entry.externalPayrollReference?.startsWith(`${payrollRun.providerRunId ?? payrollRun.id}:`))
      : [];

    return {
      payPeriod,
      payrollRun,
      timeEntries,
      laborCostAllocations: payrollRun ? this.repository.listPayrollLaborCostAllocationsByRunId(payrollRun.id) : [],
      documents: payrollRun
        ? this.repository.listPayrollDocuments().filter((document) => document.payrollRunId === payrollRun.id)
        : [],
      auditRecords: payrollRun ? this.repository.listPayrollRunAuditRecordsByRunId(payrollRun.id) : []
    };
  }

  getActiveClockSession(employeeUserId: string, now = this.now()): ActiveClockSession | undefined {
    const events = this.repository.listClockEventsByEmployeeUserId(employeeUserId);
    return this.buildActiveClockSession(events, now);
  }

  private buildActiveClockSession(events: readonly ClockEventRecord[], now: Date): ActiveClockSession | undefined {
    let session:
      | {
          employeeUserId: string;
          organizationId: string;
          clockInEvent: ClockEventRecord;
          projectId?: string;
          taskId?: string;
          breakMinutesAccumulated: number;
          activeBreakStartedAt?: string;
        }
      | undefined;

    for (const event of [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))) {
      if (event.eventType === "clock_in") {
        session = {
          employeeUserId: event.employeeUserId,
          organizationId: event.organizationId,
          clockInEvent: event,
          projectId: event.projectId,
          taskId: event.taskId,
          breakMinutesAccumulated: 0
        };
        continue;
      }

      if (!session) {
        continue;
      }

      if (event.eventType === "break_start") {
        session.activeBreakStartedAt = event.occurredAt;
        continue;
      }

      if (event.eventType === "break_end" && session.activeBreakStartedAt) {
        session.breakMinutesAccumulated += minutesBetween(session.activeBreakStartedAt, event.occurredAt);
        session.activeBreakStartedAt = undefined;
        continue;
      }

      if (event.eventType === "clock_out") {
        session = undefined;
      }
    }

    if (!session) {
      return undefined;
    }

    const provisionalBreakMinutes = session.activeBreakStartedAt
      ? session.breakMinutesAccumulated + minutesBetween(session.activeBreakStartedAt, now.toISOString())
      : session.breakMinutesAccumulated;
    const workedMinutesSoFar = Math.max(
      0,
      minutesBetween(session.clockInEvent.occurredAt, now.toISOString()) - provisionalBreakMinutes
    );

    return {
      employeeUserId: session.employeeUserId,
      organizationId: session.organizationId,
      clockInEvent: session.clockInEvent,
      projectId: session.projectId,
      taskId: session.taskId,
      breakMinutesAccumulated: session.breakMinutesAccumulated,
      activeBreakStartedAt: session.activeBreakStartedAt,
      workedMinutesSoFar
    };
  }

  private getLatestClockEvent(employeeUserId: string): ClockEventRecord | undefined {
    const events = this.repository.listClockEventsByEmployeeUserId(employeeUserId);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  private findPayPeriodForTimestamp(organizationId: string, occurredAt: string): PayPeriodRecord {
    const workDate = toIsoDate(occurredAt);
    const payPeriod = this.repository
      .listPayPeriods()
      .find((record) => record.organizationId === organizationId && workDate >= record.periodStart && workDate <= record.periodEnd);

    if (!payPeriod) {
      throw new PayrollWorkflowError(`No pay period covers ${workDate} for organization ${organizationId}.`);
    }

    return payPeriod;
  }

  private getOrCreateTimesheet(
    organizationId: string,
    employeeUserId: string,
    payPeriodId: string,
    createdAt: string
  ): TimesheetRecord {
    const existing = this.repository.findTimesheetByEmployeeAndPayPeriod(employeeUserId, payPeriodId);

    if (existing) {
      return existing;
    }

    const timesheet: TimesheetRecord = {
      id: this.idGenerator("timesheet"),
      organizationId,
      employeeUserId,
      payPeriodId,
      status: "open",
      totalMinutes: 0,
      visibilityFlags: ["internal"],
      payrollExportState: "not_ready",
      externalPayrollReference: null,
      submittedByUserId: null,
      approvedByUserId: null,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      lockedAt: null,
      createdAt,
      updatedAt: createdAt
    };

    this.repository.createTimesheet(timesheet);
    return timesheet;
  }

  private updateTimesheetTotals(timesheet: TimesheetRecord, updatedAt: string): TimesheetRecord {
    const entries = this.repository.listTimeEntriesByTimesheetId(timesheet.id);
    const updated: TimesheetRecord = {
      ...timesheet,
      totalMinutes: sumMinutes(entries),
      updatedAt
    };
    this.repository.updateTimesheet(updated);
    return updated;
  }

  private async writeAudits(audits: readonly AuditEvent[]): Promise<void> {
    for (const audit of audits) {
      await this.auditSink?.write(audit);
    }
  }

  private appendTimesheetAuditRecord(
    timesheet: TimesheetRecord,
    action: TimesheetAuditAction,
    actorUserId: string,
    occurredAt: string
  ): TimesheetAuditRecord {
    const entries = this.repository.listTimeEntriesByTimesheetId(timesheet.id);
    const record: TimesheetAuditRecord = {
      id: this.idGenerator("timesheet-audit"),
      timesheetId: timesheet.id,
      action,
      actorUserId,
      occurredAt,
      snapshot: {
        status: timesheet.status,
        totalMinutes: timesheet.totalMinutes,
        payrollExportState: timesheet.payrollExportState,
        rejectionReason: timesheet.rejectionReason ?? null,
        timeEntryIds: entries.map((entry) => entry.id)
      }
    };
    this.repository.createTimesheetAuditRecord(record);
    return record;
  }

  private appendPayrollRunAuditRecord(
    payrollRunId: string,
    action: PayrollRunAuditAction,
    actorUserId: string,
    fromStatus: PayrollRunRecord["status"] | null,
    toStatus: PayrollRunRecord["status"],
    occurredAt: string,
    metadata?: Record<string, unknown>
  ): PayrollRunAuditRecord {
    const record: PayrollRunAuditRecord = {
      id: this.idGenerator("payroll-run-audit"),
      payrollRunId,
      action,
      actorUserId,
      fromStatus,
      toStatus,
      occurredAt,
      metadata
    };
    this.repository.createPayrollRunAuditRecord(record);
    return record;
  }

  private createClockEvent(input: ClockActionInput, eventType: ClockEventRecord["eventType"]): ClockEventRecord {
    return {
      id: this.idGenerator("clock-event"),
      organizationId: input.organizationId,
      employeeUserId: input.employeeUserId,
      projectId: input.projectId,
      taskId: input.taskId,
      eventType,
      eventSource: input.eventSource,
      occurredAt: input.occurredAt,
      notes: input.notes?.trim() || undefined,
      recordedByUserId: input.actorUserId,
      visibilityFlags: ["internal"],
      createdAt: this.now().toISOString()
    };
  }

  private setTimeEntryExportState(
    entries: readonly TimeEntryRecord[],
    exportState: PayrollExportState,
    updatedAt: string,
    providerRunId?: string | null
  ): void {
    for (const entry of entries) {
      this.repository.updateTimeEntry({
        ...entry,
        payrollExportState: exportState,
        externalPayrollReference: providerRunId ? `${providerRunId}:${entry.id}` : entry.externalPayrollReference ?? null,
        updatedAt
      });
    }
  }

  private setTimesheetExportState(
    timesheetIds: readonly string[],
    exportState: PayrollExportState,
    updatedAt: string,
    providerRunId?: string | null,
    lockOnExport = false
  ): void {
    for (const timesheetId of timesheetIds) {
      const timesheet = this.repository.getTimesheetById(timesheetId);

      if (!timesheet) {
        continue;
      }

      this.repository.updateTimesheet({
        ...timesheet,
        status: lockOnExport ? "locked" : timesheet.status,
        payrollExportState: exportState,
        externalPayrollReference: providerRunId ?? timesheet.externalPayrollReference ?? null,
        lockedAt: lockOnExport ? updatedAt : timesheet.lockedAt ?? null,
        updatedAt
      });
    }
  }

  private createLaborCostAllocationsFromSnapshot(
    payrollRun: PayrollRunRecord,
    snapshot: PayrollProviderRunSnapshot,
    createdAt: string
  ): readonly PayrollLaborCostAllocationRecord[] {
    const timeEntriesById = new Map(this.repository.listTimeEntriesByPayPeriodId(payrollRun.payPeriodId).map((entry) => [entry.id, entry]));

    return snapshot.lineItems.map((lineItem) => {
      const entry = timeEntriesById.get(lineItem.timeEntryId);

      return {
        id: this.idGenerator("payroll-cost"),
        organizationId: payrollRun.organizationId,
        payrollRunId: payrollRun.id,
        payPeriodId: payrollRun.payPeriodId,
        employeeUserId: lineItem.employeeUserId,
        timeEntryId: lineItem.timeEntryId,
        projectId: lineItem.projectId ?? entry?.projectId,
        taskId: lineItem.taskId ?? entry?.taskId,
        minutesWorked: lineItem.minutesWorked,
        laborCostCents: lineItem.laborCostCents,
        createdAt
      };
    });
  }

  async clockIn(input: ClockActionInput): Promise<ClockEventRecord> {
    const issues = [...validateClockContext(input)];
    const activeSession = this.getActiveClockSession(input.employeeUserId);
    const lastEvent = this.getLatestClockEvent(input.employeeUserId);
    issues.push(
      ...validateClockTransition({
        eventType: "clock_in",
        occurredAt: input.occurredAt,
        lastEvent,
        activeSession
      })
    );

    if (issues.length > 0) {
      throw new PayrollValidationError(issues);
    }

    const payPeriod = this.findPayPeriodForTimestamp(input.organizationId, input.occurredAt);
    const timesheet = this.getOrCreateTimesheet(input.organizationId, input.employeeUserId, payPeriod.id, this.now().toISOString());
    ensureTimesheetEditable(timesheet);
    const clockEvent = this.createClockEvent(input, "clock_in");
    this.repository.createClockEvent(clockEvent);

    await this.writeAudits([
      createAuditEvent(clockEvent.createdAt, "time.clock.recorded", "clock_event", clockEvent.id, input.actorUserId, {
        employeeUserId: input.employeeUserId,
        eventType: clockEvent.eventType,
        eventSource: clockEvent.eventSource
      })
    ]);

    return clockEvent;
  }

  async startBreak(input: ClockActionInput): Promise<ClockEventRecord> {
    const issues = [...validateClockContext(input)];
    const activeSession = this.getActiveClockSession(input.employeeUserId);
    const lastEvent = this.getLatestClockEvent(input.employeeUserId);
    issues.push(
      ...validateClockTransition({
        eventType: "break_start",
        occurredAt: input.occurredAt,
        lastEvent,
        activeSession
      })
    );

    if (issues.length > 0) {
      throw new PayrollValidationError(issues);
    }

    const sourceProjectId = activeSession?.projectId ?? input.projectId;
    const sourceTaskId = activeSession?.taskId ?? input.taskId;
    const clockEvent = this.createClockEvent({ ...input, projectId: sourceProjectId, taskId: sourceTaskId }, "break_start");
    this.repository.createClockEvent(clockEvent);

    await this.writeAudits([
      createAuditEvent(clockEvent.createdAt, "time.clock.recorded", "clock_event", clockEvent.id, input.actorUserId, {
        employeeUserId: input.employeeUserId,
        eventType: clockEvent.eventType,
        eventSource: clockEvent.eventSource
      })
    ]);

    return clockEvent;
  }

  async endBreak(input: ClockActionInput): Promise<ClockEventRecord> {
    const issues = [...validateClockContext(input)];
    const activeSession = this.getActiveClockSession(input.employeeUserId);
    const lastEvent = this.getLatestClockEvent(input.employeeUserId);
    issues.push(
      ...validateClockTransition({
        eventType: "break_end",
        occurredAt: input.occurredAt,
        lastEvent,
        activeSession
      })
    );

    if (issues.length > 0) {
      throw new PayrollValidationError(issues);
    }

    const sourceProjectId = activeSession?.projectId ?? input.projectId;
    const sourceTaskId = activeSession?.taskId ?? input.taskId;
    const clockEvent = this.createClockEvent({ ...input, projectId: sourceProjectId, taskId: sourceTaskId }, "break_end");
    this.repository.createClockEvent(clockEvent);

    await this.writeAudits([
      createAuditEvent(clockEvent.createdAt, "time.clock.recorded", "clock_event", clockEvent.id, input.actorUserId, {
        employeeUserId: input.employeeUserId,
        eventType: clockEvent.eventType,
        eventSource: clockEvent.eventSource
      })
    ]);

    return clockEvent;
  }

  async clockOut(input: ClockActionInput): Promise<TimeEntryRecord> {
    const issues = [...validateClockContext(input)];
    const activeSession = this.getActiveClockSession(input.employeeUserId);
    const lastEvent = this.getLatestClockEvent(input.employeeUserId);
    issues.push(
      ...validateClockTransition({
        eventType: "clock_out",
        occurredAt: input.occurredAt,
        lastEvent,
        activeSession
      })
    );

    if (activeSession?.projectId && input.projectId && activeSession.projectId !== input.projectId) {
      issues.push("Clock-out project must match the active clock-in project.");
    }

    if (activeSession?.taskId && input.taskId && activeSession.taskId !== input.taskId) {
      issues.push("Clock-out task must match the active clock-in task.");
    }

    if (issues.length > 0) {
      throw new PayrollValidationError(issues);
    }

    if (!activeSession) {
      throw new PayrollWorkflowError("No active clock session was found.");
    }

    const projectId = activeSession.projectId ?? input.projectId;
    const taskId = activeSession.taskId ?? input.taskId;
    const payPeriod = this.findPayPeriodForTimestamp(input.organizationId, activeSession.clockInEvent.occurredAt);
    const currentTimesheet = this.getOrCreateTimesheet(
      input.organizationId,
      input.employeeUserId,
      payPeriod.id,
      this.now().toISOString()
    );
    ensureTimesheetEditable(currentTimesheet);
    const clockOutEvent = this.createClockEvent({ ...input, projectId, taskId }, "clock_out");
    this.repository.createClockEvent(clockOutEvent);

    const sessionAfterClockOut = this.buildActiveClockSession(
      [...this.repository.listClockEventsByEmployeeUserId(input.employeeUserId)],
      new Date(clockOutEvent.occurredAt)
    );

    if (sessionAfterClockOut) {
      throw new PayrollWorkflowError("Clock-out did not close the active session.");
    }

    const refreshedEvents = this.repository.listClockEventsByEmployeeUserId(input.employeeUserId);
    const closedSessionEvents = refreshedEvents.filter(
      (event) => event.occurredAt >= activeSession.clockInEvent.occurredAt && event.occurredAt <= clockOutEvent.occurredAt
    );
    let breakMinutes = 0;
    let activeBreakStartedAt: string | undefined;

    for (const event of closedSessionEvents) {
      if (event.eventType === "break_start") {
        activeBreakStartedAt = event.occurredAt;
      } else if (event.eventType === "break_end" && activeBreakStartedAt) {
        breakMinutes += minutesBetween(activeBreakStartedAt, event.occurredAt);
        activeBreakStartedAt = undefined;
      }
    }

    const startedAt = activeSession.clockInEvent.occurredAt;
    const endedAt = clockOutEvent.occurredAt;
    const minutesWorked = Math.max(0, minutesBetween(startedAt, endedAt) - breakMinutes);
    const nowIso = this.now().toISOString();
    const timeEntry: TimeEntryRecord = {
      id: this.idGenerator("time-entry"),
      organizationId: input.organizationId,
      employeeUserId: input.employeeUserId,
      payPeriodId: payPeriod.id,
      timesheetId: currentTimesheet.id,
      projectId,
      taskId,
      clockInEventId: activeSession.clockInEvent.id,
      clockOutEventId: clockOutEvent.id,
      status: currentTimesheet.status === "rejected" ? "rejected" : "draft",
      workDate: toIsoDate(startedAt),
      startedAt,
      endedAt,
      breakMinutes,
      minutesWorked,
      notes: input.notes?.trim() || activeSession.clockInEvent.notes,
      visibilityFlags: ["internal"],
      payrollExportState: "not_ready",
      externalPayrollReference: null,
      submittedByUserId: null,
      approvedByUserId: null,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: currentTimesheet.status === "rejected" ? nowIso : null,
      rejectionReason: currentTimesheet.status === "rejected" ? currentTimesheet.rejectionReason ?? null : null,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    this.repository.createTimeEntry(timeEntry);
    this.updateTimesheetTotals(currentTimesheet, nowIso);

    await this.writeAudits([
      createAuditEvent(clockOutEvent.createdAt, "time.clock.recorded", "clock_event", clockOutEvent.id, input.actorUserId, {
        employeeUserId: input.employeeUserId,
        eventType: clockOutEvent.eventType,
        eventSource: clockOutEvent.eventSource,
        timeEntryId: timeEntry.id,
        minutesWorked: timeEntry.minutesWorked
      })
    ]);

    return timeEntry;
  }

  async submitTimesheet(input: SubmitTimesheetInput): Promise<TimesheetRecord> {
    const timesheet = this.repository.getTimesheetById(input.timesheetId);

    if (!timesheet) {
      throw new PayrollWorkflowError(`Timesheet ${input.timesheetId} was not found.`);
    }

    const entries = this.repository.listTimeEntriesByTimesheetId(timesheet.id);
    ensureTimesheetSubmittable(timesheet, entries);
    const occurredAt = this.now().toISOString();
    const updatedTimesheet: TimesheetRecord = {
      ...timesheet,
      status: "submitted",
      totalMinutes: sumMinutes(entries),
      payrollExportState: "not_ready",
      submittedByUserId: input.actorUserId,
      submittedAt: occurredAt,
      approvedByUserId: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      updatedAt: occurredAt
    };
    this.repository.updateTimesheet(updatedTimesheet);

    for (const entry of entries) {
      this.repository.updateTimeEntry({
        ...entry,
        status: "submitted",
        submittedByUserId: input.actorUserId,
        submittedAt: occurredAt,
        updatedAt: occurredAt
      });
    }

    this.appendTimesheetAuditRecord(updatedTimesheet, "submitted", input.actorUserId, occurredAt);
    await this.writeAudits([
      createAuditEvent(occurredAt, "timesheet.submitted", "timesheet", updatedTimesheet.id, input.actorUserId, {
        totalMinutes: updatedTimesheet.totalMinutes
      })
    ]);

    return updatedTimesheet;
  }

  async reviewTimesheet(input: ReviewTimesheetInput): Promise<TimesheetRecord> {
    const timesheet = this.repository.getTimesheetById(input.timesheetId);

    if (!timesheet) {
      throw new PayrollWorkflowError(`Timesheet ${input.timesheetId} was not found.`);
    }

    ensureTimesheetReviewable(timesheet);
    const entries = this.repository.listTimeEntriesByTimesheetId(timesheet.id);
    const occurredAt = this.now().toISOString();
    const approved = input.action === "approve";

    if (!approved && !input.rejectionReason?.trim()) {
      throw new PayrollValidationError(["Rejected timesheets require a rejection reason."]);
    }

    const updatedTimesheet: TimesheetRecord = {
      ...timesheet,
      status: approved ? "approved" : "rejected",
      totalMinutes: sumMinutes(entries),
      payrollExportState: approved ? "ready" : "not_ready",
      approvedByUserId: approved ? input.actorUserId : null,
      approvedAt: approved ? occurredAt : null,
      rejectedAt: approved ? null : occurredAt,
      rejectionReason: approved ? null : input.rejectionReason!.trim(),
      updatedAt: occurredAt
    };
    this.repository.updateTimesheet(updatedTimesheet);

    for (const entry of entries) {
      this.repository.updateTimeEntry({
        ...entry,
        status: approved ? "approved" : "rejected",
        payrollExportState: approved ? "ready" : "not_ready",
        approvedByUserId: approved ? input.actorUserId : null,
        approvedAt: approved ? occurredAt : null,
        rejectedAt: approved ? null : occurredAt,
        rejectionReason: approved ? null : input.rejectionReason!.trim(),
        updatedAt: occurredAt
      });
    }

    this.appendTimesheetAuditRecord(updatedTimesheet, approved ? "approved" : "rejected", input.actorUserId, occurredAt);
    await this.writeAudits([
      createAuditEvent(
        occurredAt,
        approved ? "timesheet.approved" : "timesheet.rejected",
        "timesheet",
        updatedTimesheet.id,
        input.actorUserId,
        approved
          ? {
              totalMinutes: updatedTimesheet.totalMinutes,
              payrollExportState: updatedTimesheet.payrollExportState
            }
          : {
              rejectionReason: updatedTimesheet.rejectionReason
            }
      )
    ]);

    return updatedTimesheet;
  }

  async upsertEmployeePayrollProfile(input: UpsertEmployeePayrollProfileInput): Promise<{
    profile: EmployeePayrollProfileRecord;
    sensitive: EmployeePayrollSensitiveProfileRecord;
  }> {
    if (!input.workEmail.trim()) {
      throw new PayrollValidationError(["Payroll profiles require a work email."]);
    }

    if (!input.legalName.trim()) {
      throw new PayrollValidationError(["Payroll profiles require a legal name."]);
    }

    if (input.laborCostRateCents <= 0) {
      throw new PayrollValidationError(["Labor cost rate must be greater than zero."]);
    }

    const existing = this.repository.getEmployeePayrollProfileByEmployeeUserId(input.employeeUserId);
    const providerResult = await this.provider.upsertEmployeeProfile({
      employeeUserId: input.employeeUserId,
      workEmail: input.workEmail.trim(),
      legalName: input.legalName.trim(),
      compensationType: input.compensationType,
      paySchedule: input.paySchedule,
      overtimeEligible: input.overtimeEligible,
      laborCostRateCents: input.laborCostRateCents,
      providerEmployeeId: existing?.providerEmployeeId ?? null
    });
    const nowIso = this.now().toISOString();
    const profile: EmployeePayrollProfileRecord = existing
      ? {
          ...existing,
          workEmail: input.workEmail.trim(),
          legalName: input.legalName.trim(),
          status: providerResult.status,
          providerEmployeeId: providerResult.providerEmployeeId,
          compensationType: input.compensationType,
          paySchedule: input.paySchedule,
          overtimeEligible: input.overtimeEligible,
          updatedByUserId: input.actorUserId,
          onboardedAt: providerResult.status === "active" ? existing.onboardedAt ?? nowIso : existing.onboardedAt ?? null,
          updatedAt: nowIso
        }
      : {
          id: this.idGenerator("payroll-profile"),
          organizationId: input.organizationId,
          employeeUserId: input.employeeUserId,
          providerName: this.provider.providerName,
          providerEmployeeId: providerResult.providerEmployeeId,
          workEmail: input.workEmail.trim(),
          legalName: input.legalName.trim(),
          status: providerResult.status,
          compensationType: input.compensationType,
          paySchedule: input.paySchedule,
          overtimeEligible: input.overtimeEligible,
          visibilityFlags: ["internal"],
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
          onboardedAt: providerResult.status === "active" ? nowIso : null,
          offboardedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso
        };

    if (existing) {
      this.repository.updateEmployeePayrollProfile(profile);
    } else {
      this.repository.createEmployeePayrollProfile(profile);
    }

    const existingSensitive = this.repository.getEmployeePayrollSensitiveProfileByProfileId(profile.id);
    const sensitive: EmployeePayrollSensitiveProfileRecord = existingSensitive
      ? {
          ...existingSensitive,
          providerWorkerToken: providerResult.providerWorkerToken,
          providerOnboardingUrl: providerResult.providerOnboardingUrl ?? null,
          maskedTaxId: providerResult.maskedTaxId ?? null,
          bankAccountLast4: providerResult.bankAccountLast4 ?? null,
          laborCostRateCents: input.laborCostRateCents,
          updatedByUserId: input.actorUserId,
          updatedAt: nowIso
        }
      : {
          id: this.idGenerator("payroll-sensitive-profile"),
          profileId: profile.id,
          providerWorkerToken: providerResult.providerWorkerToken,
          providerOnboardingUrl: providerResult.providerOnboardingUrl ?? null,
          maskedTaxId: providerResult.maskedTaxId ?? null,
          bankAccountLast4: providerResult.bankAccountLast4 ?? null,
          laborCostRateCents: input.laborCostRateCents,
          updatedByUserId: input.actorUserId,
          updatedAt: nowIso
        };

    if (existingSensitive) {
      this.repository.updateEmployeePayrollSensitiveProfile(sensitive);
    } else {
      this.repository.createEmployeePayrollSensitiveProfile(sensitive);
    }

    await this.writeAudits([
      createAuditEvent(nowIso, "payroll.profile_synced", "payroll_profile", profile.id, input.actorUserId, {
        employeeUserId: input.employeeUserId,
        providerEmployeeId: profile.providerEmployeeId,
        profileStatus: profile.status
      })
    ]);

    return {
      profile,
      sensitive
    };
  }

  async createPayrollExportRun(input: CreatePayrollExportRunInput): Promise<PayrollRunRecord> {
    const payPeriod = this.repository.getPayPeriodById(input.payPeriodId);

    if (!payPeriod) {
      throw new PayrollWorkflowError(`Pay period ${input.payPeriodId} was not found.`);
    }

    const approvedEntries = this.repository
      .listTimeEntriesByPayPeriodId(payPeriod.id)
      .filter((entry) => entry.status === "approved" && entry.payrollExportState === "ready");

    if (approvedEntries.length === 0) {
      throw new PayrollWorkflowError(`Pay period ${payPeriod.id} does not have approved time ready for export.`);
    }

    const profileRates = new Map<string, number>();

    for (const entry of approvedEntries) {
      const profile = this.repository.getEmployeePayrollProfileByEmployeeUserId(entry.employeeUserId);

      if (!profile || profile.status !== "active") {
        throw new PayrollWorkflowError(`Employee ${entry.employeeUserId} does not have an active payroll profile.`);
      }

      const sensitive = this.repository.getEmployeePayrollSensitiveProfileByProfileId(profile.id);

      if (!sensitive) {
        throw new PayrollWorkflowError(`Employee ${entry.employeeUserId} does not have a payroll sensitive profile record.`);
      }

      profileRates.set(entry.employeeUserId, sensitive.laborCostRateCents);
    }

    const snapshot = await this.provider.createPayrollRun({
      payPeriodId: payPeriod.id,
      periodStart: payPeriod.periodStart,
      periodEnd: payPeriod.periodEnd,
      payDate: payPeriod.payDate,
      entries: approvedEntries.map((entry) => ({
        timeEntryId: entry.id,
        employeeUserId: entry.employeeUserId,
        workDate: entry.workDate,
        minutesWorked: entry.minutesWorked,
        projectId: entry.projectId,
        taskId: entry.taskId,
        laborCostRateCents: profileRates.get(entry.employeeUserId) ?? 0
      }))
    });
    const occurredAt = this.now().toISOString();
    const timesheetIds = dedupeStrings(approvedEntries.map((entry) => entry.timesheetId));
    const payrollRun: PayrollRunRecord = {
      id: this.idGenerator("payroll-run"),
      organizationId: payPeriod.organizationId,
      payPeriodId: payPeriod.id,
      providerName: this.provider.providerName,
      providerRunId: snapshot.providerRunId,
      status: snapshot.status,
      approvedTimesheetCount: timesheetIds.length,
      approvedTimeEntryCount: approvedEntries.length,
      totalMinutes: sumMinutes(approvedEntries),
      totalLaborCostCents: snapshot.totalLaborCostCents,
      failureReason: snapshot.failureReason ?? null,
      visibilityFlags: ["internal"],
      createdByUserId: input.actorUserId,
      submittedAt: occurredAt,
      syncedAt: occurredAt,
      completedAt: snapshot.status === "completed" ? snapshot.completedAt ?? occurredAt : null,
      failedAt: snapshot.status === "failed" ? occurredAt : null,
      createdAt: occurredAt,
      updatedAt: occurredAt
    };
    this.repository.createPayrollRun(payrollRun);
    this.appendPayrollRunAuditRecord(
      payrollRun.id,
      "export_started",
      input.actorUserId,
      "draft",
      payrollRun.status,
      occurredAt,
      {
        approvedTimeEntryCount: payrollRun.approvedTimeEntryCount,
        totalMinutes: payrollRun.totalMinutes
      }
    );

    const exportState: PayrollExportState =
      payrollRun.status === "completed" ? "exported" : payrollRun.status === "failed" ? "failed" : "exporting";
    this.setTimeEntryExportState(approvedEntries, exportState, occurredAt, payrollRun.providerRunId);
    this.setTimesheetExportState(timesheetIds, exportState, occurredAt, payrollRun.providerRunId, payrollRun.status === "completed");

    if (payPeriod.status === "open") {
      this.repository.updatePayPeriod({
        ...payPeriod,
        status: "processing",
        updatedAt: occurredAt
      });
    }

    await this.writeAudits([
      createAuditEvent(occurredAt, "payroll.export_started", "payroll_run", payrollRun.id, input.actorUserId, {
        payPeriodId: payPeriod.id,
        providerRunId: payrollRun.providerRunId,
        approvedTimeEntryCount: payrollRun.approvedTimeEntryCount
      })
    ]);

    if (snapshot.status === "completed" || snapshot.status === "failed") {
      return this.applyPayrollRunSnapshot(payrollRun, snapshot, input.actorUserId, occurredAt);
    }

    return payrollRun;
  }

  async syncPayrollRunStatus(input: SyncPayrollRunStatusInput): Promise<PayrollRunRecord> {
    const payrollRun = this.repository.getPayrollRunById(input.payrollRunId);

    if (!payrollRun) {
      throw new PayrollWorkflowError(`Payroll run ${input.payrollRunId} was not found.`);
    }

    if (!payrollRun.providerRunId) {
      throw new PayrollWorkflowError(`Payroll run ${payrollRun.id} does not have a provider run id.`);
    }

    const snapshot = await this.provider.getPayrollRunStatus(payrollRun.providerRunId);
    return this.applyPayrollRunSnapshot(payrollRun, snapshot, input.actorUserId, this.now().toISOString());
  }

  private async applyPayrollRunSnapshot(
    payrollRun: PayrollRunRecord,
    snapshot: PayrollProviderRunSnapshot,
    actorUserId: string,
    occurredAt: string
  ): Promise<PayrollRunRecord> {
    const previousStatus = payrollRun.status;
    const updatedRun: PayrollRunRecord = {
      ...payrollRun,
      status: snapshot.status,
      totalLaborCostCents: snapshot.totalLaborCostCents,
      failureReason: snapshot.failureReason ?? null,
      syncedAt: occurredAt,
      completedAt: snapshot.status === "completed" ? snapshot.completedAt ?? occurredAt : payrollRun.completedAt ?? null,
      failedAt: snapshot.status === "failed" ? occurredAt : null,
      updatedAt: occurredAt
    };
    this.repository.updatePayrollRun(updatedRun);

    const timeEntries = this.repository
      .listTimeEntriesByPayPeriodId(updatedRun.payPeriodId)
      .filter((entry) => entry.externalPayrollReference?.startsWith(`${updatedRun.providerRunId}:`));
    const timesheetIds = dedupeStrings(timeEntries.map((entry) => entry.timesheetId));

    if (snapshot.status === "completed") {
      this.setTimeEntryExportState(timeEntries, "exported", occurredAt, updatedRun.providerRunId);
      this.setTimesheetExportState(timesheetIds, "exported", occurredAt, updatedRun.providerRunId, true);

      const allocations = this.createLaborCostAllocationsFromSnapshot(updatedRun, snapshot, occurredAt);
      this.repository.replacePayrollLaborCostAllocationsForRun(updatedRun.id, allocations);

      for (const document of snapshot.documents) {
        const exists = this.repository
          .listPayrollDocuments()
          .some((record) => record.externalDocumentId === document.externalDocumentId);

        if (!exists) {
          this.repository.createPayrollDocument({
            id: this.idGenerator("payroll-document"),
            organizationId: updatedRun.organizationId,
            employeeUserId: document.employeeUserId,
            payrollRunId: updatedRun.id,
            providerName: updatedRun.providerName,
            category: document.category,
            title: document.title,
            fileName: document.fileName,
            externalDocumentId: document.externalDocumentId,
            downloadUrl: document.downloadUrl,
            issuedAt: document.issuedAt,
            visibilityFlags: ["internal"],
            createdAt: occurredAt
          });
        }
      }

      const payPeriod = this.repository.getPayPeriodById(updatedRun.payPeriodId);

      if (payPeriod) {
        this.repository.updatePayPeriod({
          ...payPeriod,
          status: "paid",
          updatedAt: occurredAt
        });
      }
    } else if (snapshot.status === "failed") {
      this.setTimeEntryExportState(timeEntries, "failed", occurredAt, updatedRun.providerRunId);
      this.setTimesheetExportState(timesheetIds, "failed", occurredAt, updatedRun.providerRunId);
      const payPeriod = this.repository.getPayPeriodById(updatedRun.payPeriodId);

      if (payPeriod && payPeriod.status === "processing") {
        this.repository.updatePayPeriod({
          ...payPeriod,
          status: "open",
          updatedAt: occurredAt
        });
      }
    } else if (snapshot.status === "processing" || snapshot.status === "submitted" || snapshot.status === "queued") {
      this.setTimeEntryExportState(timeEntries, "exporting", occurredAt, updatedRun.providerRunId);
      this.setTimesheetExportState(timesheetIds, "exporting", occurredAt, updatedRun.providerRunId);
    }

    const action: PayrollRunAuditAction =
      snapshot.status === "completed" ? "completed" : snapshot.status === "failed" ? "failed" : "status_synced";
    this.appendPayrollRunAuditRecord(updatedRun.id, action, actorUserId, previousStatus, snapshot.status, occurredAt, {
      providerRunId: updatedRun.providerRunId,
      totalLaborCostCents: snapshot.totalLaborCostCents
    });

    const audits: AuditEvent[] = [
      createAuditEvent(occurredAt, "payroll.run.status_changed", "payroll_run", updatedRun.id, actorUserId, {
        previousStatus,
        nextStatus: updatedRun.status,
        providerRunId: updatedRun.providerRunId
      })
    ];

    if (snapshot.status === "completed" && snapshot.documents.length > 0) {
      audits.push(
        createAuditEvent(occurredAt, "payroll.document_published", "payroll_run", updatedRun.id, actorUserId, {
          documentCount: snapshot.documents.length
        })
      );
    }

    await this.writeAudits(audits);
    return updatedRun;
  }
}
