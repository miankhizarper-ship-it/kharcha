/**
 * @jest-environment node
 */
import {DatabaseService} from '../service';
import {createTestService} from '../testing/helpers';

describe('CategoryRepository', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('creates user categories with isDefault=false by default', async () => {
    const created = await service.categories.create({
      name: 'Fuel',
      icon: 'gas-pump',
      type: 'expense',
    });
    expect(created).toEqual({
      id: created.id,
      name: 'Fuel',
      icon: 'gas-pump',
      type: 'expense',
      isDefault: false,
      isActive: true,
      createdAt: expect.any(Number),
    });
    expect(await service.categories.getById(created.id)).toEqual(created);
  });

  it('lists active-only categories when requested', async () => {
    const kept = await service.categories.create({
      name: 'Kept',
      icon: 'tag',
      type: 'expense',
    });
    const archived = await service.categories.create({
      name: 'Archived',
      icon: 'tag',
      type: 'expense',
    });
    await service.categories.update(archived.id, {isActive: false});

    const active = await service.categories.list('expense', {activeOnly: true});
    const activeIds = active.map(category => category.id);
    expect(activeIds).toContain(kept.id);
    expect(activeIds).not.toContain(archived.id);

    // Default list keeps archived rows (management view).
    const all = await service.categories.list('expense');
    expect(all.map(category => category.id)).toEqual(
      expect.arrayContaining([kept.id, archived.id]),
    );
    const allNames = all.map(category => category.name);
    expect(allNames.indexOf('Archived')).toBeLessThan(allNames.indexOf('Kept'));

    // Seeded categories are active after migration 003 (income untouched here).
    expect(await service.categories.countActiveByType('income')).toBe(
      await service.categories.countByType('income'),
    );
    expect(await service.categories.countActiveByType('expense')).toBe(
      (await service.categories.countByType('expense')) - 1,
    );
  });

  it('updates isActive to archive and restore', async () => {
    const created = await service.categories.create({
      name: 'Toggleable',
      icon: 'tag',
      type: 'income',
    });
    const archived = await service.categories.update(created.id, {
      isActive: false,
    });
    expect(archived.isActive).toBe(false);
    expect((await service.categories.getById(created.id))?.isActive).toBe(
      false,
    );

    const restored = await service.categories.update(created.id, {
      isActive: true,
    });
    expect(restored.isActive).toBe(true);
  });

  it('lists by type ordered by name (case-insensitive)', async () => {
    await service.categories.create({
      name: 'banana',
      icon: 'tag',
      type: 'expense',
    });
    await service.categories.create({
      name: 'Apple',
      icon: 'tag',
      type: 'expense',
    });
    await service.categories.create({
      name: 'Cherry',
      icon: 'tag',
      type: 'income',
    });

    const expenses = await service.categories.list('expense');
    // Seeded expense categories are also present; user ones sort among them.
    const userNames = expenses
      .filter(c => ['banana', 'Apple'].includes(c.name))
      .map(c => c.name);
    expect(userNames).toEqual(['Apple', 'banana']);

    const incomeNames = (await service.categories.list('income')).map(
      c => c.name,
    );
    expect(incomeNames).toContain('Cherry');
  });

  it('finds by exact name and type', async () => {
    const created = await service.categories.create({
      name: 'Zakat',
      icon: 'hand-left',
      type: 'expense',
    });
    expect((await service.categories.findByName('Zakat', 'expense'))?.id).toBe(
      created.id,
    );
    // Wrong type or wrong case → no match (names are case-sensitive).
    expect(await service.categories.findByName('Zakat', 'income')).toBeNull();
    expect(await service.categories.findByName('zakat', 'expense')).toBeNull();
    expect(await service.categories.isNameTaken('Zakat', 'expense')).toBe(true);
  });

  it('updates name, icon and isDefault (never type)', async () => {
    const created = await service.categories.create({
      name: 'Old',
      icon: 'tag',
      type: 'expense',
    });
    const updated = await service.categories.update(created.id, {
      name: 'New',
      icon: 'star',
      isDefault: true,
    });
    expect(updated).toMatchObject({name: 'New', icon: 'star', isDefault: true});
    expect(updated.type).toBe('expense');
  });

  it('deletes user categories that are not referenced', async () => {
    const created = await service.categories.create({
      name: 'Disposable',
      icon: 'tag',
      type: 'expense',
    });
    await expect(service.categories.delete(created.id)).resolves.toBe(true);
    expect(await service.categories.getById(created.id)).toBeNull();
    await expect(service.categories.delete(created.id)).resolves.toBe(false);
  });

  it('rejects invalid drafts', async () => {
    await expect(
      service.categories.create({name: '', icon: 'tag', type: 'expense'}),
    ).rejects.toThrow(/name/);
    await expect(
      service.categories.create({name: 'X', icon: '', type: 'expense'}),
    ).rejects.toThrow(/icon/);
    await expect(
      service.categories.create({
        name: 'X',
        icon: 'tag',
        // Runtime literal on purpose: bypasses the compile-time union.
        type: 'savings' as never,
      }),
    ).rejects.toThrow(/type/);
  });
});
