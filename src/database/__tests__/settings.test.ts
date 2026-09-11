/**
 * @jest-environment node
 */
import {DatabaseService} from '../service';
import {createTestService} from '../testing/helpers';

describe('SettingsRepository', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('returns null for unknown keys', async () => {
    expect(await service.settings.get('missing')).toBeNull();
    expect(await service.settings.has('missing')).toBe(false);
  });

  it('stores, overwrites and reads values', async () => {
    await service.settings.set('currency', 'PKR');
    expect(await service.settings.get('currency')).toBe('PKR');

    await service.settings.set('currency', 'USD');
    expect(await service.settings.get('currency')).toBe('USD');
    expect(await service.settings.has('currency')).toBe(true);
  });

  it('allows empty-string values but rejects empty keys', async () => {
    await service.settings.set('flag', '');
    expect(await service.settings.get('flag')).toBe('');

    await expect(service.settings.set('   ', 'x')).rejects.toThrow(/key/);
    await expect(service.settings.set('key', 42 as never)).rejects.toThrow(
      /value/,
    );
  });

  it('returns all settings ordered by key', async () => {
    await service.settings.set('currency', 'PKR');
    await service.settings.set('themeMode', 'dark');
    await service.settings.set('aardvark', 'first');

    expect(await service.settings.getAll()).toEqual([
      {key: 'aardvark', value: 'first'},
      {key: 'currency', value: 'PKR'},
      {key: 'themeMode', value: 'dark'},
    ]);
  });

  it('deletes keys and reports whether something was removed', async () => {
    await service.settings.set('temp', '1');
    await expect(service.settings.delete('temp')).resolves.toBe(true);
    await expect(service.settings.delete('temp')).resolves.toBe(false);
  });

  it('upserts many entries atomically', async () => {
    await service.settings.set('currency', 'PKR');
    await service.settings.setMany([
      {key: 'currency', value: 'AED'},
      {key: 'themeMode', value: 'system'},
    ]);

    expect(await service.settings.get('currency')).toBe('AED');
    expect(await service.settings.get('themeMode')).toBe('system');
    expect(await service.settings.getAll()).toHaveLength(2);
  });
});
