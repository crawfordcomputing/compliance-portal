'use strict';

const cron   = require('node-cron');
const { query } = require('../db');
const logger = require('./logger');

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Last day of month (1-indexed). Day 0 of the next month = last day of this one. */
function lastDayOf(year, month) {
  return new Date(year, month, 0);
}

/** Format a Date as YYYY-MM-DD. */
function fmt(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Add `n` months to a {year, month} pair (1-indexed).
 * Handles year rollovers in both directions.
 */
function addMonths(year, month, n) {
  const total = (month - 1) + n;
  return {
    year:  year + Math.floor(total / 12),
    month: (total % 12) + 1,
  };
}

/** First and last day of a given {year, month} as YYYY-MM-DD strings. */
function monthWindow(ym) {
  const end = lastDayOf(ym.year, ym.month);
  return {
    start: `${ym.year}-${String(ym.month).padStart(2, '0')}-01`,
    end:   fmt(end),
    due:   fmt(end), // due = last day of review month
  };
}

// ── Period generation ─────────────────────────────────────────────────────────

/**
 * Calculate period label, start, end, and due date for a check
 * based on its cadence, the target year, and the org's schedule settings.
 *
 * Each review window is exactly 1 calendar month — the month configured
 * for that cadence. The "This Period" view activates during that month.
 *
 * Settings (all 1–12, fall back to defaults if absent):
 *   compliance_quarterly_start_month   – month Q1 opens  (default 3 = March)
 *   compliance_semi_annual_start_month – month H1 opens  (default 6 = June)
 *   compliance_annual_due_month        – month annual due (default 12 = December)
 *
 * Example — quarterly=3, semi_annual=6, annual=6:
 *   Q1-2026: Mar 1–31  due Mar 31
 *   Q2-2026: Jun 1–30  due Jun 30
 *   Q3-2026: Sep 1–30  due Sep 30
 *   Q4-2026: Dec 1–31  due Dec 31
 *   H1-2026: Jun 1–30  due Jun 30
 *   H2-2026: Dec 1–31  due Dec 31
 *   2026:    Jun 1–30  due Jun 30
 */
function getPeriodsForYear(cadence, year, org = {}) {
  const qsm  = org.compliance_quarterly_start_month   || 3;
  const sasm = org.compliance_semi_annual_start_month || 6;
  const adm  = org.compliance_annual_due_month        || 12;

  const periods = [];

  if (cadence === 'quarterly') {
    for (let q = 0; q < 4; q++) {
      const reviewMonth = addMonths(year, qsm, q * 3);
      if (reviewMonth.year !== year) continue; // only generate periods that start in `year`
      const win = monthWindow(reviewMonth);
      periods.push({ label: `Q${q + 1}-${year}`, ...win });
    }

  } else if (cadence === 'semi_annual') {
    for (let h = 0; h < 2; h++) {
      const reviewMonth = addMonths(year, sasm, h * 6);
      if (reviewMonth.year !== year) continue;
      const win = monthWindow(reviewMonth);
      periods.push({ label: `H${h + 1}-${year}`, ...win });
    }

  } else if (cadence === 'annual') {
    const reviewMonth = { year, month: adm };
    const win = monthWindow(reviewMonth);
    periods.push({ label: `${year}`, ...win });
  }
  // event_triggered: no auto-generated instances

  return periods;
}

async function generateInstances() {
  logger.info('Compliance scheduler: generating instances');

  try {
    // Load org settings to know which conditional checks apply
    const { rows: orgRows } = await query('SELECT * FROM org_settings LIMIT 1');
    const org = orgRows[0] || {};

    // Load all active non-event-triggered definitions
    const { rows: defs } = await query(
      `SELECT id, cadence, conditional_on FROM compliance_check_definitions
       WHERE active = TRUE AND cadence != 'event_triggered'`
    );

    const now  = new Date();
    const thisYear = now.getFullYear();
    const years = [thisYear, thisYear + 1]; // generate current + next year

    for (const def of defs) {
      // Skip if conditional and condition not met
      if (def.conditional_on && !org[def.conditional_on]) continue;

      for (const year of years) {
        const periods = getPeriodsForYear(def.cadence, year, org);
        for (const p of periods) {
          // Only create if period has started or is within 90 days of starting
          const startDate = new Date(p.start);
          const daysUntilStart = (startDate - now) / (1000 * 60 * 60 * 24);
          if (daysUntilStart > 90) continue;

          await query(
            `INSERT INTO compliance_check_instances
               (definition_id, period_label, period_start, period_end, due_date)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (definition_id, period_label) DO NOTHING`,
            [def.id, p.label, p.start, p.end, p.due]
          );
        }
      }
    }

    // Mark overdue instances
    await query(
      `UPDATE compliance_check_instances
       SET status = 'overdue'
       WHERE status = 'pending' AND due_date < CURRENT_DATE`
    );

    logger.info('Compliance scheduler: instance generation complete');
  } catch (err) {
    logger.error({ err }, 'Compliance scheduler error');
  }
}

function startComplianceScheduler() {
  logger.info('Compliance scheduler: starting (daily at midnight)');
  // Run at midnight every day
  cron.schedule('0 0 * * *', generateInstances);
  // Run immediately on startup
  generateInstances();
}

module.exports = { startComplianceScheduler, generateInstances };
