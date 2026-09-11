import type {DatabaseDriver} from '@/database/driver';
import type {RecurringFrequency} from '@/database/models';
import type {DatabaseService} from '@/database/service';
import {withTransaction} from '@/database/transaction';
import {isSameOrBeforeDay, isWithinEnd, nextOccurrence} from './date';
import type {RecurringProcessingResult} from './types';

/**
 * The recurring-transaction GENERATION ENGINE (spec §12).
 *
 * `processDueRecurringTransactions(db, now)`:
 *
 * 1. finds ACTIVE rules whose next occurrence is today or earlier
 *    (indexed query — never scans or loads the whole ledger, spec §29);
 * 2. generates the missing NORMAL transactions (expense/income rows in the
 *    regular tables, tagged with `recurring_rule_id`);
 * 3. advances `next_occurrence_at`;
 * 4. repeats for every missed occurrence (spec §13: generate ALL missed
 *    occurrences up to today, never silently skip history);
 * 5. stops at the end date and deactivates the completed rule (spec §19);
 * 6. prevents duplicates at the DATABASE level (partial UNIQUE indexes on
 *    `(recurring_rule_id, date)`) and by reading rules INSIDE the write
 *    transaction — SQLite is the final authority, never an in-memory flag
 *    (spec §14/§17);
 * 7. performs everything inside ONE SQLite transaction: if any insert or
 *    update fails, the whole run rolls back — no orphan transactions, no
 *    advanced occurrences (spec §15).
 *
 * IDEMPOTENCY: safe to call any number of times. Concurrent callers
 * serialize on BEGIN IMMEDIATE; the second caller re-reads `next_occurrence_at`
 * after the first commits and finds nothing left to do.
 *
 * SAFETY (spec §25/§30): rules whose category is missing or archived are
 * skipped WITHOUT generating or advancing (their occurrences remain due);
 * the list screen reports them as "Needs attention". Deleting a rule never
 * touches generated history (ON DELETE SET NULL). Future occurrences are
 * never generated. Nothing about the financial contents is logged.
 */

/**
 * Defensive per-rule cap for one run. Ordinary use never comes close
 * (a daily rule unused for 10 years = ~3,650). If a pathologically stale
 * `next_occurrence_at` appears, this bounds a single transaction; the
 * remainder continues on the next run without skipping anything.
 */
const MAX_OCCURRENCES_PER_RULE_PER_RUN = 5_000;

/** Raw row shape read directly inside the processing transaction. */
interface DueRuleRow {
  id: number;
  type: string;
  amount: number;
  title: string;
  category_id: number | null;
  frequency: string;
  next_occurrence_at: number;
  end_date: number | null;
  payment_method: string | null;
  note: string | null;
}

/**
 * Generates every due occurrence of every active rule, atomically.
 * Returns what the run did so callers can surface a summary.
 */
export async function processDueRecurringTransactions(
  db: DatabaseService,
  now: number = Date.now(),
): Promise<RecurringProcessingResult> {
  const result: RecurringProcessingResult = {
    generatedExpenses: 0,
    generatedIncome: 0,
    completedRules: 0,
    blockedRuleIds: [],
  };

  await withTransaction(db.driver, () =>
    processInsideTransaction(db.driver, now, result),
  );

  return result;
}

async function processInsideTransaction(
  driver: DatabaseDriver,
  now: number,
  result: RecurringProcessingResult,
): Promise<void> {
  // BEGIN IMMEDIATE (acquired by withTransaction) serializes writers, so
  // reading the due rules HERE — inside the transaction — guarantees no
  // other caller can generate the same occurrences between read and write.
  const dueRules = await driver.query<DueRuleRow>(
    `SELECT id, type, amount, title, category_id, frequency,
            next_occurrence_at, end_date, payment_method, note
     FROM recurring_transactions
     WHERE is_active = 1 AND next_occurrence_at <= ?
     ORDER BY next_occurrence_at ASC, id ASC`,
    [now],
  );

  for (const rule of dueRules) {
    const frequency = rule.frequency as RecurringFrequency;

    // Category gate (expense rules only): a missing or archived category
    // must not produce invalid transactions. The rule stays active and its
    // occurrences stay due — when the category is restored, the backlog
    // generates under the normal missed-occurrence policy. The list screen
    // reports the blocked state ("Needs attention") so it is never silent.
    if (rule.type === 'expense') {
      const category = await driver.query<{is_active: number}>(
        'SELECT is_active FROM categories WHERE id = ?',
        [rule.category_id],
      );
      const active = category[0];
      if (!active || active.is_active !== 1) {
        result.blockedRuleIds.push(rule.id);
        continue;
      }
    }

    let next = rule.next_occurrence_at;
    let generated = 0;
    let completed = false;

    while (isSameOrBeforeDay(next, now)) {
      if (!isWithinEnd(next, rule.end_date)) {
        // The end date has passed with nothing left to generate: the rule
        // is complete — deactivate it and stop (spec §19). Its next
        // occurrence is left as-is for auditability.
        await driver.run(
          'UPDATE recurring_transactions SET is_active = 0, updated_at = ? WHERE id = ?',
          [Date.now(), rule.id],
        );
        result.completedRules += 1;
        completed = true;
        break;
      }

      if (rule.type === 'expense') {
        await driver.run(
          `INSERT INTO expenses
             (amount, title, category_id, date, payment_method, note,
              created_at, updated_at, recurring_rule_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rule.amount,
            rule.title,
            rule.category_id,
            next,
            rule.payment_method,
            rule.note,
            Date.now(),
            Date.now(),
            rule.id,
          ],
        );
        result.generatedExpenses += 1;
      } else {
        await driver.run(
          `INSERT INTO income
             (amount, source, date, note, created_at, updated_at, recurring_rule_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            rule.amount,
            rule.title,
            next,
            rule.note,
            Date.now(),
            Date.now(),
            rule.id,
          ],
        );
        result.generatedIncome += 1;
      }

      generated += 1;
      next = nextOccurrence(next, frequency);

      if (generated >= MAX_OCCURRENCES_PER_RULE_PER_RUN) {
        // Continue seamlessly on the next run — nothing is skipped; the
        // advanced (still due) next occurrence stays the work frontier.
        break;
      }
    }

    if (!completed && next !== rule.next_occurrence_at) {
      await driver.run(
        'UPDATE recurring_transactions SET next_occurrence_at = ?, updated_at = ? WHERE id = ?',
        [next, Date.now(), rule.id],
      );
    }

    // The catch-up advanced past a finite end date: the rule just finished —
    // deactivate it in the SAME run instead of waiting for its next
    // occurrence to come due (spec §19).
    if (
      !completed &&
      rule.end_date !== null &&
      !isWithinEnd(next, rule.end_date)
    ) {
      await driver.run(
        'UPDATE recurring_transactions SET is_active = 0, updated_at = ? WHERE id = ?',
        [Date.now(), rule.id],
      );
      result.completedRules += 1;
    }
  }
}
