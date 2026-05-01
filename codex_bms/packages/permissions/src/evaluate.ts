import {
  type AuthorizationActor,
  type AuthorizationDecision,
  type AuthorizationInput,
  type PermissionDefinition,
  type PermissionKey,
  type RecordScope,
  type ResourceRecord,
  type ResolvedPublicLink,
  type RoleKey,
  type RoleMembership,
  type VisibilityFlag
} from "../../types/src/index.ts";
import { getPermissionDefinition, ROLE_DEFAULT_GRANTS } from "./registry.ts";

const FULL_INTERNAL_VISIBILITY: readonly VisibilityFlag[] = [
  "internal",
  "applicant",
  "customer",
  "subcontractor",
  "supercontractor",
  "public_link"
] as const;

const ROLE_VISIBILITY_ACCESS: Record<RoleKey, readonly VisibilityFlag[]> = {
  owner: FULL_INTERNAL_VISIBILITY,
  administrator: FULL_INTERNAL_VISIBILITY,
  developer: ["internal"],
  employee: FULL_INTERNAL_VISIBILITY,
  applicant: ["applicant", "public_link"],
  customer: ["customer", "public_link"],
  subcontractor: ["subcontractor", "public_link"],
  supercontractor: ["subcontractor", "supercontractor", "public_link"]
};

function normalizeVisibility(visibility: ResourceRecord["visibility"]): readonly VisibilityFlag[] {
  if (Array.isArray(visibility)) {
    return visibility;
  }

  return [visibility as VisibilityFlag];
}

function normalizePartnerOrgIds(record: ResourceRecord): readonly string[] {
  if (record.partnerOrgIds && record.partnerOrgIds.length > 0) {
    return record.partnerOrgIds;
  }

  return record.partnerOrgId ? [record.partnerOrgId] : [];
}

function isMembershipActive(membership: RoleMembership, now: Date): boolean {
  if (membership.active === false) {
    return false;
  }

  if (membership.startsAt && now < new Date(membership.startsAt)) {
    return false;
  }

  if (membership.endsAt && now > new Date(membership.endsAt)) {
    return false;
  }

  return true;
}

function roleHasPermission(role: RoleKey, permissionKey: PermissionKey): boolean {
  const grants = ROLE_DEFAULT_GRANTS[role];

  if (grants[0] === "*") {
    return true;
  }

  return (grants as readonly PermissionKey[]).includes(permissionKey);
}

function membershipHasPermission(membership: RoleMembership, permissionKey: PermissionKey): boolean {
  if (membership.deniedPermissionKeys?.includes(permissionKey)) {
    return false;
  }

  if (membership.grantedPermissionKeys?.includes(permissionKey)) {
    return true;
  }

  return roleHasPermission(membership.role, permissionKey);
}

function visibilityAllows(membership: RoleMembership, record: ResourceRecord): boolean {
  const allowedVisibilities = ROLE_VISIBILITY_ACCESS[membership.role];
  const recordVisibilities = normalizeVisibility(record.visibility);
  return recordVisibilities.some((visibility) => allowedVisibilities.includes(visibility));
}

function scopeAllows(
  scope: RecordScope,
  actor: AuthorizationActor,
  membership: RoleMembership,
  record?: ResourceRecord
): boolean {
  if (scope === "all") {
    return true;
  }

  if (!record) {
    return true;
  }

  if (scope === "org") {
    return Boolean(membership.orgId && record.orgId && membership.orgId === record.orgId);
  }

  if (scope === "assigned") {
    if (record.assignedUserIds?.includes(actor.userId)) {
      return true;
    }

    if (record.assignedProjectId && actor.assignedProjectIds?.includes(record.assignedProjectId)) {
      return true;
    }

    return false;
  }

  if (scope === "self") {
    if (record.ownerUserId && record.ownerUserId === actor.userId) {
      return true;
    }

    if (
      membership.customerAccountId &&
      record.customerAccountId &&
      membership.customerAccountId === record.customerAccountId
    ) {
      return true;
    }

    const partnerOrgIds = normalizePartnerOrgIds(record);

    if (membership.partnerOrgId && partnerOrgIds.includes(membership.partnerOrgId)) {
      return true;
    }

    return false;
  }

  if (scope === "partner") {
    const partnerOrgIds = normalizePartnerOrgIds(record);

    if (membership.partnerOrgId && partnerOrgIds.includes(membership.partnerOrgId)) {
      return true;
    }

    if (partnerOrgIds.some((partnerOrgId) => actor.managedPartnerOrgIds?.includes(partnerOrgId))) {
      return true;
    }

    return false;
  }

  return false;
}

