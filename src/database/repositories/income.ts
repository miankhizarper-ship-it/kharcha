import type {DatabaseDriver, SqlParam} from '../driver';
import {DatabaseError, NotFoundError} from '../errors';
import type {
  Income,
  IncomeDayTotal,
  IncomeDraft,
  IncomeFilter,
  IncomePatch,
  IncomeSourceAggregate,
} from '../models';
import {escapeLike, normalizeSearchTerm} from './like';
import {
  optionalText,
  requireInt,
  requirePositiveInt,
  requireText,
} from './validate';

const INCOME_COLUMNS = `
  id,
  amount,
  source,
  date,
  note,
  created_at AS createdAt,
  updated_at AS updatedAt,
  recurring_rule_id AS recurringRuleId
`;

const INCOME_ORDER: Record<NonNullable<IncomeFilter['order']>, string> = {
  dateDesc: 'date DESC, id DESC',
  dateAsc: 'date ASC, id ASC',
  // Oldest-row tie-break keeps "largest transaction" deterministic.
  amountDesc: 'amount DESC, id ASC',
  // Phase 11: lowest-first browsing; same oldest-row tie-break.
  amountAsc: 'amount ASC, id ASC',
};

const SOURCE_MAX = 120;
const NOTE_MAX = 2000;

/**
 * CRUD + query access to the `income` table. `source` is free text by design
 * (no FK) — the seeded income categories act as UI presets for it.
 */
export class IncomeRepository {
  constructor(private readonly db: DatabaseDriver) {}

