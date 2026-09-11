/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {createTransactionsFeature} from '@/features/transactions/service';
import {createRecurringFeature} from './service';
import {noonOf} from './date';

/**
 * End-to-end integration on the REAL SQLite engine: generated rows are
 * NORMAL transactions — they flow through the existing combined
 * transactions feature (ledger + dashboard) and the same aggregates the
 * reports and budget screens use, with NO recurring-specific calculation
 * anywhere (spec §20/§23).
 */

const AUG_1 = noonOf(2026, 8, 1);
const SEP_1 = noonOf(2026, 9, 1);
const SEP_8 = noonOf(2026, 9, 8);
const OCT_1 = noonOf(2026, 10, 1);

async function seedDueRules(service: DatabaseService) {
  const rentCategory = await service.categories.create({
    name: 'Rent',
    icon: 'home',
    type: 'expense',
  });
  const foodCategory = await service.categories.create({
    name: 'Meals',
    icon: 'restaurant',
    type: 'expense',
  });
  const salaryCategory = await service.categories.findByName(
    'Salary',
    'income',
  );

  const recurring = createRecurringFeature(service);
  const rent = await recurring.addRule({
    type: 'expense',
    amount: 12_000_00,
    title: 'Hostel rent',
    categoryId: rentCategory.id,
    frequency: 'monthly',
    startDate: AUG_1,
    nextOccurrenceAt: AUG_1,
    paymentMethod: 'cash',
  });
  const salary = await recurring.addRule({
    type: 'income',
    amount: 85_000_00,
    title: 'Salary',
    frequency: 'monthly',
    startDate: AUG_1,
    nextOccurrenceAt: AUG_1,
  });

  // One manual expense in the SAME month for comparison.
  await service.expenses.create({
    amount: 12_345,
    title: 'Manual lunch',
    categoryId: foodCategory.id,
    date: SEP_8,
    paymentMethod: 'card',
  });

  return {
    recurring,
    rent,
    salary,
    rentCategory,
    salaryCategoryId: salaryCategory!.id,
  };
}

describe('generated transactions integrate with the existing ledger', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('appears in the mixed transactions page with the recurring marker', async () => {
    const {recurring} = await seedDueRules(service);
    await recurring.processDue(SEP_8);

    const transactions = createTransactionsFeature(service);
    const page = await transactions.getTransactionPage({});

    const rent = page.items.find(item => item.title === 'Hostel rent');
    expect(rent).toBeDefined();
    expect(rent!.type).toBe('expense');
    expect(rent!.amount).toBe(12_000_00);
    expect(rent!.category).toBe('Rent');
    expect(rent!.recurringRuleId).toBeGreaterThan(0);

    const salary = page.items.find(item => item.title === 'Salary');
    expect(salary).toBeDefined();
    expect(salary!.type).toBe('income');
    expect(salary!.recurringRuleId).toBeGreaterThan(0);

    // The manual record has no marker.
    const manual = page.items.find(item => item.title === 'Manual lunch');
    expect(manual!.recurringRuleId ?? null).toBeNull();
  });

  it('is included in dashboard totals and category breakdown', async () => {
    const {recurring, rentCategory} = await seedDueRules(service);
    await recurring.processDue(SEP_8);

    const transactions = createTransactionsFeature(service);
    const snapshot = await transactions.getDashboardSnapshot(SEP_8);

    // Month totals include the September rows only: generated rent (Sep 1)
    // AND the manual expense (Sep 8). The August occurrences fall outside
    // the month window — exactly like manual records.
    expect(snapshot.monthExpense).toBe(12_000_00 + 12_345);
    expect(snapshot.monthIncome).toBe(85_000_00); // September salary only

    const rentTotal = snapshot.categoryTotals.find(
      total => total.categoryId === rentCategory.id,
    );
    expect(rentTotal!.total).toBe(12_000_00);

    // Today's snapshot on Oct 1 stays clean — occurrences were in Aug/Sep.
    const later = await transactions.getDashboardSnapshot(OCT_1);
    expect(later.monthExpense).toBe(0);
    expect(later.monthIncome).toBe(0);
  });

  it('flows into the report/budget aggregates (same queries, no special-casing)', async () => {
    const {recurring, rentCategory} = await seedDueRules(service);
    await recurring.processDue(SEP_8);

    // `sumByCategory` + `sumAmount` + `sumByDay` are the exact inputs the
    // reports feature and the budget progress math consume. Both the
    // generated rent and the manual lunch count, side by side.
    const totals = await service.expenses.sumByCategory({
      fromDate: SEP_1,
      toDate: SEP_8,
    });
    expect(totals).toContainEqual({
      categoryId: rentCategory.id,
      total: 12_000_00,
    });
    expect(totals).toHaveLength(2); // ...plus the manual category

    expect(
      await service.expenses.sumAmount({fromDate: AUG_1, toDate: SEP_8}),
    ).toBe(12_000_00 * 2 + 12_345); // Aug + Sep rent, plus the manual row

    const byDay = await service.expenses.sumByDay({
      fromDate: SEP_1,
      toDate: SEP_8,
    });
    const dayIndex = (SEP_8 - SEP_1) / 86_400_000;
    // Sep 1 (rent, day 0) and Sep 8 (manual, day 7) are different days —
    // each daily bucket carries exactly the rows of its own calendar day.
    expect(byDay).toEqual([
      {dayIndex: 0, total: 12_000_00},
      {dayIndex, total: 12_345},
    ]);
  });

  it('keeps generated history immutable when the rule is edited or deleted', async () => {
    const {recurring, rent} = await seedDueRules(service);
    await recurring.processDue(SEP_8);

    await recurring.editRule(rent.id, {amount: 99_999_00, title: 'New rent'});
    const amounts = (await service.expenses.list({order: 'dateAsc'})).map(
      expense => expense.amount,
    );
    expect(amounts).toEqual([12_000_00, 12_000_00, 12_345]);

    // Pausing stops future generation; history stays.
    await recurring.pauseRule(rent.id);
    await recurring.processDue(OCT_1);
    expect(await service.expenses.count()).toBe(3);

    // Deleting the rule keeps the generated rows (reference becomes null).
    await recurring.removeRule(rent.id);
    const expenses = await service.expenses.list();
    expect(expenses).toHaveLength(3);
    const generated = expenses.filter(
      expense => expense.title === 'Hostel rent',
    );
    expect(generated).toHaveLength(2);
    for (const expense of generated) {
      expect(expense.recurringRuleId ?? null).toBeNull();
    }
  });
});

