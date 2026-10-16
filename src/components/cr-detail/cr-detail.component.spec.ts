import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrDetailComponent } from './cr-detail.component';
import { SessionService } from '../../session/session.service';
import { CrApiService } from '../../api/cr-api.service';
import { users } from '../../api/fixtures';
import { ReqUser } from '../../models/cr.models';

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

interface RenderOptions {
	latencyMs?: number;
	failNext?: boolean;
}

async function render(user: ReqUser, id: string, opts: RenderOptions = {}): Promise<ComponentFixture<CrDetailComponent>> {
	TestBed.configureTestingModule({
		imports: [CrDetailComponent],
		providers: [{ provide: SessionService, useValue: { user } }],
	});
	await TestBed.compileComponents();
	const api = TestBed.inject(CrApiService);
	api.latencyMs = opts.latencyMs ?? 0;
	api.failNext = opts.failNext ?? false;
	const fixture = TestBed.createComponent(CrDetailComponent);
	fixture.componentInstance.id = id;
	fixture.detectChanges(); // ngOnInit -> load()
	await flush(api.latencyMs); // let the mock API resolve
	fixture.detectChanges(); // render the loaded state
	return fixture;
}

const $ = (f: ComponentFixture<unknown>, sel: string) => f.nativeElement.querySelector(sel) as HTMLElement | null;
const $$ = (f: ComponentFixture<unknown>, sel: string) => Array.from(f.nativeElement.querySelectorAll(sel)) as HTMLElement[];
const text = (f: ComponentFixture<unknown>, sel: string) => ($(f, sel)?.textContent ?? '').trim();

function typeReason(fixture: ComponentFixture<CrDetailComponent>, value: string): void {
	const textarea = $(fixture, '.cr-actions__reason') as HTMLTextAreaElement;
	textarea.value = value;
	textarea.dispatchEvent(new Event('input'));
	textarea.dispatchEvent(new Event('blur'));
	fixture.detectChanges();
}

