import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrApiService } from '../../api/cr-api.service';
import { SessionService } from '../../session/session.service';
import { CrStatus, CrSummary } from '../../models/cr.models';
import { idle, loading, ViewState } from '../../common/view-state';
import { formatMoney } from '../../common/money.util';

/**
 * Change Request LIST page. Loads the caller's CRs and renders loading / loaded / empty / error
 * states, plus a status filter. The filter only narrows what is rendered (`visibleRows`); `state`
 * always holds the full server result, so changing the filter never re-fetches.
 */
@Component({
	selector: 'app-cr-list',
	standalone: true,
	imports: [CommonModule],
	templateUrl: './cr-list.component.html',
})
export class CrListComponent implements OnInit {
	@Output() select = new EventEmitter<string>();
	/** The CR currently open in the detail pane, highlighted in the table. */
	@Input() selectedId: string | null = null;

	state: ViewState<CrSummary[]> = idle();
	statusFilter: CrStatus | 'ALL' = 'ALL';
	readonly statuses: (CrStatus | 'ALL')[] = [
		'ALL',
		'DRAFT',
		'SUBMITTED',
		'PENDING_APPROVAL',
		'APPROVED',
		'APPLIED',
		'REJECTED',
		'CANCELLED',
	];

	constructor(private readonly api: CrApiService, private readonly session: SessionService) {}

	ngOnInit(): void {
		void this.load();
	}

	async load(): Promise<void> {
		this.state = loading();
		try {
			const rows = await this.api.listChangeRequests(this.session.user);
			this.state = { status: rows.length ? 'loaded' : 'empty', data: rows };
		} catch (err) {
			this.state = { status: 'error', data: null, error: (err as Error).message };
		}
	}

	onFilterChange(value: string): void {
		this.statusFilter = value as CrStatus | 'ALL';
	}

	/** Rows to render, after applying the active status filter. */
	get visibleRows(): CrSummary[] {
		const rows = this.state.data ?? [];
		return this.statusFilter === 'ALL' ? rows : rows.filter((r) => r.status === this.statusFilter);
	}

	fmt(cr: CrSummary): string {
		return formatMoney(cr.delta, cr.currency);
	}
}
