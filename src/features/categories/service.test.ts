/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {initialCategoryFormValues} from './form';
import {createCategoriesFeature} from './service';
import type {CategoriesFeature} from './service';
import type {CategoryFormValues} from './types';

/**
 * Category management on the REAL SQLite engine (node:sqlite driver, same
 * migrations and repositories as production): listing, duplicates, editing,
 * archiving and the delete-safety rules.
 */
describe('CategoriesFeature', () => {
  let service: DatabaseService;
  let feature: CategoriesFeature;

  beforeEach(async () => {
    service = await createTestService();
    feature = createCategoriesFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  function formValues(
    overrides: Partial<CategoryFormValues> = {},
  ): CategoryFormValues {
    return {...initialCategoryFormValues('expense'), ...overrides};
  }

  async function createCategory(
    name: string,
    type: 'expense' | 'income' = 'expense',
  ) {
    return feature.addCategory(formValues({name, type, icon: 'tag'}));
  }

  /* --------------------------------- listing -------------------------------- */

  it('lists every category of a type (active + archived), sorted A-Z', async () => {
    await createCategory('Zeta');
    const archived = await createCategory('Alpha');
    await feature.editCategory(
      archived.id,
      formValues({name: 'Alpha', isActive: false}),
      formValues({name: 'Alpha'}),
    );

    const all = await feature.listCategories('expense');
    const userRows = all.filter(row => ['Zeta', 'Alpha'].includes(row.name));
    expect(userRows.map(row => row.name)).toEqual(['Alpha', 'Zeta']);
    expect(userRows.find(row => row.name === 'Alpha')?.isActive).toBe(false);
  });

  it('lists active-only categories for transaction pickers', async () => {
    const kept = await createCategory('Kept');
    const archived = await createCategory('Archived');
    await feature.editCategory(
      archived.id,
      formValues({name: 'Archived', isActive: false}),
      formValues({name: 'Archived'}),
    );

    const active = await feature.listActiveCategories('expense');
    const activeIds = active.map(row => row.id);
    expect(activeIds).toContain(kept.id);
    expect(activeIds).not.toContain(archived.id);
    // Seeded categories stay active and therefore listed.
    expect(activeIds.length).toBeGreaterThan(2);
  });

  it('finds a category by name case-insensitively within its type', async () => {
    const created = await createCategory('Zakat');
    expect((await feature.findCategoryByName('zakat', 'expense'))?.id).toBe(
      created.id,
    );
    expect((await feature.findCategoryByName('Zakat', 'income')) === null).toBe(
      true,
    );
    expect(await feature.findCategoryByName('Missing', 'expense')).toBeNull();
  });

  /* ------------------------------ create + dupes ----------------------------- */

  it('creates a category with sane defaults', async () => {
    const created = await feature.addCategory(
      formValues({name: 'Fuel', icon: 'car'}),
    );
    expect(created).toMatchObject({
      name: 'Fuel',
      icon: 'car',
      type: 'expense',
      isDefault: false,
      isActive: true,
    });
  });

  it('rejects duplicate names within the same type (case-insensitive)', async () => {
    await createCategory('Fuel');
    await expect(
      feature.addCategory(formValues({name: 'fuel'})),
    ).rejects.toThrow(/already exists/i);
    // Different type with the same name is allowed by the schema.
    await expect(
      feature.addCategory(formValues({name: 'Fuel', type: 'income'})),
    ).resolves.toMatchObject({type: 'income'});
  });

  it('rejects whitespace-only names via the repository guards', async () => {
    await expect(
      feature.addCategory(formValues({name: '   '})),
    ).rejects.toThrow();
  });

  /* --------------------------------- editing -------------------------------- */

  it('edits name, icon and active state but never the type', async () => {
    const created = await createCategory('Old Name');
    const original = formValues({name: 'Old Name', icon: 'tag'});

    const updated = await feature.editCategory(
      created.id,
      formValues({name: 'New Name', icon: 'car', isActive: false}),
      original,
    );

    expect(updated).toMatchObject({
      name: 'New Name',
      icon: 'car',
      isActive: false,
      type: 'expense',
    });
  });

  it('allows renaming a category to its own name in any casing', async () => {
    const created = await createCategory('Fuel');
    const updated = await feature.editCategory(
      created.id,
      formValues({name: 'FUEL'}),
      formValues({name: 'Fuel'}),
    );
    expect(updated.name).toBe('FUEL');
  });

  it("rejects renaming to another category's name", async () => {
    await createCategory('First');
    const second = await createCategory('Second');
    await expect(
      feature.editCategory(
        second.id,
        formValues({name: 'first'}),
        formValues({name: 'Second'}),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('archiving hides the category from pickers but keeps it listed', async () => {
    const created = await createCategory('Netflix');
    await feature.editCategory(
      created.id,
      formValues({name: 'Netflix', isActive: false}),
      formValues({name: 'Netflix'}),
    );

    expect(
      (await feature.listActiveCategories('expense')).map(row => row.id),
    ).not.toContain(created.id);
    expect(
      (await feature.listCategories('expense')).map(row => row.id),
    ).toContain(created.id);
  });

  it('reports missing categories when editing a deleted row', async () => {
    const created = await createCategory('Ghost');
    await service.categories.delete(created.id);
    await expect(
      feature.editCategory(
        created.id,
        formValues({name: 'Ghost 2'}),
        formValues({name: 'Ghost'}),
      ),
    ).rejects.toThrow(/no longer exists/i);
  });

  /* --------------------------- deletion safety ------------------------------ */

  it('deletes an unused, unbudgeted category', async () => {
    const created = await createCategory('Disposable');
    await expect(feature.deleteCategory(created.id)).resolves.toEqual({
      deleted: true,
    });
    expect(await service.categories.getById(created.id)).toBeNull();
  });

  it('blocks deleting a category referenced by expenses', async () => {
    const category = await createCategory('Used By Expenses');
    await service.expenses.create({
      amount: 25_000,
      title: 'Historical expense',
      categoryId: category.id,
      date: Date.now(),
      paymentMethod: 'cash',
    });

    await expect(feature.deleteCategory(category.id)).resolves.toEqual({
      deleted: false,
      blocker: 'expenses',
    });
    // Nothing was destroyed.
    expect(await service.categories.getById(category.id)).not.toBeNull();
    expect(await service.expenses.count()).toBe(1);
  });

  it('blocks deleting a category referenced only by budgets (no silent cascade)', async () => {
    const category = await createCategory('Budgeted');
    await service.budgets.create({
      categoryId: category.id,
      amount: 50_000,
      month: 9,
      year: 2026,
    });

    await expect(feature.deleteCategory(category.id)).resolves.toEqual({
      deleted: false,
      blocker: 'budgets',
    });
    expect(await service.categories.getById(category.id)).not.toBeNull();
    expect(await service.budgets.countByCategory(category.id)).toBe(1);
  });

  it('reports usage counts for the UI explanation', async () => {
    const category = await createCategory('Reported');
    expect(await feature.getUsage(category.id)).toEqual({
      expenseCount: 0,
      budgetCount: 0,
    });

    await service.expenses.create({
      amount: 10_000,
      title: 'One',
      categoryId: category.id,
      date: Date.now(),
      paymentMethod: 'card',
    });
    await service.budgets.create({
      categoryId: category.id,
      amount: 20_000,
      month: 10,
      year: 2026,
    });

    expect(await feature.getUsage(category.id)).toEqual({
      expenseCount: 1,
      budgetCount: 1,
    });
  });
});
