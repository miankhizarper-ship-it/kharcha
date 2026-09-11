/**
 * @jest-environment node
 */
import {NodeSqliteDriver} from '../drivers/node';
import {DatabaseError} from '../errors';
import {withTransaction} from '../transaction';
import {
  createTestExpense,
  createTestCategory,
  createTestService,
} from '../testing/helpers';
import {DatabaseService} from '../service';

describe('DatabaseService', () => {
  it('opens, migrates and exposes working repositories', async () => {
    const service = await createTestService();
    const expense = await createTestExpense(service);

    expect(await service.integrityCheck()).toBe('ok');
    expect(await service.foreignKeyCheck()).toEqual([]);
    expect((await service.expenses.getById(expense.id))?.id).toBe(expense.id);

    await service.close();
  });

  it('rejects repository work before open() is called', async () => {
    const driver = new NodeSqliteDriver(':memory:');
    await expect(driver.query('SELECT 1')).rejects.toBeInstanceOf(
      DatabaseError,
    );
  });

  it('starts fresh databases independently', async () => {
    const first = await createTestService();
    await first.settings.set('key', 'value');
    await first.close();

    // A brand new service gets a fresh in-memory database.
    const second = await createTestService();
    expect(await second.settings.get('key')).toBeNull();
    await second.close();
  });
});

describe('withTransaction', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('commits every statement when work resolves', async () => {
    const category = await createTestCategory(service);

    await withTransaction(service.driver, async () => {
      await createTestExpense(service, {title: 'One', categoryId: category.id});
      await createTestExpense(service, {title: 'Two', categoryId: category.id});
    });

    expect(await service.expenses.count()).toBe(2);
    expect(await service.integrityCheck()).toBe('ok');
  });

  it('rolls back all writes when work throws', async () => {
    const before = await service.categories.countByType('expense');

    await expect(
      withTransaction(service.driver, async () => {
        await createTestCategory(service);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await service.categories.countByType('expense')).toBe(before);
  });

  it('keeps the connection usable after a rollback', async () => {
    await expect(
      withTransaction(service.driver, async () => {
        throw new Error('first failure');
      }),
    ).rejects.toThrow('first failure');

    // The driver must not be stuck in an open transaction.
    const category = await createTestCategory(service);
    expect(category.id).toBeGreaterThan(0);
    expect(await service.integrityCheck()).toBe('ok');
  });
});
