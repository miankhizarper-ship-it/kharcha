/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {appendMissingCategory} from './picker';
import {createCategoriesFeature} from './service';
import {createExpenseFeature} from '@/features/expenses/service';
import {createIncomeFeature} from '@/features/income/service';
import {createReportFeature} from '@/features/reports/service';
import type {ReportSelection} from '@/features/reports/types';
import {initialCategoryFormValues} from './form';

/**
 * Cross-feature integration: category management interacts correctly with
 * the transaction forms and the reports, and archived categories never
 * break historical records.
 */
describe('category lifecycle integration', () => {
  let service: DatabaseService;
  let categories: ReturnType<typeof createCategoriesFeature>;
  let expenses: ReturnType<typeof createExpenseFeature>;
  let incomes: ReturnType<typeof createIncomeFeature>;
  let reports: ReturnType<typeof createReportFeature>;

  /** Fixed local timestamp (Sep 7 2026) — deterministic windows. */
  const NOW = new Date(2026, 8, 7, 15, 30).getTime();

  beforeEach(async () => {
    service = await createTestService();
    categories = createCategoriesFeature(service);
    expenses = createExpenseFeature(service);
    incomes = createIncomeFeature(service);
    reports = createReportFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  function formValues(name: string, type: 'expense' | 'income') {
    return {...initialCategoryFormValues(type), name, icon: 'tag'};
  }

  it('new-transaction pickers offer active categories only', async () => {
    const kept = await categories.addCategory(
      formValues('Active Cat', 'expense'),
    );
    const archived = await categories.addCategory(
      formValues('Archived Cat', 'expense'),
    );
    await categories.editCategory(
      archived.id,
      {...formValues('Archived Cat', 'expense'), isActive: false},
      formValues('Archived Cat', 'expense'),
    );

    const pickerCategories = await expenses.listCategories('expense');
    const ids = pickerCategories.map(category => category.id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(archived.id);
  });

  it('income source picker offers active income categories only', async () => {
    const kept = await categories.addCategory(
      formValues('Active Source', 'income'),
    );
    const archived = await categories.addCategory(
      formValues('Archived Source', 'income'),
    );
    await categories.editCategory(
      archived.id,
      {...formValues('Archived Source', 'income'), isActive: false},
      formValues('Archived Source', 'income'),
    );

    const sources = await incomes.listCategories('income');
    expect(sources.map(category => category.id)).toContain(kept.id);
    expect(sources.map(category => category.id)).not.toContain(archived.id);
  });

  it('historical expenses keep resolving an archived category everywhere', async () => {
    const category = await categories.addCategory(
      formValues('Legacy', 'expense'),
    );
    await service.expenses.create({
      amount: 45_000,
      title: 'Old expense',
      categoryId: category.id,
      date: NOW,
      paymentMethod: 'cash',
    });

    // Archive AFTER the expense exists.
    await categories.editCategory(
      category.id,
      {...formValues('Legacy', 'expense'), isActive: false},
      formValues('Legacy', 'expense'),
    );

    // The ledger join still resolves name + icon.
    const joined = await service.expenses.listWithCategory({});
    expect(joined[0]?.categoryName).toBe('Legacy');

    // The reports breakdown still names the archived category.
    const selection: ReportSelection = {kind: 'month', year: 2026, month: 9};
    const snapshot = await reports.getReportSnapshot(selection, NOW);
    expect(snapshot.categoryBreakdown).toHaveLength(1);
    expect(snapshot.categoryBreakdown[0]?.name).toBe('Legacy');
    expect(snapshot.expenses).toBe(45_000);
  });

  it('historical income re-resolves its archived source for editing', async () => {
    const source = await categories.addCategory(
      formValues('Old Source', 'income'),
    );
    await service.income.create({
      amount: 100_000,
      source: source.name,
      date: NOW,
    });
    await categories.editCategory(
      source.id,
      {...formValues('Old Source', 'income'), isActive: false},
      formValues('Old Source', 'income'),
    );

    const resolved = await incomes.findCategoryByName('old source');
    expect(resolved?.id).toBe(source.id);
    expect(resolved?.isActive).toBe(false);

    // The edit-flow merge keeps it visible in the picker.
    const active = await incomes.listCategories('income');
    const merged = appendMissingCategory(active, resolved);
    expect(merged.some(category => category.id === source.id)).toBe(true);
  });

  it('editing a historical expense with an archived category stays possible', async () => {
    const category = await categories.addCategory(
      formValues('Legacy', 'expense'),
    );
    const expense = await service.expenses.create({
      amount: 45_000,
      title: 'Old expense',
      categoryId: category.id,
      date: NOW,
      paymentMethod: 'cash',
    });
    await categories.editCategory(
      category.id,
      {...formValues('Legacy', 'expense'), isActive: false},
      formValues('Legacy', 'expense'),
    );

    const active = await expenses.listCategories('expense');
    const legacy = await expenses.getCategory(category.id);
    const merged = appendMissingCategory(active, legacy);

    expect(legacy?.isActive).toBe(false);
    expect(merged.map(category => category.id)).toContain(category.id);

    // The record itself still saves unchanged (same category id).
    const updated = await expenses.editExpense(expense.id, {
      title: 'Old expense (renamed)',
    });
    expect(updated.categoryId).toBe(category.id);
    expect(updated.title).toBe('Old expense (renamed)');
  });
});
