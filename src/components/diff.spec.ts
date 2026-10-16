import { computeDiff } from './diff.util';
import { LineItem } from '../models/cr.models';

const base: LineItem[] = [
	{ sku: 'SKU-A', description: 'Widget A', quantity: 10, unitPrice: 500 },
	{ sku: 'SKU-B', description: 'Widget B', quantity: 30, unitPrice: 100 },
];

describe('computeDiff', () => {
	it('detects a removed sku', () => {
		expect(computeDiff(base, [base[0]]).find((r) => r.sku === 'SKU-B')?.kind).toBe('removed');
	});

	it('detects an added sku', () => {
		const rows = computeDiff(base, [...base, { sku: 'SKU-C', description: 'C', quantity: 1, unitPrice: 5 }]);
		expect(rows.find((r) => r.sku === 'SKU-C')?.kind).toBe('added');
	});

	it('detects a quantity-only change as changed', () => {
		// SKU-A quantity 10 -> 11 (same unit price) is a real change.
		const rows = computeDiff(base, [{ ...base[0], quantity: 11 }, base[1]]);
		expect(rows.find((r) => r.sku === 'SKU-A')?.kind).toBe('changed');
	});
});

describe('computeDiff — more cases', () => {
	it('marks identical lines as unchanged', () => {
		expect(
			computeDiff(
				base,
				base.map((b) => ({ ...b })),
			).map((r) => r.kind),
		).toEqual(['unchanged', 'unchanged']);
	});

	it('detects a price-only change as changed', () => {
		const rows = computeDiff(base, [{ ...base[0], unitPrice: 550 }, base[1]]);
		expect(rows.find((r) => r.sku === 'SKU-A')?.kind).toBe('changed');
	});

	it('detects a description-only change as changed', () => {
		const rows = computeDiff(base, [base[0], { ...base[1], description: 'Widget B (new supplier)' }]);
		expect(rows.find((r) => r.sku === 'SKU-B')?.kind).toBe('changed');
	});

	it('keeps both sides on a changed row and one side on added/removed rows', () => {
		const rows = computeDiff(
			[base[0]],
			[
				{ ...base[0], quantity: 11 },
				{ sku: 'SKU-C', description: 'C', quantity: 1, unitPrice: 5 },
			],
		);
		const changed = rows.find((r) => r.sku === 'SKU-A');
		expect(changed?.baseline?.quantity).toBe(10);
		expect(changed?.proposed?.quantity).toBe(11);
		const added = rows.find((r) => r.sku === 'SKU-C');
		expect(added?.kind).toBe('added');
		expect(added?.baseline).toBeUndefined();
	});

	it('lists baseline SKUs first (in order), then added SKUs', () => {
		const rows = computeDiff(base, [{ sku: 'SKU-C', description: 'C', quantity: 1, unitPrice: 5 }, base[1]]);
		expect(rows.map((r) => [r.sku, r.kind])).toEqual([
			['SKU-A', 'removed'],
			['SKU-B', 'unchanged'],
			['SKU-C', 'added'],
		]);
	});

	it('handles empty baseline and proposed', () => {
		expect(computeDiff([], [])).toEqual([]);
		expect(computeDiff([], base).every((r) => r.kind === 'added')).toBe(true);
		expect(computeDiff(base, []).every((r) => r.kind === 'removed')).toBe(true);
	});
});
