import type {DatabaseDriver, SqlParam} from '../driver';
import {DatabaseError, NotFoundError} from '../errors';
import type {
  Category,
  CategoryDraft,
  CategoryPatch,
  CategoryType,
} from '../models';
import {CATEGORY_TYPES} from '../models';
import {requireEnum, requirePositiveInt, requireText} from './validate';

const NAME_MAX = 100;
const ICON_MAX = 50;

/** Raw row shape coming back from SQLite (`is_default`/`is_active` are 0/1, `type` a string). */
interface CategoryRow {
  id: number;
  name: string;
  icon: string;
  type: string;
  isDefault: number;
  isActive: number;
  createdAt: number;
}

const CATEGORY_COLUMNS = `
  id,
  name,
  icon,
  type,
  is_default AS isDefault,
  is_active AS isActive,
  created_at AS createdAt
`;

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    type: row.type as CategoryType,
    isDefault: row.isDefault === 1,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
  };
}

/**
 * CRUD + query access to the `categories` table.
 *
 * Uniqueness: `(name, type)` is unique (case-sensitive). Creating a duplicate
 * rejects with a `DatabaseError` wrapping the SQLite UNIQUE violation —
 * pre-check with `findByName` / `isNameTaken` when you want a friendlier
 * message.
 *
 * Deletes: SQLite raises a FK violation (RESTRICT) when expenses still
 * reference the category; budgets referencing it are removed automatically
 * (CASCADE). Both behaviors are covered by tests.
 */
export class CategoryRepository {
  constructor(private readonly db: DatabaseDriver) {}

  async create(draft: CategoryDraft): Promise<Category> {
    const name = requireText(draft.name, 'name', NAME_MAX);
    const icon = requireText(draft.icon, 'icon', ICON_MAX);
    const type = requireEnum(draft.type, CATEGORY_TYPES, 'type');
    const isDefault = draft.isDefault ?? false;

    const now = Date.now();
    const rows = await this.db.query<{id: number}>(
      `INSERT INTO categories (name, icon, type, is_default, created_at)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
      [name, icon, type, isDefault ? 1 : 0, now],
    );
    const id = rows[0]?.id;
    if (typeof id !== 'number') {
      throw new DatabaseError('Inserting a category did not return an id');
    }
    return this.requireById(id, 'after insert');
  }

  async getById(id: number): Promise<Category | null> {
    requirePositiveInt(id, 'id');
    const rows = await this.db.query<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = ?`,
      [id],
    );
    return rows[0] ? toCategory(rows[0]) : null;
  }

  /**
   * Lists categories, optionally filtered by type and/or active state,
   * ordered by name (A-Z, case-insensitive).
   *
   * Default (`activeOnly: false`) returns EVERY category including archived
   * ones — that is what management screens and historical joins need. Pass
   * `activeOnly: true` for new-transaction pickers.
   */
  async list(
    type?: CategoryType,
    options: {activeOnly?: boolean} = {},
  ): Promise<Category[]> {
    let sql = `SELECT ${CATEGORY_COLUMNS} FROM categories`;
    const params: SqlParam[] = [];
    const conditions: string[] = [];
    if (type !== undefined) {
      requireEnum(type, CATEGORY_TYPES, 'type');
      conditions.push('type = ?');
      params.push(type);
    }
    if (options.activeOnly) {
      conditions.push('is_active = 1');
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY name COLLATE NOCASE ASC';
    const rows = await this.db.query<CategoryRow>(sql, params);
    return rows.map(toCategory);
  }

  async findByName(name: string, type: CategoryType): Promise<Category | null> {
    requireText(name, 'name', NAME_MAX);
    requireEnum(type, CATEGORY_TYPES, 'type');
    const rows = await this.db.query<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE name = ? AND type = ?`,
      [name.trim(), type],
    );
    return rows[0] ? toCategory(rows[0]) : null;
  }

  async isNameTaken(name: string, type: CategoryType): Promise<boolean> {
    return (await this.findByName(name, type)) !== null;
  }

  async countByType(type: CategoryType): Promise<number> {
    requireEnum(type, CATEGORY_TYPES, 'type');
    const rows = await this.db.query<{count: number}>(
      'SELECT COUNT(*) AS count FROM categories WHERE type = ?',
      [type],
    );
    return rows[0]?.count ?? 0;
  }

  /** Counts ACTIVE categories of one type (new-transaction picker depth). */
  async countActiveByType(type: CategoryType): Promise<number> {
    requireEnum(type, CATEGORY_TYPES, 'type');
    const rows = await this.db.query<{count: number}>(
      'SELECT COUNT(*) AS count FROM categories WHERE type = ? AND is_active = 1',
      [type],
    );
    return rows[0]?.count ?? 0;
  }

  async update(id: number, patch: CategoryPatch): Promise<Category> {
    requirePositiveInt(id, 'id');
    const sets: string[] = [];
    const params: SqlParam[] = [];

    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(requireText(patch.name, 'name', NAME_MAX));
    }
    if (patch.icon !== undefined) {
      sets.push('icon = ?');
      params.push(requireText(patch.icon, 'icon', ICON_MAX));
    }
    if (patch.isDefault !== undefined) {
      sets.push('is_default = ?');
      params.push(patch.isDefault ? 1 : 0);
    }
    if (patch.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(patch.isActive ? 1 : 0);
    }

    if (sets.length === 0) {
      const current = await this.getById(id);
      if (!current) {
        throw new NotFoundError('Category', id);
      }
      return current;
    }

    const {rowsAffected} = await this.db.run(
      `UPDATE categories SET ${sets.join(', ')} WHERE id = ?`,
      [...params, id],
    );
    if (rowsAffected === 0) {
      throw new NotFoundError('Category', id);
    }
    return this.requireById(id, 'after update');
  }

  /**
   * @returns true when a row was deleted. Rejects with `DatabaseError` when
   * expenses still reference the category (ON DELETE RESTRICT). Note that
   * category budgets (ON DELETE CASCADE) are removed silently by SQLite —
   * callers that must not lose budgets pre-check with the categories
   * feature's usage counters before deleting.
   */
  async delete(id: number): Promise<boolean> {
    requirePositiveInt(id, 'id');
    const {rowsAffected} = await this.db.run(
      'DELETE FROM categories WHERE id = ?',
      [id],
    );
    return rowsAffected > 0;
  }

  private async requireById(id: number, when: string): Promise<Category> {
    const category = await this.getById(id);
    if (!category) {
      throw new DatabaseError(`Category ${id} could not be read back ${when}`);
    }
    return category;
  }
}