describe('recurring feature service', () => {
  let service: DatabaseService;
  let recurring: ReturnType<typeof createRecurringFeature>;

  beforeEach(async () => {
    service = await createTestService();
    recurring = createRecurringFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  it('lists only ACTIVE categories in the picker (spec §8)', async () => {
    const categories = await recurring.listCategories('expense');
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(category.isActive).toBe(true);
    }
  });

  it('flags rules whose category was archived as needing attention', async () => {
    const rentCategory = await service.categories.create({
      name: 'Attention',
      icon: 'home',
      type: 'expense',
    });
    const rule = await recurring.addRule({
      type: 'expense',
      amount: 1_000,
      title: 'Blocked rule',
      categoryId: rentCategory.id,
      frequency: 'monthly',
      startDate: AUG_1,
      nextOccurrenceAt: AUG_1,
      paymentMethod: 'cash',
    });

    let items = await recurring.listRules('expense');
    expect(items.find(item => item.id === rule.id)!.needsAttention).toBe(false);

    await service.categories.update(rentCategory.id, {isActive: false});
    items = await recurring.listRules('expense');
    expect(items.find(item => item.id === rule.id)!.needsAttention).toBe(true);

    // Resume after restore-of-category works through the service too.
    await service.categories.update(rentCategory.id, {isActive: true});
    items = await recurring.listRules('expense');
    expect(items.find(item => item.id === rule.id)!.needsAttention).toBe(false);
  });

  it('resume skips missed occurrences instead of dumping a backlog (spec §10)', async () => {
    const rentCategory = await service.categories.create({
      name: 'Gym',
      icon: 'fitness',
      type: 'expense',
    });
    const rule = await recurring.addRule({
      type: 'expense',
      amount: 1_000,
      title: 'Gym',
      categoryId: rentCategory.id,
      frequency: 'monthly',
      startDate: AUG_1,
      nextOccurrenceAt: AUG_1,
      paymentMethod: 'cash',
    });

    await recurring.pauseRule(rule.id);
    const resumed = await recurring.resumeRule(rule.id, SEP_8);

    expect(resumed.isActive).toBe(true);
    expect(resumed.nextOccurrenceAt).toBe(OCT_1); // first occurrence AFTER today

    const result = await recurring.processDue(SEP_8);
    expect(result.generatedExpenses).toBe(0);
  });

  it('pause keeps the next occurrence and stops generation', async () => {
    const streamCategory = await service.categories.create({
      name: 'Subscriptions',
      icon: 'film',
      type: 'expense',
    });
    const rule = await recurring.addRule({
      type: 'expense',
      amount: 1_000,
      title: 'Streaming',
      categoryId: streamCategory.id,
      frequency: 'monthly',
      startDate: AUG_1,
      nextOccurrenceAt: AUG_1,
      paymentMethod: 'card',
    });

    const paused = await recurring.pauseRule(rule.id);
    expect(paused.isActive).toBe(false);
    expect(paused.nextOccurrenceAt).toBe(AUG_1);

    const result = await recurring.processDue(SEP_8);
    expect(result.generatedExpenses).toBe(0);
    expect(await service.expenses.count()).toBe(0);
  });

  it('processDue surfaces typed processing results through the feature', async () => {
    await recurring.addRule({
      type: 'income',
      amount: 5_000,
      title: 'Dividends',
      frequency: 'daily',
      startDate: SEP_1,
      nextOccurrenceAt: SEP_1,
    });

    const result = await recurring.processDue(SEP_8);
    expect(result.generatedIncome).toBe(8);
    expect(result.generatedExpenses).toBe(0);
    expect(result.completedRules).toBe(0);
    expect(result.blockedRuleIds).toEqual([]);
  });
});