  async create(draft: IncomeDraft): Promise<Income> {
    const amount = requirePositiveInt(draft.amount, 'amount');
    const source = requireText(draft.source, 'source', SOURCE_MAX);
    const date = requirePositiveInt(draft.date, 'date');
    const note = optionalText(draft.note, 'note', NOTE_MAX);

    const now = Date.now();
    const rows = await this.db.query<{id: number}>(
      `INSERT INTO income (amount, source, date, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [amount, source, date, note, now, now],
    );
    const id = rows[0]?.id;
    if (typeof id !== 'number') {
      throw new DatabaseError(
        'Inserting an income record did not return an id',
      );
    }
    return this.requireById(id, 'after insert');
  }

  async getById(id: number): Promise<Income | null> {
    requirePositiveInt(id, 'id');
    const rows = await this.db.query<Income>(
      `SELECT ${INCOME_COLUMNS} FROM income WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async list(filter: IncomeFilter = {}): Promise<Income[]> {
    const {where, params} = buildIncomeWhere(filter);

    let limitClause = '';
    if (filter.limit !== undefined) {
      limitClause = ' LIMIT ?';
      params.push(requirePositiveInt(filter.limit, 'limit'));
      if (filter.offset !== undefined) {
        limitClause += ' OFFSET ?';
        params.push(requireInt(filter.offset, 'offset'));
      }
    } else if (filter.offset !== undefined) {
      limitClause = ' LIMIT -1 OFFSET ?';
      params.push(requireInt(filter.offset, 'offset'));
    }

    const order = filter.order ?? 'dateDesc';
    const sql =
      `SELECT ${INCOME_COLUMNS} FROM income` +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY ${INCOME_ORDER[order]}` +
      limitClause;
    return this.db.query<Income>(sql, params);
  }

  async count(filter: IncomeFilter = {}): Promise<number> {
    const {where, params} = buildIncomeWhere(filter);
    const rows = await this.db.query<{count: number}>(
      `SELECT COUNT(*) AS count FROM income${
        where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
      }`,
      params,
    );
    return rows[0]?.count ?? 0;
  }

  async sumAmount(filter: IncomeFilter = {}): Promise<number> {
    const {where, params} = buildIncomeWhere(filter);
    const rows = await this.db.query<{total: number}>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM income${
        where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
      }`,
      params,
    );
    return rows[0]?.total ?? 0;
  }

  /**
   * Income aggregated per exact source string (Phase 9). One grouped query
   * powers the Reports income breakdown — callers must not loop per-source
   * queries over the result (no N+1). Ordered by total descending, ties by
   * source for determinism.
   */
  async sumBySource(
    filter: IncomeFilter = {},
  ): Promise<IncomeSourceAggregate[]> {
    const {where, params} = buildIncomeWhere(filter);
    const rows = await this.db.query<IncomeSourceAggregate>(
      `SELECT source,
              COALESCE(SUM(amount), 0) AS total,
              COUNT(*) AS transactionCount
       FROM income${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''}
       GROUP BY source
       ORDER BY total DESC, source ASC`,
      params,
    );
    return rows;
  }

  /**
   * Income aggregated per calendar day within the given window (Phase 9).
   * Same `dayIndex` anchoring contract as `ExpenseRepository.sumByDay`:
   * buckets are computed relative to the local-midnight `fromDate` anchor,
   * so they stay exact across DST transitions. Days without income are
   * absent from the result.
   */
  async sumByDay(filter: {
    fromDate: number;
    toDate: number;
  }): Promise<IncomeDayTotal[]> {
    const fromDate = requirePositiveInt(filter.fromDate, 'fromDate');
    const toDate = requirePositiveInt(filter.toDate, 'toDate');
    const rows = await this.db.query<{dayIndex: number; total: number}>(
      `SELECT CAST((date - ?) / 86400000 AS INTEGER) AS dayIndex,
              COALESCE(SUM(amount), 0) AS total
       FROM income
       WHERE date >= ? AND date <= ?
       GROUP BY dayIndex
       ORDER BY dayIndex ASC`,
      [fromDate, fromDate, toDate],
    );
    return rows;
  }

  async update(id: number, patch: IncomePatch): Promise<Income> {
    requirePositiveInt(id, 'id');
    const sets: string[] = [];
    const params: SqlParam[] = [];

    if (patch.amount !== undefined) {
      sets.push('amount = ?');
      params.push(requirePositiveInt(patch.amount, 'amount'));
    }
    if (patch.source !== undefined) {
      sets.push('source = ?');
      params.push(requireText(patch.source, 'source', SOURCE_MAX));
    }
    if (patch.date !== undefined) {
      sets.push('date = ?');
      params.push(requirePositiveInt(patch.date, 'date'));
    }
    if (patch.note !== undefined) {
      sets.push('note = ?');
      params.push(optionalText(patch.note, 'note', NOTE_MAX));
    }

    if (sets.length === 0) {
      const current = await this.getById(id);
      if (!current) {
        throw new NotFoundError('Income', id);
      }
      return current;
    }

    sets.push('updated_at = ?');
    params.push(Date.now(), id);

    const {rowsAffected} = await this.db.run(
      `UPDATE income SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if (rowsAffected === 0) {
      throw new NotFoundError('Income', id);
    }
    return this.requireById(id, 'after update');
  }

  /** @returns true when a row was deleted, false when the id did not exist. */
  async delete(id: number): Promise<boolean> {
    requirePositiveInt(id, 'id');
    const {rowsAffected} = await this.db.run(
      'DELETE FROM income WHERE id = ?',
      [id],
    );
    return rowsAffected > 0;
  }

  private async requireById(id: number, when: string): Promise<Income> {
    const income = await this.getById(id);
    if (!income) {
      throw new DatabaseError(`Income ${id} could not be read back ${when}`);
    }
    return income;
  }
}

function buildIncomeWhere(filter: IncomeFilter): {
  where: string[];
  params: SqlParam[];
} {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.fromDate !== undefined) {
    where.push('date >= ?');
    params.push(requirePositiveInt(filter.fromDate, 'fromDate'));
  }
  if (filter.toDate !== undefined) {
    where.push('date <= ?');
    params.push(requirePositiveInt(filter.toDate, 'toDate'));
  }
  if (filter.minAmount !== undefined) {
    where.push('amount >= ?');
    params.push(requirePositiveInt(filter.minAmount, 'minAmount'));
  }
  if (filter.maxAmount !== undefined) {
    where.push('amount <= ?');
    params.push(requirePositiveInt(filter.maxAmount, 'maxAmount'));
  }
  if (filter.recurring !== undefined) {
    // Phase 11: the provenance column is the ONLY recurrence signal.
    where.push(
      filter.recurring
        ? 'recurring_rule_id IS NOT NULL'
        : 'recurring_rule_id IS NULL',
    );
  }
  if (filter.source !== undefined) {
    // Exact match — the drill-down passes the exact string `sumBySource`
    // grouped by, so case/whitespace stay consistent with the aggregate.
    where.push('source = ?');
    params.push(filter.source);
  }
  if (filter.search !== undefined) {
    // Whitespace-normalized so accidental double spaces still match.
    const term = normalizeSearchTerm(filter.search);
    if (term.length > 0) {
      // LIKE is case-insensitive for ASCII by default in SQLite.
      where.push(`(source LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')`);
      const pattern = `%${escapeLike(term)}%`;
      params.push(pattern, pattern);
    }
  }

  return {where, params};
}
