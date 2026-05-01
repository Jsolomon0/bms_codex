import type {
  AuthorizationActor,
  BillRecord,
  ExpenseRecord,
  PurchaseOrderRecord,
  VendorRecord
} from "../../types/src/index.ts";
import {
  authorizeBillApprovalOrThrow,
  authorizeBillManageOrThrow,
  authorizeBillView,
  authorizeBillViewOrThrow,
  authorizeExpenseApprovalOrThrow,
  authorizeExpenseCreateOrThrow,
  authorizeExpenseEditOrThrow,
  authorizeExpenseView,
  authorizeExpenseViewOrThrow,
  authorizePurchaseOrderApprovalOrThrow,
  authorizePurchaseOrderManageOrThrow,
  authorizePurchaseOrderView,
  authorizePurchaseOrderViewOrThrow,
  authorizeVendorManageOrThrow,
  authorizeVendorView,
  authorizeVendorViewOrThrow
} from "./operations-authorization.ts";
import type { FinanceOperationsRuntime } from "./operations-runtime.ts";
import type {
  CreateBillInput,
  CreateExpenseInput,
  CreatePurchaseOrderInput,
  CreateVendorInput,
  IssuePurchaseOrderInput,
  MarkExpenseReimbursedInput,
  ReviewExpenseInput,
  ReviewPurchaseOrderInput,
  SubmitExpenseInput,
  SubmitPurchaseOrderInput,
  UpdateBillStatusInput,
  UpdateBillInput,
  UpdateExpenseInput,
  UpdatePurchaseOrderInput
} from "./operations-workflow.ts";
import { FinanceOperationsWorkflowError } from "./operations-validation.ts";

export async function listVisibleVendorsForActor(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly VendorRecord[]> {
  const visible: VendorRecord[] = [];

  for (const vendor of runtime.service.listVendors()) {
    const decision = await authorizeVendorView(actor, vendor, runtime.auditSink);

    if (decision.allowed) {
      visible.push(vendor);
    }
  }

  return visible;
}

export async function listVisibleExpensesForActor(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly ExpenseRecord[]> {
  const visible: ExpenseRecord[] = [];

  for (const expense of runtime.service.listExpenses()) {
    const decision = await authorizeExpenseView(actor, expense, runtime.auditSink);

    if (decision.allowed) {
      visible.push(expense);
    }
  }

  return visible;
}

export async function listVisiblePurchaseOrdersForActor(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly PurchaseOrderRecord[]> {
  const visible: PurchaseOrderRecord[] = [];

  for (const purchaseOrder of runtime.service.listPurchaseOrders()) {
    const decision = await authorizePurchaseOrderView(actor, purchaseOrder, runtime.auditSink);

    if (decision.allowed) {
      visible.push(purchaseOrder);
    }
  }

  return visible;
}

export async function listVisibleBillsForActor(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly BillRecord[]> {
  const visible: BillRecord[] = [];

  for (const bill of runtime.service.listBills()) {
    const decision = await authorizeBillView(actor, bill, runtime.auditSink);

    if (decision.allowed) {
      visible.push(bill);
    }
  }

  return visible;
}

export async function getVendorDetailForActor(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  vendorId: string
) {
  const detail = runtime.service.getVendorDetail(vendorId);

  if (!detail.record) {
    return detail;
  }

  await authorizeVendorViewOrThrow(actor, detail.record, runtime.auditSink);
  return detail;
}

export async function getExpenseDetailForActor(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  expenseId: string
) {
  const detail = runtime.service.getExpenseDetail(expenseId);

  if (!detail.record) {
    return detail;
  }

  await authorizeExpenseViewOrThrow(actor, detail.record, runtime.auditSink);
  return detail;
}

export async function getPurchaseOrderDetailForActor(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  purchaseOrderId: string
) {
  const detail = runtime.service.getPurchaseOrderDetail(purchaseOrderId);

  if (!detail.record) {
    return detail;
  }

  await authorizePurchaseOrderViewOrThrow(actor, detail.record, runtime.auditSink);
  return detail;
}

export async function getBillDetailForActor(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  billId: string
) {
  const detail = runtime.service.getBillDetail(billId);

  if (!detail.record) {
    return detail;
  }

  await authorizeBillViewOrThrow(actor, detail.record, runtime.auditSink);
  return detail;
}

export async function createVendorServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateVendorInput
) {
  await authorizeVendorManageOrThrow(
    actor,
    {
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId
    },
    runtime.auditSink
  );
  return runtime.service.createVendor(input);
}

export async function updateVendorServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateVendorInput & { vendorId: string }
) {
  const vendor = runtime.repository.getVendorById(input.vendorId);

  if (!vendor) {
    throw new FinanceOperationsWorkflowError(`Vendor ${input.vendorId} was not found.`);
  }

  await authorizeVendorManageOrThrow(actor, vendor, runtime.auditSink);
  return runtime.service.updateVendor(input);
}

export async function createExpenseServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateExpenseInput
) {
  await authorizeExpenseCreateOrThrow(
    actor,
    {
      organizationId: input.organizationId,
      claimantUserId: input.claimantUserId,
      projectId: input.projectId
    },
    runtime.auditSink
  );
  return runtime.service.createExpense(input);
}

export async function updateExpenseServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateExpenseInput
) {
  const expense = runtime.repository.getExpenseById(input.expenseId);

  if (!expense) {
    throw new FinanceOperationsWorkflowError(`Expense ${input.expenseId} was not found.`);
  }

  await authorizeExpenseEditOrThrow(actor, expense, runtime.auditSink);
  return runtime.service.updateExpense(input);
}

