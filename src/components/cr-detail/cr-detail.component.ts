import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormControl, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { CrApiService } from '../../api/cr-api.service';
import { SessionService } from '../../session/session.service';
import { CrDetail, TimelineEntry } from '../../models/cr.models';
import { idle, loading, ViewState } from '../../common/view-state';
import { computeDiff, DiffRow } from '../diff.util';
import { formatMoney } from '../../common/money.util';
import { canApproveCr } from '../../common/permissions';

export type CrAction = 'approve' | 'reject';

/** Rejects a value that is empty once surrounding whitespace is removed. */
export function notBlank(control: AbstractControl<string>): ValidationErrors | null {
	return (control.value ?? '').trim().length ? null : { blank: true };
}

/**
 * Change Request DETAIL page: loads a CR and renders the diff/preview, the approval timeline, and
 * permission-aware Approve/Reject actions.
 *
 * State:
 * - `state`      — the loaded CR (loading / loaded / error).
 * - `submitting` — which action is in flight, or null. While set, every action control is disabled.
 * - `actionError`— the last failed action's message; the loaded CR stays on screen.
 */
@Component({
	selector: 'app-cr-detail',
	standalone: true,
	imports: [CommonModule, ReactiveFormsModule],
	templateUrl: './cr-detail.component.html',
})
export class CrDetailComponent implements OnInit, OnChanges {
	@Input() id!: string;
	/** Emits the updated CR after a successful approve/reject, so a parent can refresh the list. */
	@Output() changed = new EventEmitter<CrDetail>();

	state: ViewState<CrDetail> = idle();
	submitting: CrAction | null = null;
	actionError?: string;
	rejectControl = new FormControl('', { nonNullable: true, validators: [Validators.required, notBlank] });

	/** Bumped on every load so responses for a previously selected CR are ignored. */
	private requestSeq = 0;

	constructor(private readonly api: CrApiService, private readonly session: SessionService) {}

	ngOnInit(): void {
		void this.load();
	}

	ngOnChanges(changes: SimpleChanges): void {
		// The first value is loaded by ngOnInit; later changes mean a different CR was selected.
		if (changes['id'] && !changes['id'].firstChange) {
			this.rejectControl.reset();
			void this.load();
		}
	}

	async load(): Promise<void> {
		const seq = ++this.requestSeq;
		this.state = loading();
		this.actionError = undefined;
		this.submitting = null;
		try {
			const detail = await this.api.getChangeRequest(this.session.user, this.id);
			if (seq !== this.requestSeq) return;
			this.state = { status: 'loaded', data: detail };
		} catch (err) {
			if (seq !== this.requestSeq) return;
			this.state = { status: 'error', data: null, error: (err as Error).message };
		}
	}

	get detail(): CrDetail | null {
		return this.state.data;
	}

	get diff(): DiffRow[] {
		return this.detail ? computeDiff(this.detail.baselineLineItems, this.detail.proposedLineItems) : [];
	}

	/** Approval timeline, oldest-first. Sorts a copy so the loaded audit array is never mutated. */
	get timeline(): TimelineEntry[] {
		return [...(this.detail?.audit ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	}

	/** Approve/Reject only ever act on a PENDING_APPROVAL CR. */
	get isActionable(): boolean {
		return this.detail?.status === 'PENDING_APPROVAL';
	}

	/** Whether the current user's policies cover this CR (independent of its status). */
	get hasActionPermission(): boolean {
		return !!this.detail && canApproveCr(this.session.user, this.detail);
	}

	/** Whether the current user may approve the loaded CR: right status AND right policy. */
	get canApprove(): boolean {
		return this.isActionable && this.hasActionPermission;
	}

	/** Rejecting is gated by the same approve-scope policies as approving. */
	get canReject(): boolean {
		return this.isActionable && this.hasActionPermission;
	}

	fmt(amount: number): string {
		return this.detail ? formatMoney(amount, this.detail.currency) : String(amount);
	}

	async approve(): Promise<void> {
		if (!this.canApprove || this.submitting) return;
		await this.runAction('approve', (at) => this.api.approve(this.session.user, this.id, at));
	}

	async reject(): Promise<void> {
		if (!this.canReject || this.submitting) return;
		if (this.rejectControl.invalid) {
			this.rejectControl.markAsTouched();
			return;
		}
		const reason = this.rejectControl.value.trim();
		const ok = await this.runAction('reject', (at) => this.api.reject(this.session.user, this.id, at, reason));
		if (ok) this.rejectControl.reset();
	}

	/**
	 * Shared action flow: lock the controls, call the API, then either swap in the server's CR or show
	 * the error while keeping the current CR on screen. Returns whether the action succeeded.
	 */
	private async runAction(action: CrAction, call: (at: string) => Promise<CrDetail>): Promise<boolean> {
		const seq = this.requestSeq;
		this.submitting = action;
		this.actionError = undefined;
		try {
			const updated = await call(new Date().toISOString());
			if (seq !== this.requestSeq) return false;
			this.state = { status: 'loaded', data: updated };
			this.changed.emit(updated);
			return true;
		} catch (err) {
			if (seq !== this.requestSeq) return false;
			this.actionError = `Couldn't ${action} this change request: ${(err as Error).message}`;
			return false;
		} finally {
			if (seq === this.requestSeq) this.submitting = null;
		}
	}
}
