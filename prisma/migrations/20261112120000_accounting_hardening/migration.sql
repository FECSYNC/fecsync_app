-- Accounting hardening: block mutation of posted/reversed journal lines and
-- deletion of posted/reversed entries/lines. reconciledInId may still change.

CREATE OR REPLACE FUNCTION accounting_block_posted_journal_line_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entry_status text;
BEGIN
  SELECT status::text INTO entry_status
  FROM journal_entries
  WHERE id = OLD."entryId";

  IF entry_status IN ('posted', 'reversed') THEN
    IF NEW.debit IS DISTINCT FROM OLD.debit
       OR NEW.credit IS DISTINCT FROM OLD.credit
       OR NEW."ledgerAccountId" IS DISTINCT FROM OLD."ledgerAccountId"
       OR NEW."entryId" IS DISTINCT FROM OLD."entryId"
       OR NEW."entryDate" IS DISTINCT FROM OLD."entryDate" THEN
      RAISE EXCEPTION 'ACCT_POSTED_IMMUTABLE: cannot update debit/credit/ledgerAccountId/entryId/entryDate on posted or reversed journal lines'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_block_posted_journal_line_update ON journal_lines;
CREATE TRIGGER trg_accounting_block_posted_journal_line_update
  BEFORE UPDATE ON journal_lines
  FOR EACH ROW
  EXECUTE PROCEDURE accounting_block_posted_journal_line_update();

CREATE OR REPLACE FUNCTION accounting_block_posted_journal_line_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entry_status text;
BEGIN
  SELECT status::text INTO entry_status
  FROM journal_entries
  WHERE id = OLD."entryId";

  IF entry_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'ACCT_POSTED_IMMUTABLE: cannot delete journal lines on posted or reversed entries'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_block_posted_journal_line_delete ON journal_lines;
CREATE TRIGGER trg_accounting_block_posted_journal_line_delete
  BEFORE DELETE ON journal_lines
  FOR EACH ROW
  EXECUTE PROCEDURE accounting_block_posted_journal_line_delete();

CREATE OR REPLACE FUNCTION accounting_block_posted_journal_entry_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status::text IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'ACCT_POSTED_IMMUTABLE: cannot delete posted or reversed journal entries'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_block_posted_journal_entry_delete ON journal_entries;
CREATE TRIGGER trg_accounting_block_posted_journal_entry_delete
  BEFORE DELETE ON journal_entries
  FOR EACH ROW
  EXECUTE PROCEDURE accounting_block_posted_journal_entry_delete();
