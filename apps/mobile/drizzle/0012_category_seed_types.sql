-- Story 4.1: Family and Other are seeded as `Not classified` (no Need/Want type), as the categories screen shows them.
-- Nothing could edit a category type before this story, so no user choice is overwritten.
UPDATE `category` SET `budget_type` = NULL WHERE `id` IN ('cat_family', 'cat_other');