export async function submitExpenseServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: SubmitExpenseInput
) {
  const expense = runtime.repository.getExpenseById(input.expenseId);

  if (!expense) {
    throw new FinanceOperationsWorkflowError(`Expense ${input.expenseId} was not found.`);
  }

  await authorizeExpenseEditOrThrow(actor, expense, runtime.auditSink);
  return runtime.service.submitExpense(input);
}

export async function reviewExpenseServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: ReviewExpenseInput
) {
  const expense = runtime.repository.getExpenseById(input.expenseId);

  if (!expense) {
    throw new FinanceOperationsWorkflowError(`Expense ${input.expenseId} was not found.`);
  }

  await authorizeExpenseApprovalOrThrow(actor, expense, runtime.auditSink);
  return runtime.service.reviewExpense(input);
}

export async function markExpenseReimbursedServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: MarkExpenseReimbursedInput
) {
  const expense = runtime.repository.getExpenseById(input.expenseId);

  if (!expense) {
    throw new FinanceOperationsWorkflowError(`Expense ${input.expenseId} was not found.`);
  }

  await authorizeExpenseApprovalOrThrow(actor, expense, runtime.auditSink);
  return runtime.service.markExpenseReimbursed(input);
}

export async function createPurchaseOrderServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreatePurchaseOrderInput
) {
  await authorizePurchaseOrderManageOrThrow(
    actor,
    {
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      projectId: input.projectId
    },
    runtime.auditSink
  );
  return runtime.service.createPurchaseOrder(input);
}

export async function updatePurchaseOrderServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdatePurchaseOrderInput
) {
  const purchaseOrder = runtime.repository.getPurchaseOrderById(input.purchaseOrderId);

  if (!purchaseOrder) {
    throw new FinanceOperationsWorkflowError(`Purchase order ${input.purchaseOrderId} was not found.`);
  }

  await authorizePurchaseOrderManageOrThrow(actor, purchaseOrder, runtime.auditSink);
  return runtime.service.updatePurchaseOrder(input);
}

export async function submitPurchaseOrderServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: SubmitPurchaseOrderInput
) {
  const purchaseOrder = runtime.repository.getPurchaseOrderById(input.purchaseOrderId);

  if (!purchaseOrder) {
    throw new FinanceOperationsWorkflowError(`Purchase order ${input.purchaseOrderId} was not found.`);
  }

  await authorizePurchaseOrderManageOrThrow(actor, purchaseOrder, runtime.auditSink);
  return runtime.service.submitPurchaseOrder(input);
}

export async function reviewPurchaseOrderServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: ReviewPurchaseOrderInput
) {
  const purchaseOrder = runtime.repository.getPurchaseOrderById(input.purchaseOrderId);

  if (!purchaseOrder) {
    throw new FinanceOperationsWorkflowError(`Purchase order ${input.purchaseOrderId} was not found.`);
  }

  await authorizePurchaseOrderApprovalOrThrow(actor, purchaseOrder, runtime.auditSink);
  return runtime.service.reviewPurchaseOrder(input);
}

export async function issuePurchaseOrderServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: IssuePurchaseOrderInput
) {
  const purchaseOrder = runtime.repository.getPurchaseOrderById(input.purchaseOrderId);

  if (!purchaseOrder) {
    throw new FinanceOperationsWorkflowError(`Purchase order ${input.purchaseOrderId} was not found.`);
  }

  await authorizePurchaseOrderManageOrThrow(actor, purchaseOrder, runtime.auditSink);
  return runtime.service.issuePurchaseOrder(input);
}

export async function createBillServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateBillInput
) {
  await authorizeBillManageOrThrow(
    actor,
    {
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      projectId: input.projectId
    },
    runtime.auditSink
  );
  return runtime.service.createBill(input);
}

export async function updateBillServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateBillInput
) {
  const bill = runtime.repository.getBillById(input.billId);

  if (!bill) {
    throw new FinanceOperationsWorkflowError(`Bill ${input.billId} was not found.`);
  }

  await authorizeBillManageOrThrow(actor, bill, runtime.auditSink);
  return runtime.service.updateBill(input);
}

export async function updateBillStatusServer(
  runtime: FinanceOperationsRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateBillStatusInput
) {
  const bill = runtime.repository.getBillById(input.billId);

  if (!bill) {
    throw new FinanceOperationsWorkflowError(`Bill ${input.billId} was not found.`);
  }

  if (input.status === "approved" || input.status === "scheduled" || input.status === "paid") {
    await authorizeBillApprovalOrThrow(actor, bill, runtime.auditSink);
  } else {
    await authorizeBillManageOrThrow(actor, bill, runtime.auditSink);
  }

  return runtime.service.updateBillStatus(input);
}
