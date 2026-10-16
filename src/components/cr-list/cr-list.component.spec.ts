import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrListComponent } from './cr-list.component';
import { SessionService } from '../../session/session.service';
import { CrApiService } from '../../api/cr-api.service';
import { users } from '../../api/fixtures';
import { ReqUser } from '../../models/cr.models';

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function setup(user: ReqUser, opts: { latencyMs?: number; failNext?: boolean } = {}): Promise<ComponentFixture<CrListComponent>> {
	TestBed.configureTestingModule({
		imports: [CrListComponent],
		providers: [{ provide: SessionService, useValue: { user } }],
	});
	await TestBed.compileComponents();
	const api = TestBed.inject(CrApiService);
	api.latencyMs = opts.latencyMs ?? 0;
	api.failNext = opts.failNext ?? false;
	return TestBed.createComponent(CrListComponent);
}

async function render(user: ReqUser, opts: { failNext?: boolean } = {}): Promise<ComponentFixture<CrListComponent>> {
	const fixture = await setup(user, opts);
	fixture.detectChanges(); // ngOnInit -> load()
	await flush(); // let the mock API resolve
	fixture.detectChanges(); // render the loaded/empty state
	return fixture;
}

const rowIds = (f: ComponentFixture<CrListComponent>) =>
	Array.from(f.nativeElement.querySelectorAll('.cr-list__row td:first-child') as NodeListOf<HTMLElement>).map((td) =>
		td.textContent?.trim(),
	);

function chooseStatus(fixture: ComponentFixture<CrListComponent>, status: string): void {
	const select: HTMLSelectElement = fixture.nativeElement.querySelector('.cr-list__filter');
	select.value = status;
	select.dispatchEvent(new Event('change'));
	fixture.detectChanges();
}

describe('CrListComponent', () => {
	it('renders a row per change request in the user org', async () => {
		const fixture = await render(users.approver);
		expect(fixture.nativeElement.querySelectorAll('.cr-list__row').length).toBe(3); // org-alpha: CR-1, CR-2, CR-3
	});

	it('shows the empty state when the org has no change requests', async () => {
		const fixture = await render({ id: 'x', orgCode: 'org-empty', policies: ['cr_r_o'] });
		expect(fixture.nativeElement.querySelector('.cr-list__empty')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
	});

	it('only shows CRs from the user org', async () => {
		const fixture = await render(users.otherOrg);
		expect(rowIds(fixture)).toEqual(['CR-9']);
	});

	it('shows the loading state until the API resolves', async () => {
		const fixture = await setup(users.approver, { latencyMs: 20 });
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-list__loading')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
		await flush(20);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-list__loading')).toBeNull();
		expect(rowIds(fixture).length).toBe(3);
	});

	it('shows an error with Retry, and Retry recovers', async () => {
		const fixture = await render(users.approver, { failNext: true });
		const error: HTMLElement = fixture.nativeElement.querySelector('.cr-list__error');
		expect(error.textContent).toContain('Network error');
		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();

		(error.querySelector('button') as HTMLButtonElement).click();
		await flush();
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-list__error')).toBeNull();
		expect(rowIds(fixture).length).toBe(3);
	});

	it('renders the delta as formatted money', async () => {
		const fixture = await render(users.approver);
		expect(fixture.nativeElement.querySelector('.cr-list__delta').textContent.trim()).toBe('USD 500.00');
	});

	describe('status filter', () => {
		it('narrows the rendered rows to the chosen status', async () => {
			const fixture = await render(users.approver);
			chooseStatus(fixture, 'PENDING_APPROVAL');
			expect(rowIds(fixture)).toEqual(['CR-1']);
			expect(fixture.componentInstance.visibleRows.map((r) => r.id)).toEqual(['CR-1']);
		});

		it('shows every row again for ALL', async () => {
			const fixture = await render(users.approver);
			chooseStatus(fixture, 'DRAFT');
			chooseStatus(fixture, 'ALL');
			expect(rowIds(fixture)).toEqual(['CR-1', 'CR-2', 'CR-3']);
		});

		it('shows a no-match message (not the empty state) when nothing matches, with a way back', async () => {
			const fixture = await render(users.approver);
			chooseStatus(fixture, 'REJECTED');
			expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-list__empty')).toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-list__no-match').textContent).toContain('REJECTED');

			fixture.nativeElement.querySelector('.cr-list__clear-filter').click();
			fixture.detectChanges();
			expect(rowIds(fixture).length).toBe(3);
		});

		it('keeps the filter across a reload and does not re-fetch on filter change', async () => {
			const fixture = await render(users.approver);
			const spy = jest.spyOn(TestBed.inject(CrApiService), 'listChangeRequests');
			chooseStatus(fixture, 'APPLIED');
			expect(spy).not.toHaveBeenCalled();

			await fixture.componentInstance.load();
			fixture.detectChanges();
			expect(rowIds(fixture)).toEqual(['CR-2']);
		});
	});

	it('emits the CR id when a row is clicked and highlights the selected row', async () => {
		const fixture = await render(users.approver);
		const selected = jest.fn();
		fixture.componentInstance.select.subscribe(selected);
		fixture.nativeElement.querySelectorAll('.cr-list__row')[1].click();
		expect(selected).toHaveBeenCalledWith('CR-2');

		fixture.componentInstance.selectedId = 'CR-2';
		fixture.detectChanges();
		const highlighted = fixture.nativeElement.querySelectorAll('.cr-list__row--selected');
		expect(highlighted.length).toBe(1);
		expect(highlighted[0].textContent).toContain('CR-2');
	});
});
