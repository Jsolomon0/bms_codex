import type {
  BillLineItemRecord,
  BillRecord,
  ExpenseRecord,
  FinanceOperationActivityRecord,
  PurchaseOrderLineItemRecord,
  PurchaseOrderRecord,
  VendorRecord
} from "../../types/src/index.ts";

export const DEMO_VENDORS: readonly VendorRecord[] = [
  {
    id: "vendor-demo-1",
    organizationId: "org-hq",
    ownerUserId: "alex.owner",
    displayName: "Northfield Supply",
    legalName: "Northfield Supply LLC",
    primaryContactName: "Lena Ortiz",
    primaryEmail: "ap@northfield.example",
    primaryPhone: "555-0100",
    paymentTermsDays: 30,
    status: "active",
    linkedDocumentIds: ["document-demo-1"],
    visibilityFlags: ["internal"],
    createdAt: "2026-04-20T09:00:00.000Z",
    updatedAt: "2026-04-27T09:00:00.000Z"
  },
  {
    id: "vendor-demo-2",
    organizationId: "org-hq",
    ownerUserId: "alex.owner",
    displayName: "Precision Electric Vendor",
    legalName: "Precision Electric Vendor Inc.",
    primaryContactName: "Mia Tran",
    primaryEmail: "billing@precision-electric.example",
    primaryPhone: "555-0101",
    paymentTermsDays: 15,
    status: "active",
    linkedDocumentIds: [],
    visibilityFlags: ["internal"],
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-27T10:00:00.000Z"
  }
] as const;

export const DEMO_EXPENSES: readonly ExpenseRecord[] = [
  {
    id: "expense-demo-1",
    organizationId: "org-hq",
    ownerUserId: "employee-1",
    claimantType: "employee",
    claimantUserId: "employee-1",
    vendorId: "vendor-demo-1",
    projectId: "project-demo-1",
    taskId: "task-demo-1",
    category: "materials",
    description: "Urgent fastener pickup",
    currency: "USD",
    amountCents: 18450,
    expenseDate: "2026-04-28",
    status: "submitted",
    reimbursementRequested: true,
    reimbursable: true,
    reimbursedAt: null,
    approvedByUserId: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    receiptDocumentIds: ["document-demo-4"],
    linkedDocumentIds: ["document-demo-4"],
    visibilityFlags: ["internal"],
    createdAt: "2026-04-28T09:15:00.000Z",
    updatedAt: "2026-04-28T09:15:00.000Z"
  },
  {
    id: "expense-demo-2",
    organizationId: "org-hq",
    ownerUserId: "employee-2",
    claimantType: "employee",
    claimantUserId: "employee-2",
    vendorId: "vendor-demo-2",
    projectId: "project-demo-2",
    category: "permits",
    description: "Permit courier fee",
    currency: "USD",
    amountCents: 9200,
    expenseDate: "2026-04-24",
    status: "approved",
    reimbursementRequested: true,
    reimbursable: true,
    reimbursedAt: null,
    approvedByUserId: "alex.owner",
    approvedAt: "2026-04-25T11:00:00.000Z",
    rejectedAt: null,
    rejectionReason: null,
    receiptDocumentIds: ["document-demo-1"],
    linkedDocumentIds: ["document-demo-1"],
    visibilityFlags: ["internal"],
    createdAt: "2026-04-24T09:30:00.000Z",
    updatedAt: "2026-04-25T11:00:00.000Z"
  }
] as const;

export const DEMO_PURCHASE_ORDERS: readonly PurchaseOrderRecord[] = [
  {
    id: "purchase-order-demo-1",
    organizationId: "org-hq",
    ownerUserId: "employee-2",
    vendorId: "vendor-demo-1",
    projectId: "project-demo-1",
    poNumber: "PO-2026-010",
    title: "Finish carpentry stock order",
    description: "Trim, adhesive, and fastener restock for basement finish package.",
    currency: "USD",
    totalCents: 125000,
    expectedAt: "2026-05-02",
    issuedAt: undefined,
    status: "submitted",
    approvedByUserId: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    linkedDocumentIds: ["document-demo-1"],
    visibilityFlags: ["internal"],
    createdAt: "2026-04-27T14:00:00.000Z",
    updatedAt: "2026-04-27T14:00:00.000Z"
  },
  {
    id: "purchase-order-demo-2",
    organizationId: "org-hq",
    ownerUserId: "alex.owner",
    vendorId: "vendor-demo-2",
    projectId: "project-demo-2",
    poNumber: "PO-2026-009",
    title: "Electrical planning purchase order",
    description: "Initial planning allowance for electrical layouts.",
    currency: "USD",
    totalCents: 80000,
    expectedAt: "2026-04-29",
    issuedAt: "2026-04-25",
    status: "issued",
    approvedByUserId: "alex.owner",
    approvedAt: "2026-04-25T09:00:00.000Z",
    rejectedAt: null,
    rejectionReason: null,
    linkedDocumentIds: [],
    visibilityFlags: ["internal"],
    createdAt: "2026-04-24T16:00:00.000Z",
    updatedAt: "2026-04-25T09:00:00.000Z"
  }
] as const;