describe('CrDetailComponent', () => {
	it('loads and renders the change request title', async () => {
		const fixture = await render(users.approver, 'CR-1');
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Add 1 unit of SKU-A');
	});

	it('disables Approve for a read-only viewer on a pending CR', async () => {
		const fixture = await render(users.viewer, 'CR-1'); // viewer: cr_r_o only; CR-1 is PENDING_APPROVAL
		const approveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');
		expect(approveBtn.disabled).toBe(true);
	});

	describe('load states', () => {
		it('shows the loading state while the API is in flight', async () => {
			TestBed.configureTestingModule({
				imports: [CrDetailComponent],
				providers: [{ provide: SessionService, useValue: { user: users.approver } }],
			});
			await TestBed.compileComponents();
			TestBed.inject(CrApiService).latencyMs = 20;
			const fixture = TestBed.createComponent(CrDetailComponent);
			fixture.componentInstance.id = 'CR-1';
			fixture.detectChanges();
			expect($(fixture, '.cr-detail__loading')).not.toBeNull();
			expect($(fixture, '.cr-detail__header')).toBeNull();
			await flush(20);
			fixture.detectChanges();
			expect($(fixture, '.cr-detail__loading')).toBeNull();
			expect($(fixture, '.cr-detail__header')).not.toBeNull();
		});

		it('shows an error with Retry when loading fails, and Retry recovers', async () => {
			const fixture = await render(users.approver, 'CR-1', { failNext: true });
			expect(text(fixture, '.cr-detail__error')).toContain('Network error');
			expect($(fixture, '.cr-detail__header')).toBeNull();

			($(fixture, '.cr-detail__error button') as HTMLButtonElement).click();
			await flush();
			fixture.detectChanges();
			expect($(fixture, '.cr-detail__error')).toBeNull();
			expect(text(fixture, '.cr-detail__header h2')).toContain('Add 1 unit of SKU-A');
		});

		it('treats a CR from another org as not found', async () => {
			const fixture = await render(users.otherOrg, 'CR-1');
			expect(text(fixture, '.cr-detail__error')).toContain('Not found');
		});

		it('ignores a stale response when the selected CR changes mid-load', async () => {
			TestBed.configureTestingModule({
				imports: [CrDetailComponent],
				providers: [{ provide: SessionService, useValue: { user: users.approver } }],
			});
			await TestBed.compileComponents();
			const api = TestBed.inject(CrApiService);
			const fixture = TestBed.createComponent(CrDetailComponent);
			const cmp = fixture.componentInstance;
			api.latencyMs = 30;
			cmp.id = 'CR-1';
			fixture.detectChanges(); // slow load of CR-1 starts
			api.latencyMs = 0;
			cmp.id = 'CR-3';
			cmp.ngOnChanges({ id: { previousValue: 'CR-1', currentValue: 'CR-3', firstChange: false, isFirstChange: () => false } });
			await flush(40); // both responses have arrived; CR-1's arrived last
			fixture.detectChanges();
			expect(text(fixture, '.cr-detail__header h2')).toContain('Extend agreement term');
		});
	});

	describe('diff panel and totals', () => {
		it('renders a row per SKU with its change kind', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const rows = $$(fixture, '.cr-diff__row').map((r) => [r.children[0].textContent?.trim(), r.getAttribute('data-kind')]);
			expect(rows).toEqual([
				['SKU-A', 'changed'],
				['SKU-B', 'unchanged'],
			]);
		});

		it('shows before/after quantity and price for a changed line', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const row = $$(fixture, '.cr-diff__row')[0];
			expect(row.querySelector('.cr-diff__before')?.textContent).toContain('10 × USD 500.00');
			expect(row.querySelector('.cr-diff__after')?.textContent).toContain('11 × USD 500.00');
		});

		it('marks a description-only change as changed', async () => {
			const fixture = await render(users.approver, 'CR-2'); // supplier rename, same qty/price
			expect($$(fixture, '.cr-diff__row')[0].getAttribute('data-kind')).toBe('changed');
		});

		it('renders formatted totals and a signed delta', async () => {
			const fixture = await render(users.approver, 'CR-1');
			expect(text(fixture, '.cr-detail__baseline-total')).toBe('USD 8,000.00');
			expect(text(fixture, '.cr-detail__new-total')).toBe('USD 8,500.00');
			expect(text(fixture, '.cr-detail__delta')).toBe('(Δ +USD 500.00)');
		});
	});

	describe('timeline', () => {
		it('renders audit entries oldest-first even when the API returns them newest-first', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const actions = $$(fixture, '.cr-timeline__action').map((e) => e.textContent?.trim());
			expect(actions).toEqual(['CREATE', 'SUBMIT', 'SEND_FOR_APPROVAL']);
		});

		it('does not mutate the loaded audit array when sorting', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const audit = fixture.componentInstance.detail?.audit ?? [];
			const before = audit.map((e) => e.action);
			void fixture.componentInstance.timeline;
			expect(audit.map((e) => e.action)).toEqual(before);
		});
	});

	describe('permission-aware actions', () => {
		it('enables Approve and shows the reject form for an org approver on a pending CR', async () => {
			const fixture = await render(users.approver, 'CR-1');
			expect(($(fixture, '.cr-actions__approve') as HTMLButtonElement).disabled).toBe(false);
			expect($(fixture, '.cr-actions__reason')).not.toBeNull();
			expect($(fixture, '.cr-actions__readonly')).toBeNull();
		});

		it('gives a read-only viewer no reject form and a read-only notice', async () => {
			const fixture = await render(users.viewer, 'CR-1');
			expect($(fixture, '.cr-actions__reject')).toBeNull();
			expect($(fixture, '.cr-actions__readonly')).not.toBeNull();
		});

		it('offers no actions on a non-pending CR, even to an approver', async () => {
			const fixture = await render(users.approver, 'CR-2'); // APPLIED
			expect($(fixture, '.cr-actions__approve')).toBeNull();
			expect($(fixture, '.cr-actions__reject')).toBeNull();
			expect(text(fixture, '.cr-actions__closed')).toContain('APPLIED');
		});

		it('lets a user-scope (cr_a_u) approver act only on CRs they raised', async () => {
			const owner: ReqUser = { id: 'alice', orgCode: 'org-alpha', policies: ['cr_r_o', 'cr_a_u'] };
			const other: ReqUser = { id: 'zed', orgCode: 'org-alpha', policies: ['cr_r_o', 'cr_a_u'] };
			const ownerFixture = await render(owner, 'CR-1');
			expect(($(ownerFixture, '.cr-actions__approve') as HTMLButtonElement).disabled).toBe(false);

			TestBed.resetTestingModule();
			const otherFixture = await render(other, 'CR-1');
			expect(($(otherFixture, '.cr-actions__approve') as HTMLButtonElement).disabled).toBe(true);
		});

		it('does nothing if approve() is called without permission', async () => {
			const fixture = await render(users.viewer, 'CR-1');
			const spy = jest.spyOn(TestBed.inject(CrApiService), 'approve');
			await fixture.componentInstance.approve();
			expect(spy).not.toHaveBeenCalled();
		});
	});

	describe('approve flow', () => {
		it('approves, updates the status, closes actions, and appends to the timeline', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const emitted = jest.fn();
			fixture.componentInstance.changed.subscribe(emitted);

			($(fixture, '.cr-actions__approve') as HTMLButtonElement).click();
			await flush();
			fixture.detectChanges();

			expect(text(fixture, '.cr-detail__header .cr-status')).toBe('APPROVED');
			expect($(fixture, '.cr-actions__approve')).toBeNull();
			const entries = $$(fixture, '.cr-timeline__entry');
			expect(entries[entries.length - 1].textContent).toContain('APPROVE');
			expect(entries[entries.length - 1].textContent).toContain('mona');
			expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ id: 'CR-1', status: 'APPROVED' }));
		});

		it('locks both actions while a slow approve is in flight and sends only one request on double click', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const api = TestBed.inject(CrApiService);
			const spy = jest.spyOn(api, 'approve');
			api.latencyMs = 30;

			const approveBtn = $(fixture, '.cr-actions__approve') as HTMLButtonElement;
			approveBtn.click();
			approveBtn.click(); // second click before change detection runs
			fixture.detectChanges();

			expect(spy).toHaveBeenCalledTimes(1);
			expect(approveBtn.disabled).toBe(true);
			expect(approveBtn.textContent).toContain('Approving…');
			expect(($(fixture, '.cr-actions__reject-btn') as HTMLButtonElement).disabled).toBe(true);

			await flush(40);
			fixture.detectChanges();
			expect(text(fixture, '.cr-detail__header .cr-status')).toBe('APPROVED');
		});

		it('keeps the CR on screen and shows an error when approve fails, then allows a retry', async () => {
			const fixture = await render(users.approver, 'CR-1');
			TestBed.inject(CrApiService).failNext = true;

			($(fixture, '.cr-actions__approve') as HTMLButtonElement).click();
			await flush();
			fixture.detectChanges();

			expect(text(fixture, '.cr-actions__error')).toContain('Network error');
			expect(text(fixture, '.cr-detail__header .cr-status')).toBe('PENDING_APPROVAL');
			expect($(fixture, '.cr-diff__table')).not.toBeNull();
			const approveBtn = $(fixture, '.cr-actions__approve') as HTMLButtonElement;
			expect(approveBtn.disabled).toBe(false);

			approveBtn.click();
			await flush();
			fixture.detectChanges();
			expect($(fixture, '.cr-actions__error')).toBeNull();
			expect(text(fixture, '.cr-detail__header .cr-status')).toBe('APPROVED');
		});
	});

	describe('reject flow and validation', () => {
		it('keeps Reject disabled until a reason is entered', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const rejectBtn = $(fixture, '.cr-actions__reject-btn') as HTMLButtonElement;
			expect(rejectBtn.disabled).toBe(true);
			typeReason(fixture, 'Price not agreed');
			expect(rejectBtn.disabled).toBe(false);
		});

		it('treats a whitespace-only reason as invalid and shows the validation message', async () => {
			const fixture = await render(users.approver, 'CR-1');
			typeReason(fixture, '   ');
			expect(($(fixture, '.cr-actions__reject-btn') as HTMLButtonElement).disabled).toBe(true);
			expect($(fixture, '.cr-actions__reason-error')).not.toBeNull();
		});

		it('does not call the API when reject() runs with an invalid reason', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const spy = jest.spyOn(TestBed.inject(CrApiService), 'reject');
			await fixture.componentInstance.reject();
			fixture.detectChanges();
			expect(spy).not.toHaveBeenCalled();
			expect($(fixture, '.cr-actions__reason-error')).not.toBeNull();
		});

		it('rejects with the trimmed reason and shows it in the timeline', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const spy = jest.spyOn(TestBed.inject(CrApiService), 'reject');
			typeReason(fixture, '  Price not agreed  ');
			($(fixture, '.cr-actions__reject-btn') as HTMLButtonElement).click();
			await flush();
			fixture.detectChanges();

			expect(spy).toHaveBeenCalledWith(users.approver, 'CR-1', expect.any(String), 'Price not agreed');
			expect(text(fixture, '.cr-detail__header .cr-status')).toBe('REJECTED');
			const notes = $$(fixture, '.cr-timeline__note').map((n) => n.textContent);
			expect(notes).toContain('“Price not agreed”');
			expect($(fixture, '.cr-actions__reject')).toBeNull();
		});

		it('keeps the typed reason and shows an error when reject fails', async () => {
			const fixture = await render(users.approver, 'CR-1');
			typeReason(fixture, 'Price not agreed');
			TestBed.inject(CrApiService).failNext = true;
			($(fixture, '.cr-actions__reject-btn') as HTMLButtonElement).click();
			await flush();
			fixture.detectChanges();

			expect(text(fixture, '.cr-actions__error')).toContain("Couldn't reject");
			expect(text(fixture, '.cr-detail__header .cr-status')).toBe('PENDING_APPROVAL');
			expect(($(fixture, '.cr-actions__reason') as HTMLTextAreaElement).value).toBe('Price not agreed');
			expect(($(fixture, '.cr-actions__reject-btn') as HTMLButtonElement).disabled).toBe(false);
		});
	});
});