function allowDecision(
  permission: PermissionDefinition,
  matchedMembership?: RoleMembership
): AuthorizationDecision {
  return {
    allowed: true,
    reason: "allowed",
    permissionKey: permission.key,
    scope: permission.scope,
    sensitive: permission.sensitive,
    auditRequired: permission.sensitive,
    viaPublicLink: false,
    matchedMembershipId: matchedMembership?.id,
    matchedRole: matchedMembership?.role
  };
}

function denyDecision(
  permissionKey: PermissionKey,
  scope: RecordScope,
  reason: AuthorizationDecision["reason"],
  sensitive: boolean,
  viaPublicLink = false
): AuthorizationDecision {
  return {
    allowed: false,
    reason,
    permissionKey,
    scope,
    sensitive,
    auditRequired: sensitive || viaPublicLink || reason !== "permission_denied",
    viaPublicLink
  };
}

function evaluatePublicLinkAccess(
  permission: PermissionDefinition,
  permissionKey: PermissionKey,
  publicLink: ResolvedPublicLink,
  record: ResourceRecord | undefined,
  now: Date
): AuthorizationDecision {
  if (!permission.publicLinkAllowed || permission.scope !== "public_link") {
    return denyDecision(permissionKey, permission.scope, "public_link_scope_denied", permission.sensitive, true);
  }

  if (publicLink.revokedAt) {
    return denyDecision(permissionKey, permission.scope, "public_link_revoked", permission.sensitive, true);
  }

  if (now > new Date(publicLink.expiresAt)) {
    return denyDecision(permissionKey, permission.scope, "public_link_expired", permission.sensitive, true);
  }

  if (typeof publicLink.maxUses === "number" && (publicLink.useCount ?? 0) >= publicLink.maxUses) {
    return denyDecision(permissionKey, permission.scope, "public_link_use_limit_exceeded", permission.sensitive, true);
  }

  if (!publicLink.permissionKeys.includes(permissionKey)) {
    return denyDecision(permissionKey, permission.scope, "public_link_scope_denied", permission.sensitive, true);
  }

  if (
    record &&
    (record.resourceType !== publicLink.resourceType || record.resourceId !== publicLink.resourceId)
  ) {
    return denyDecision(permissionKey, permission.scope, "public_link_resource_mismatch", permission.sensitive, true);
  }

  if (record) {
    const visibilities = normalizeVisibility(record.visibility);
    if (!visibilities.includes("public_link")) {
      return denyDecision(permissionKey, permission.scope, "visibility_denied", permission.sensitive, true);
    }
  }

  return {
    allowed: true,
    reason: "allowed",
    permissionKey,
    scope: permission.scope,
    sensitive: permission.sensitive,
    auditRequired: true,
    viaPublicLink: true
  };
}

export function evaluateAuthorization(input: AuthorizationInput): AuthorizationDecision {
  const now = input.now ?? new Date();
  const permission = getPermissionDefinition(input.permissionKey);

  if (!permission) {
    return denyDecision(input.permissionKey, "all", "unknown_permission", true);
  }

  if (input.publicLink) {
    return evaluatePublicLinkAccess(permission, input.permissionKey, input.publicLink, input.record, now);
  }

  if (!input.actor) {
    return denyDecision(permission.key, permission.scope, "unauthenticated", permission.sensitive);
  }

  const activeMemberships = input.actor.memberships.filter((membership) => isMembershipActive(membership, now));

  if (activeMemberships.length === 0) {
    return denyDecision(permission.key, permission.scope, "no_active_membership", permission.sensitive);
  }

  let sawGrant = false;
  let sawVisibilityDenial = false;
  let sawScopeDenial = false;

  for (const membership of activeMemberships) {
    if (!membershipHasPermission(membership, permission.key)) {
      continue;
    }

    sawGrant = true;

    if (input.record && !visibilityAllows(membership, input.record)) {
      sawVisibilityDenial = true;
      continue;
    }

    if (!scopeAllows(permission.scope, input.actor, membership, input.record)) {
      sawScopeDenial = true;
      continue;
    }

    return allowDecision(permission, membership);
  }

  if (sawVisibilityDenial) {
    return denyDecision(permission.key, permission.scope, "visibility_denied", permission.sensitive);
  }

  if (sawScopeDenial) {
    return denyDecision(permission.key, permission.scope, "scope_denied", permission.sensitive);
  }

  if (!sawGrant) {
    return denyDecision(permission.key, permission.scope, "permission_denied", permission.sensitive);
  }

  return denyDecision(permission.key, permission.scope, "permission_denied", permission.sensitive);
}

export function actorHasPermission(actor: AuthorizationActor | undefined, permissionKey: PermissionKey): boolean {
  const result = evaluateAuthorization({ actor, permissionKey });
  return result.allowed;
}

export function actorHasAnyRole(actor: AuthorizationActor | undefined, roles: readonly RoleKey[]): boolean {
  if (!actor) {
    return false;
  }

  return actor.memberships.some((membership) => roles.includes(membership.role));
}