export const DEMO_PURCHASE_ORDER_LINE_ITEMS: readonly PurchaseOrderLineItemRecord[] = [
  {
    id: "purchase-order-demo-1-line-1",
    purchaseOrderId: "purchase-order-demo-1",
    lineNumber: 1,
    description: "Finish carpentry trim package",
    quantity: 5,
    unitCostCents: 15000,
    totalAmountCents: 75000
  },
  {
    id: "purchase-order-demo-1-line-2",
    purchaseOrderId: "purchase-order-demo-1",
    lineNumber: 2,
    description: "Adhesives and fasteners",
    quantity: 2,
    unitCostCents: 25000,
    totalAmountCents: 50000
  },
  {
    id: "purchase-order-demo-2-line-1",
    purchaseOrderId: "purchase-order-demo-2",
    lineNumber: 1,
    description: "Layout planning deposit",
    quantity: 1,
    unitCostCents: 80000,
    totalAmountCents: 80000
  }
] as const;

export const DEMO_BILLS: readonly BillRecord[] = [
  {
    id: "bill-demo-1",
    organizationId: "org-hq",
    ownerUserId: "alex.owner",
    vendorId: "vendor-demo-2",
    purchaseOrderId: "purchase-order-demo-2",
    projectId: "project-demo-2",
    billNumber: "BILL-2026-114",
    title: "Layout planning invoice",
    currency: "USD",
    totalCents: 80000,
    paidCents: 0,
    dueAt: "2026-05-03",
    issuedAt: "2026-04-27",
    status: "received",
    approvedByUserId: null,
    approvedAt: null,
    linkedDocumentIds: ["document-demo-1"],
    receiptDocumentIds: [],
    visibilityFlags: ["internal"],
    createdAt: "2026-04-27T18:00:00.000Z",
    updatedAt: "2026-04-27T18:00:00.000Z"
  },
  {
    id: "bill-demo-2",
    organizationId: "org-hq",
    ownerUserId: "alex.owner",
    vendorId: "vendor-demo-1",
    purchaseOrderId: "purchase-order-demo-1",
    projectId: "project-demo-1",
    billNumber: "BILL-2026-113",
    title: "Trim package deposit",
    currency: "USD",
    totalCents: 50000,
    paidCents: 50000,
    dueAt: "2026-04-30",
    issuedAt: "2026-04-24",
    status: "paid",
    approvedByUserId: "alex.owner",
    approvedAt: "2026-04-24T17:00:00.000Z",
    linkedDocumentIds: ["document-demo-1"],
    receiptDocumentIds: ["document-demo-1"],
    visibilityFlags: ["internal"],
    createdAt: "2026-04-24T16:30:00.000Z",
    updatedAt: "2026-04-25T10:00:00.000Z"
  }
] as const;

export const DEMO_BILL_LINE_ITEMS: readonly BillLineItemRecord[] = [
  {
    id: "bill-demo-1-line-1",
    billId: "bill-demo-1",
    purchaseOrderItemId: "purchase-order-demo-2-line-1",
    lineNumber: 1,
    description: "Layout planning deposit",
    quantity: 1,
    unitCostCents: 80000,
    totalAmountCents: 80000
  },
  {
    id: "bill-demo-2-line-1",
    billId: "bill-demo-2",
    purchaseOrderItemId: "purchase-order-demo-1-line-1",
    lineNumber: 1,
    description: "Trim package deposit",
    quantity: 1,
    unitCostCents: 50000,
    totalAmountCents: 50000
  }
] as const;

export const DEMO_FINANCE_OPERATION_ACTIVITIES: readonly FinanceOperationActivityRecord[] = [
  {
    id: "finance-activity-1",
    resourceType: "expense",
    resourceId: "expense-demo-1",
    eventType: "expense_created",
    actorUserId: "employee-1",
    summary: "Expense submitted for urgent fastener pickup.",
    visibilityFlags: ["internal"],
    occurredAt: "2026-04-28T09:15:00.000Z"
  },
  {
    id: "finance-activity-2",
    resourceType: "purchase_order",
    resourceId: "purchase-order-demo-1",
    eventType: "purchase_order_created",
    actorUserId: "employee-2",
    summary: "Purchase order submitted for review.",
    visibilityFlags: ["internal"],
    occurredAt: "2026-04-27T14:00:00.000Z"
  },
  {
    id: "finance-activity-3",
    resourceType: "bill",
    resourceId: "bill-demo-1",
    eventType: "bill_created",
    actorUserId: "alex.owner",
    summary: "Vendor bill recorded and marked received.",
    visibilityFlags: ["internal"],
    occurredAt: "2026-04-27T18:00:00.000Z"
  }
] as const;
