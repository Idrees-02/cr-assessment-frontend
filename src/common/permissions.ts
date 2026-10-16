import { CrDetail, ReqUser } from '../models/cr.models';

/** Policy-string helpers. Policies are `cr_{action}_{scope}` (see README). */
export function hasPolicy(user: ReqUser, policy: string): boolean {
	return !!user && user.policies.includes(policy);
}

/** Any approve-scope policy. */
export function canApprovePolicy(user: ReqUser): boolean {
	return ['cr_a_u', 'cr_a_w', 'cr_a_o'].some((p) => hasPolicy(user, p));
}

/** The user who raised the CR, taken from its CREATE audit entry (the model has no owner field). */
export function crOwnerId(cr: CrDetail): string | undefined {
	return cr.audit.find((e) => e.action === 'CREATE')?.byUserId;
}

/**
 * Whether `user`'s approve policies cover this specific CR:
 * - `cr_a_o` / `cr_a_w`: any CR in the user's org (the CR model carries no workspace, so workspace
 *   scope is treated as org scope — see IMPLEMENTATION_NOTES).
 * - `cr_a_u`: only CRs the user raised.
 * Status is checked separately by the component.
 */
export function canApproveCr(user: ReqUser, cr: CrDetail): boolean {
	if (!user || user.orgCode !== cr.orgCode) return false;
	if (hasPolicy(user, 'cr_a_o') || hasPolicy(user, 'cr_a_w')) return true;
	return hasPolicy(user, 'cr_a_u') && crOwnerId(cr) === user.id;
}
