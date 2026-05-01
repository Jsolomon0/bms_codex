import type {
  AuditEvent,
  AuditSink,
  BillLineItemRecord,
  BillRecord,
  ExpenseRecord,
  FinanceOperationActivityRecord,
  FinanceOperationsRepository,
  PurchaseOrderLineItemRecord,
  PurchaseOrderRecord,
  VendorRecord,
  VisibilityFlag
} from "../../types/src/index.ts";
import {
  calculateBillLineItemTotals,
  calculatePurchaseOrderLineItemTotals,
  ensureBillEditable,
  ensureBillTransitionAllowed,
  ensureExpenseApprovalable,
  ensureExpenseEditable,
  ensureExpenseReimbursable,
  ensureExpenseSubmittable,
  ensurePurchaseOrderApprovalable,
  ensurePurchaseOrderEditable,
  ensurePurchaseOrderIssuable,
  FinanceOperationsValidationError,
  FinanceOperationsWorkflowError,
  normalizeDocumentIds,
  validateBillLineItems,
  validateExpenseInput,
  validatePurchaseOrderLineItems,
  validateVendorInput
} from "./operations-validation.ts";

function defaultIdGenerator() {
  let counter = 0;
  return (prefix: string) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
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

function sumLineItems(items: readonly { totalAmountCents: number }[]): number {
  return items.reduce((sum, item) => sum + item.totalAmountCents, 0);
}

export interface CreateVendorInput {
  organizationId: string;
  ownerUserId: string;
  actorUserId: string;
  linkedOrganizationId?: string;
  displayName: string;
  legalName?: string;
  primaryContactName?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  paymentTermsDays: number;
  linkedDocumentIds?: readonly string[];
}

export interface CreateExpenseInput {
  organizationId: string;
  ownerUserId: string;
  claimantType: ExpenseRecord["claimantType"];
  claimantUserId: string;
  actorUserId: string;
  vendorId?: string;
  projectId?: string;
  taskId?: string;
  category: string;
  description: string;
  currency: string;
  amountCents: number;
  expenseDate: string;
  reimbursementRequested: boolean;
  reimbursable: boolean;
  receiptDocumentIds?: readonly string[];
  linkedDocumentIds?: readonly string[];
}

export interface UpdateExpenseInput {
  expenseId: string;
  actorUserId: string;
  vendorId?: string;
  projectId?: string;
  taskId?: string;
  category: string;
  description: string;
  currency: string;
  amountCents: number;
  expenseDate: string;
  reimbursementRequested: boolean;
  reimbursable: boolean;
  receiptDocumentIds?: readonly string[];
  linkedDocumentIds?: readonly string[];
}

export interface SubmitExpenseInput {
  expenseId: string;
  actorUserId: string;
}

export interface ReviewExpenseInput {
  expenseId: string;
  actorUserId: string;
  action: "approve" | "reject";
  rejectionReason?: string;
}

export interface MarkExpenseReimbursedInput {
  expenseId: string;
  actorUserId: string;
}

export interface CreatePurchaseOrderInput {
  organizationId: string;
  ownerUserId: string;
  actorUserId: string;
  vendorId: string;
  projectId?: string;
  poNumber: string;
  title: string;
  description?: string;
  currency: string;
  expectedAt?: string;
  linkedDocumentIds?: readonly string[];
  lineItems: readonly {
    description: string;
    quantity: number;
    unitCostCents: number;
  }[];
}

export interface UpdatePurchaseOrderInput extends CreatePurchaseOrderInput {
  purchaseOrderId: string;
}

export interface SubmitPurchaseOrderInput {
  purchaseOrderId: string;
  actorUserId: string;
}

export interface ReviewPurchaseOrderInput {
  purchaseOrderId: string;
  actorUserId: string;
  action: "approve" | "reject";
  rejectionReason?: string;
}

export interface IssuePurchaseOrderInput {
  purchaseOrderId: string;
  actorUserId: string;
  issuedAt: string;
}

export interface CreateBillInput {
  organizationId: string;
  ownerUserId: string;
  actorUserId: string;
  vendorId: string;
  purchaseOrderId?: string;
  projectId?: string;
  billNumber: string;
  title: string;
  currency: string;
  dueAt: string;
  issuedAt?: string;
  linkedDocumentIds?: readonly string[];
  receiptDocumentIds?: readonly string[];
  lineItems: readonly {
    purchaseOrderItemId?: string;
    description: string;
    quantity: number;
    unitCostCents: number;
  }[];
}

export interface UpdateBillInput {
  billId: string;
  actorUserId: string;
  vendorId: string;
  purchaseOrderId?: string;
  projectId?: string;
  billNumber: string;
  title: string;
  currency: string;
  dueAt: string;
  issuedAt?: string;
  linkedDocumentIds?: readonly string[];
  receiptDocumentIds?: readonly string[];
  lineItems: readonly {
    purchaseOrderItemId?: string;
    description: string;
    quantity: number;
    unitCostCents: number;
  }[];
}

export interface UpdateBillStatusInput {
  billId: string;
  actorUserId: string;
  status: BillRecord["status"];
  paidCents?: number;
}

export interface FinanceOperationDetail<TRecord, TLineItem = never> {
  record?: TRecord;
  lineItems: readonly TLineItem[];
  activities: readonly FinanceOperationActivityRecord[];
}

export interface FinanceOperationsDependencies {
  repository: FinanceOperationsRepository;
  auditSink?: AuditSink;
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
}

export class FinanceOperationsService {
  private readonly repository: FinanceOperationsRepository;
  private readonly auditSink?: AuditSink;
  private readonly idGenerator: (prefix: string) => string;
  private readonly now: () => Date;

  constructor(dependencies: FinanceOperationsDependencies) {
    this.repository = dependencies.repository;
    this.auditSink = dependencies.auditSink;
    this.idGenerator = dependencies.idGenerator ?? defaultIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  listVendors(): readonly VendorRecord[] {
    return this.repository.listVendors();
  }

  listExpenses(): readonly ExpenseRecord[] {
    return this.repository.listExpenses();
  }

  listPurchaseOrders(): readonly PurchaseOrderRecord[] {
    return this.repository.listPurchaseOrders();
  }

  listBills(): readonly BillRecord[] {
    return this.repository.listBills();
  }

  getExpenseDetail(expenseId: string): FinanceOperationDetail<ExpenseRecord> {
    return {
      record: this.repository.getExpenseById(expenseId),
      lineItems: [],
      activities: this.repository.listActivitiesByResource("expense", expenseId)
    };
  }

  getVendorDetail(vendorId: string): FinanceOperationDetail<VendorRecord> {
    return {
      record: this.repository.getVendorById(vendorId),
      lineItems: [],
      activities: this.repository.listActivitiesByResource("vendor", vendorId)
    };
  }

  getPurchaseOrderDetail(purchaseOrderId: string): FinanceOperationDetail<PurchaseOrderRecord, PurchaseOrderLineItemRecord> {
    return {
      record: this.repository.getPurchaseOrderById(purchaseOrderId),
      lineItems: this.repository.listPurchaseOrderLineItemsByPurchaseOrderId(purchaseOrderId),
      activities: this.repository.listActivitiesByResource("purchase_order", purchaseOrderId)
    };
  }

  getBillDetail(billId: string): FinanceOperationDetail<BillRecord, BillLineItemRecord> {
    return {
      record: this.repository.getBillById(billId),
      lineItems: this.repository.listBillLineItemsByBillId(billId),
      activities: this.repository.listActivitiesByResource("bill", billId)
    };
  }

  private async writeAudits(audits: readonly AuditEvent[]): Promise<void> {
    for (const audit of audits) {
      await this.auditSink?.write(audit);
    }
  }

  private createActivity(
    resourceType: FinanceOperationActivityRecord["resourceType"],
    resourceId: string,
    eventType: FinanceOperationActivityRecord["eventType"],
    actorUserId: string | null,
    summary: string,
    visibilityFlags: readonly VisibilityFlag[],
    occurredAt: string,
    metadata?: Record<string, unknown>
  ): FinanceOperationActivityRecord {
    return {
      id: this.idGenerator("finance-activity"),
      resourceType,
      resourceId,
      eventType,
      actorUserId,
      summary,
      visibilityFlags,
      occurredAt,
      metadata
    };
  }

  async createVendor(input: CreateVendorInput): Promise<VendorRecord> {
    const issues = validateVendorInput({
      displayName: input.displayName,
      paymentTermsDays: input.paymentTermsDays
    });

    if (issues.length > 0) {
      throw new FinanceOperationsValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const vendor: VendorRecord = {
      id: this.idGenerator("vendor"),
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      linkedOrganizationId: input.linkedOrganizationId,
      displayName: input.displayName.trim(),
      legalName: input.legalName?.trim() || undefined,
      primaryContactName: input.primaryContactName?.trim() || undefined,
      primaryEmail: input.primaryEmail?.trim() || undefined,
      primaryPhone: input.primaryPhone?.trim() || undefined,
      paymentTermsDays: input.paymentTermsDays,
      status: "active",
      linkedDocumentIds: normalizeDocumentIds(input.linkedDocumentIds),
      visibilityFlags: ["internal"],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    this.repository.createVendor(vendor);
    this.repository.createActivity(
      this.createActivity("vendor", vendor.id, "vendor_created", input.actorUserId, `Vendor ${vendor.displayName} created.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "vendor.created", "vendor", vendor.id, input.actorUserId, {
        paymentTermsDays: vendor.paymentTermsDays
      })
    ]);

    return vendor;
  }

  async updateVendor(input: CreateVendorInput & { vendorId: string }): Promise<VendorRecord> {
    const vendor = this.repository.getVendorById(input.vendorId);

    if (!vendor) {
      throw new FinanceOperationsWorkflowError(`Vendor ${input.vendorId} was not found.`);
    }

    const issues = validateVendorInput({
      displayName: input.displayName,
      paymentTermsDays: input.paymentTermsDays
    });

    if (issues.length > 0) {
      throw new FinanceOperationsValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const updated: VendorRecord = {
      ...vendor,
      linkedOrganizationId: input.linkedOrganizationId,
      displayName: input.displayName.trim(),
      legalName: input.legalName?.trim() || undefined,
      primaryContactName: input.primaryContactName?.trim() || undefined,
      primaryEmail: input.primaryEmail?.trim() || undefined,
      primaryPhone: input.primaryPhone?.trim() || undefined,
      paymentTermsDays: input.paymentTermsDays,
      linkedDocumentIds: normalizeDocumentIds(input.linkedDocumentIds),
      updatedAt: nowIso
    };
    this.repository.updateVendor(updated);
    this.repository.createActivity(
      this.createActivity("vendor", updated.id, "vendor_updated", input.actorUserId, `Vendor ${updated.displayName} updated.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "vendor.updated", "vendor", updated.id, input.actorUserId, {
        previousPaymentTermsDays: vendor.paymentTermsDays,
        nextPaymentTermsDays: updated.paymentTermsDays
      })
    ]);

    return updated;
  }

  async createExpense(input: CreateExpenseInput): Promise<ExpenseRecord> {
    const issues = [...validateExpenseInput(input)];

    if (input.vendorId && !this.repository.getVendorById(input.vendorId)) {
      issues.push(`Vendor ${input.vendorId} was not found.`);
    }

    if (issues.length > 0) {
      throw new FinanceOperationsValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const expense: ExpenseRecord = {
      id: this.idGenerator("expense"),
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      claimantType: input.claimantType,
      claimantUserId: input.claimantUserId,
      vendorId: input.vendorId,
      projectId: input.projectId,
      taskId: input.taskId,
      category: input.category.trim(),
      description: input.description.trim(),
      currency: input.currency.trim(),
      amountCents: input.amountCents,
      expenseDate: input.expenseDate,
      status: "draft",
      reimbursementRequested: input.reimbursementRequested,
      reimbursable: input.reimbursable,
      reimbursedAt: null,
      approvedByUserId: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      receiptDocumentIds: normalizeDocumentIds(input.receiptDocumentIds),
      linkedDocumentIds: normalizeDocumentIds(input.linkedDocumentIds),
      visibilityFlags: ["internal"],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    this.repository.createExpense(expense);
    this.repository.createActivity(
      this.createActivity("expense", expense.id, "expense_created", input.actorUserId, `Expense ${expense.description} created.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "expense.created", "expense", expense.id, input.actorUserId, {
        amountCents: expense.amountCents,
        reimbursementRequested: expense.reimbursementRequested,
        projectId: expense.projectId ?? null
      })
    ]);

    return expense;
  }

  async updateExpense(input: UpdateExpenseInput): Promise<ExpenseRecord> {
    const expense = this.repository.getExpenseById(input.expenseId);

    if (!expense) {
      throw new FinanceOperationsWorkflowError(`Expense ${input.expenseId} was not found.`);
    }

    ensureExpenseEditable(expense);
    const issues = [...validateExpenseInput(input)];

    if (input.vendorId && !this.repository.getVendorById(input.vendorId)) {
      issues.push(`Vendor ${input.vendorId} was not found.`);
    }

    if (issues.length > 0) {
      throw new FinanceOperationsValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const updated: ExpenseRecord = {
      ...expense,
      vendorId: input.vendorId,
      projectId: input.projectId,
      taskId: input.taskId,
      category: input.category.trim(),
      description: input.description.trim(),
      currency: input.currency.trim(),
      amountCents: input.amountCents,
      expenseDate: input.expenseDate,
      reimbursementRequested: input.reimbursementRequested,
      reimbursable: input.reimbursable,
      receiptDocumentIds: normalizeDocumentIds(input.receiptDocumentIds),
      linkedDocumentIds: normalizeDocumentIds(input.linkedDocumentIds),
      updatedAt: nowIso
    };
    this.repository.updateExpense(updated);
    this.repository.createActivity(
      this.createActivity("expense", updated.id, "expense_updated", input.actorUserId, `Expense ${updated.description} updated.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "expense.updated", "expense", updated.id, input.actorUserId, {
        previousAmountCents: expense.amountCents,
        nextAmountCents: updated.amountCents
      })
    ]);

    return updated;
  }

  async submitExpense(input: SubmitExpenseInput): Promise<ExpenseRecord> {
    const expense = this.repository.getExpenseById(input.expenseId);

    if (!expense) {
      throw new FinanceOperationsWorkflowError(`Expense ${input.expenseId} was not found.`);
    }

    ensureExpenseSubmittable(expense);
    if (expense.receiptDocumentIds.length === 0) {
      throw new FinanceOperationsWorkflowError(`Expense ${expense.id} requires at least one receipt attachment before submission.`);
    }

    const nowIso = this.now().toISOString();
    const updated: ExpenseRecord = {
      ...expense,
      status: "submitted",
      approvedByUserId: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      updatedAt: nowIso
    };
    this.repository.updateExpense(updated);
    this.repository.createActivity(
      this.createActivity("expense", updated.id, "expense_status_changed", input.actorUserId, `Expense submitted for approval.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "expense.status_changed", "expense", updated.id, input.actorUserId, {
        previousStatus: expense.status,
        nextStatus: updated.status
      })
    ]);

    return updated;
  }

  async reviewExpense(input: ReviewExpenseInput): Promise<ExpenseRecord> {
    const expense = this.repository.getExpenseById(input.expenseId);

    if (!expense) {
      throw new FinanceOperationsWorkflowError(`Expense ${input.expenseId} was not found.`);
    }

    ensureExpenseApprovalable(expense);
    if (input.action === "reject" && !input.rejectionReason?.trim()) {
      throw new FinanceOperationsValidationError(["Rejected expenses require a rejection reason."]);
    }

    const nowIso = this.now().toISOString();
    const approved = input.action === "approve";
    const updated: ExpenseRecord = {
      ...expense,
      status: approved ? "approved" : "rejected",
      approvedByUserId: approved ? input.actorUserId : null,
      approvedAt: approved ? nowIso : null,
      rejectedAt: approved ? null : nowIso,
      rejectionReason: approved ? null : input.rejectionReason!.trim(),
      updatedAt: nowIso
    };
    this.repository.updateExpense(updated);
    this.repository.createActivity(
      this.createActivity(
        "expense",
        updated.id,
        "expense_status_changed",
        input.actorUserId,
        `Expense ${approved ? "approved" : "rejected"}.`,
        ["internal"],
        nowIso
      )
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "expense.status_changed", "expense", updated.id, input.actorUserId, {
        previousStatus: expense.status,
        nextStatus: updated.status,
        rejectionReason: updated.rejectionReason ?? null
      })
    ]);

    return updated;
  }

  async markExpenseReimbursed(input: MarkExpenseReimbursedInput): Promise<ExpenseRecord> {
    const expense = this.repository.getExpenseById(input.expenseId);

    if (!expense) {
      throw new FinanceOperationsWorkflowError(`Expense ${input.expenseId} was not found.`);
    }

    ensureExpenseReimbursable(expense);
    const nowIso = this.now().toISOString();
    const updated: ExpenseRecord = {
      ...expense,
      status: "reimbursed",
      reimbursedAt: nowIso,
      updatedAt: nowIso
    };
    this.repository.updateExpense(updated);
    this.repository.createActivity(
      this.createActivity("expense", updated.id, "expense_status_changed", input.actorUserId, `Expense marked reimbursed.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "expense.status_changed", "expense", updated.id, input.actorUserId, {
        previousStatus: expense.status,
        nextStatus: updated.status,
        reimbursedAt: updated.reimbursedAt
      })
    ]);

    return updated;
  }

  async createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderRecord> {
    const issues = [...validatePurchaseOrderLineItems(input.lineItems)];

    if (!this.repository.getVendorById(input.vendorId)) {
      issues.push(`Vendor ${input.vendorId} was not found.`);
    }

    if (!input.poNumber.trim()) {
      issues.push("Purchase orders require a PO number.");
    }

    if (!input.title.trim()) {
      issues.push("Purchase orders require a title.");
    }

    if (!/^[A-Z]{3}$/.test(input.currency.trim())) {
      issues.push("Purchase orders require a three-letter uppercase currency code.");
    }

    if (issues.length > 0) {
      throw new FinanceOperationsValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const purchaseOrderId = this.idGenerator("purchase-order");
    const lineItems = calculatePurchaseOrderLineItemTotals(purchaseOrderId, input.lineItems);
    const purchaseOrder: PurchaseOrderRecord = {
      id: purchaseOrderId,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      vendorId: input.vendorId,
      projectId: input.projectId,
      poNumber: input.poNumber.trim(),
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      currency: input.currency.trim(),
      totalCents: sumLineItems(lineItems),
      expectedAt: input.expectedAt,
      issuedAt: undefined,
      status: "draft",
      approvedByUserId: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      linkedDocumentIds: normalizeDocumentIds(input.linkedDocumentIds),
      visibilityFlags: ["internal"],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    this.repository.createPurchaseOrder(purchaseOrder);
    this.repository.createPurchaseOrderLineItems(lineItems);
    this.repository.createActivity(
      this.createActivity("purchase_order", purchaseOrder.id, "purchase_order_created", input.actorUserId, `Purchase order ${purchaseOrder.poNumber} created.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "purchase_order.created", "purchase_order", purchaseOrder.id, input.actorUserId, {
        totalCents: purchaseOrder.totalCents,
        lineItemCount: lineItems.length,
        projectId: purchaseOrder.projectId ?? null
      })
    ]);

    return purchaseOrder;
  }

  async updatePurchaseOrder(input: UpdatePurchaseOrderInput): Promise<PurchaseOrderRecord> {
    const purchaseOrder = this.repository.getPurchaseOrderById(input.purchaseOrderId);

    if (!purchaseOrder) {
      throw new FinanceOperationsWorkflowError(`Purchase order ${input.purchaseOrderId} was not found.`);
    }

    ensurePurchaseOrderEditable(purchaseOrder);
    const issues = [...validatePurchaseOrderLineItems(input.lineItems)];

    if (!this.repository.getVendorById(input.vendorId)) {
      issues.push(`Vendor ${input.vendorId} was not found.`);
    }

    if (!input.poNumber.trim()) {
      issues.push("Purchase orders require a PO number.");
    }

    if (!input.title.trim()) {
      issues.push("Purchase orders require a title.");
    }

    if (!/^[A-Z]{3}$/.test(input.currency.trim())) {
      issues.push("Purchase orders require a three-letter uppercase currency code.");
    }

    if (issues.length > 0) {
      throw new FinanceOperationsValidationError(issues);
    }

    const lineItems = calculatePurchaseOrderLineItemTotals(purchaseOrder.id, input.lineItems);
    const nowIso = this.now().toISOString();
    const updated: PurchaseOrderRecord = {
      ...purchaseOrder,
      vendorId: input.vendorId,
      projectId: input.projectId,
      poNumber: input.poNumber.trim(),
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      currency: input.currency.trim(),
      totalCents: sumLineItems(lineItems),
      expectedAt: input.expectedAt,
      linkedDocumentIds: normalizeDocumentIds(input.linkedDocumentIds),
      updatedAt: nowIso
    };
    this.repository.updatePurchaseOrder(updated);
    this.repository.replacePurchaseOrderLineItems(updated.id, lineItems);
    this.repository.createActivity(
      this.createActivity("purchase_order", updated.id, "purchase_order_updated", input.actorUserId, `Purchase order ${updated.poNumber} updated.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "purchase_order.updated", "purchase_order", updated.id, input.actorUserId, {
        previousTotalCents: purchaseOrder.totalCents,
        nextTotalCents: updated.totalCents
      })
    ]);

    return updated;
  }

  async submitPurchaseOrder(input: SubmitPurchaseOrderInput): Promise<PurchaseOrderRecord> {
    const purchaseOrder = this.repository.getPurchaseOrderById(input.purchaseOrderId);

    if (!purchaseOrder) {
      throw new FinanceOperationsWorkflowError(`Purchase order ${input.purchaseOrderId} was not found.`);
    }

    ensurePurchaseOrderEditable(purchaseOrder);
    const nowIso = this.now().toISOString();
    const updated: PurchaseOrderRecord = {
      ...purchaseOrder,
      status: "submitted",
      approvedByUserId: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      updatedAt: nowIso
    };
    this.repository.updatePurchaseOrder(updated);
    this.repository.createActivity(
      this.createActivity("purchase_order", updated.id, "purchase_order_status_changed", input.actorUserId, `Purchase order submitted for approval.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "purchase_order.status_changed", "purchase_order", updated.id, input.actorUserId, {
        previousStatus: purchaseOrder.status,
        nextStatus: updated.status
      })
    ]);

    return updated;
  }

  async reviewPurchaseOrder(input: ReviewPurchaseOrderInput): Promise<PurchaseOrderRecord> {
    const purchaseOrder = this.repository.getPurchaseOrderById(input.purchaseOrderId);

    if (!purchaseOrder) {
      throw new FinanceOperationsWorkflowError(`Purchase order ${input.purchaseOrderId} was not found.`);
    }

    ensurePurchaseOrderApprovalable(purchaseOrder);
    if (input.action === "reject" && !input.rejectionReason?.trim()) {
      throw new FinanceOperationsValidationError(["Rejected purchase orders require a rejection reason."]);
    }

    const nowIso = this.now().toISOString();
    const approved = input.action === "approve";
    const updated: PurchaseOrderRecord = {
      ...purchaseOrder,
      status: approved ? "approved" : "rejected",
      approvedByUserId: approved ? input.actorUserId : null,
      approvedAt: approved ? nowIso : null,
      rejectedAt: approved ? null : nowIso,
      rejectionReason: approved ? null : input.rejectionReason!.trim(),
      updatedAt: nowIso
    };
    this.repository.updatePurchaseOrder(updated);
    this.repository.createActivity(
      this.createActivity("purchase_order", updated.id, "purchase_order_status_changed", input.actorUserId, `Purchase order ${approved ? "approved" : "rejected"}.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "purchase_order.status_changed", "purchase_order", updated.id, input.actorUserId, {
        previousStatus: purchaseOrder.status,
        nextStatus: updated.status,
        rejectionReason: updated.rejectionReason ?? null
      })
    ]);

    return updated;
  }

  async issuePurchaseOrder(input: IssuePurchaseOrderInput): Promise<PurchaseOrderRecord> {
    const purchaseOrder = this.repository.getPurchaseOrderById(input.purchaseOrderId);

    if (!purchaseOrder) {
      throw new FinanceOperationsWorkflowError(`Purchase order ${input.purchaseOrderId} was not found.`);
    }

    ensurePurchaseOrderIssuable(purchaseOrder);
    const nowIso = this.now().toISOString();
    const updated: PurchaseOrderRecord = {
      ...purchaseOrder,
      status: "issued",
      issuedAt: input.issuedAt,
      updatedAt: nowIso
    };
    this.repository.updatePurchaseOrder(updated);
    this.repository.createActivity(
      this.createActivity("purchase_order", updated.id, "purchase_order_status_changed", input.actorUserId, `Purchase order issued to vendor.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "purchase_order.status_changed", "purchase_order", updated.id, input.actorUserId, {
        previousStatus: purchaseOrder.status,
        nextStatus: updated.status,
        issuedAt: updated.issuedAt
      })
    ]);

    return updated;
  }

  async createBill(input: CreateBillInput): Promise<BillRecord> {
    const issues = [...validateBillLineItems(input.lineItems)];

    if (!this.repository.getVendorById(input.vendorId)) {
      issues.push(`Vendor ${input.vendorId} was not found.`);
    }

    if (input.purchaseOrderId && !this.repository.getPurchaseOrderById(input.purchaseOrderId)) {
      issues.push(`Purchase order ${input.purchaseOrderId} was not found.`);
    }

    if (!input.billNumber.trim()) {
      issues.push("Bills require a bill number.");
    }

    if (!input.title.trim()) {
      issues.push("Bills require a title.");
    }

    if (!/^[A-Z]{3}$/.test(input.currency.trim())) {
      issues.push("Bills require a three-letter uppercase currency code.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueAt)) {
      issues.push("Bills require an ISO due date in YYYY-MM-DD format.");
    }

    if (issues.length > 0) {
      throw new FinanceOperationsValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const billId = this.idGenerator("bill");
    const lineItems = calculateBillLineItemTotals(billId, input.lineItems);
    const bill: BillRecord = {
      id: billId,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      vendorId: input.vendorId,
      purchaseOrderId: input.purchaseOrderId,
      projectId: input.projectId,
      billNumber: input.billNumber.trim(),
      title: input.title.trim(),
      currency: input.currency.trim(),
      totalCents: sumLineItems(lineItems),
      paidCents: 0,
      dueAt: input.dueAt,
      issuedAt: input.issuedAt,
      status: "draft",
      approvedByUserId: null,
      approvedAt: null,
      linkedDocumentIds: normalizeDocumentIds(input.linkedDocumentIds),
      receiptDocumentIds: normalizeDocumentIds(input.receiptDocumentIds),
      visibilityFlags: ["internal"],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    this.repository.createBill(bill);
    this.repository.createBillLineItems(lineItems);
    this.repository.createActivity(
      this.createActivity("bill", bill.id, "bill_created", input.actorUserId, `Bill ${bill.billNumber} created.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "bill.created", "bill", bill.id, input.actorUserId, {
        totalCents: bill.totalCents,
        dueAt: bill.dueAt,
        purchaseOrderId: bill.purchaseOrderId ?? null
      })
    ]);

    return bill;
  }

  async updateBill(input: UpdateBillInput): Promise<BillRecord> {
    const bill = this.repository.getBillById(input.billId);

    if (!bill) {
      throw new FinanceOperationsWorkflowError(`Bill ${input.billId} was not found.`);
    }

    ensureBillEditable(bill);
    const issues = [...validateBillLineItems(input.lineItems)];

    if (!this.repository.getVendorById(input.vendorId)) {
      issues.push(`Vendor ${input.vendorId} was not found.`);
    }

    if (input.purchaseOrderId && !this.repository.getPurchaseOrderById(input.purchaseOrderId)) {
      issues.push(`Purchase order ${input.purchaseOrderId} was not found.`);
    }

    if (!input.billNumber.trim()) {
      issues.push("Bills require a bill number.");
    }

    if (!input.title.trim()) {
      issues.push("Bills require a title.");
    }

    if (!/^[A-Z]{3}$/.test(input.currency.trim())) {
      issues.push("Bills require a three-letter uppercase currency code.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueAt)) {
      issues.push("Bills require an ISO due date in YYYY-MM-DD format.");
    }

    if (issues.length > 0) {
      throw new FinanceOperationsValidationError(issues);
    }

    const lineItems = calculateBillLineItemTotals(bill.id, input.lineItems);
    const totalCents = sumLineItems(lineItems);

    if (bill.paidCents > totalCents) {
      throw new FinanceOperationsValidationError([
        "Bill total cannot be reduced below the amount already recorded as paid."
      ]);
    }

    const nowIso = this.now().toISOString();
    const updated: BillRecord = {
      ...bill,
      vendorId: input.vendorId,
      purchaseOrderId: input.purchaseOrderId,
      projectId: input.projectId,
      billNumber: input.billNumber.trim(),
      title: input.title.trim(),
      currency: input.currency.trim(),
      totalCents,
      dueAt: input.dueAt,
      issuedAt: input.issuedAt,
      linkedDocumentIds: normalizeDocumentIds(input.linkedDocumentIds),
      receiptDocumentIds: normalizeDocumentIds(input.receiptDocumentIds),
      updatedAt: nowIso
    };
    this.repository.updateBill(updated);
    this.repository.replaceBillLineItems(updated.id, lineItems);
    this.repository.createActivity(
      this.createActivity("bill", updated.id, "bill_updated", input.actorUserId, `Bill ${updated.billNumber} updated.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "bill.updated", "bill", updated.id, input.actorUserId, {
        previousTotalCents: bill.totalCents,
        nextTotalCents: updated.totalCents,
        previousDueAt: bill.dueAt,
        nextDueAt: updated.dueAt
      })
    ]);

    return updated;
  }

  async updateBillStatus(input: UpdateBillStatusInput): Promise<BillRecord> {
    const bill = this.repository.getBillById(input.billId);

    if (!bill) {
      throw new FinanceOperationsWorkflowError(`Bill ${input.billId} was not found.`);
    }

    ensureBillEditable(bill);
    ensureBillTransitionAllowed(bill, input.status);

    const nowIso = this.now().toISOString();
    const paidCents = input.status === "paid" ? input.paidCents ?? bill.totalCents : bill.paidCents;

    if (input.status === "paid" && paidCents < bill.totalCents) {
      throw new FinanceOperationsValidationError(["Paid bills must include paid cents greater than or equal to the total bill amount."]);
    }

    const updated: BillRecord = {
      ...bill,
      status: input.status,
      paidCents,
      approvedByUserId: input.status === "approved" ? input.actorUserId : bill.approvedByUserId,
      approvedAt: input.status === "approved" ? nowIso : bill.approvedAt,
      updatedAt: nowIso
    };
    this.repository.updateBill(updated);
    this.repository.createActivity(
      this.createActivity("bill", updated.id, "bill_status_changed", input.actorUserId, `Bill moved to ${updated.status}.`, ["internal"], nowIso)
    );
    await this.writeAudits([
      createAuditEvent(nowIso, "bill.status_changed", "bill", updated.id, input.actorUserId, {
        previousStatus: bill.status,
        nextStatus: updated.status,
        paidCents: updated.paidCents
      })
    ]);

    return updated;
  }
}
