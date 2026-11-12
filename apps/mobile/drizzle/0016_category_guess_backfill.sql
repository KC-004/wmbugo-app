-- Story 4.4: entries that were already in the ledger before category_guessed and category_set_by existed.
-- An auto-approved entry with a category was the old "guessed" state; every other categorised entry is the user's.
UPDATE `transaction` SET `category_guessed` = 1, `category_set_by` = 'suggester' WHERE `capture_resolution` = 'auto_approved' AND `needs_category` = 0 AND `category_set_by` IS NULL;--> statement-breakpoint
UPDATE `transaction` SET `category_set_by` = 'user' WHERE `category_set_by` IS NULL AND `needs_category` = 0;
