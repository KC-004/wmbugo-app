---
title: 'Story 9.1: Read any bank CSV file in core'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

## Intent

**Problem:** Sara's bank gives her a CSV in whatever encoding, delimiter, number style and date style it likes, with preamble lines above the real heading, and she should not have to clean it up in a spreadsheet first.

**Approach:** A pure core reader (`packages/core/src/capture/csv`): detect the encoding (BOM, UTF-16 without one, UTF-8, Windows-1252 or ISO-8859-1), the delimiter and the heading row, with a confidence for each and an override that always wins; an exact amount parser and a number-style detector; a date parser and format detector. The tokenizer sits behind a `CsvTokenizer` port, so the phone can put Papa Parse behind it later; a pure RFC 4180 tokenizer is the reference.

## Boundaries & Constraints

**Always:** exact minor units with no floating-point step; text that is not a number is `INVALID_AMOUNT`, never 0; a date alone is the `local_date` as written with no UTC shift; an ambiguous day/month order is reported with both candidates, never guessed; nothing is thrown; no React Native import in core.

**Never:** round a digit away (`3.505` at two decimals is an error); read a binary file as text; import preamble rows.

## Tasks & Acceptance

- [x] `capture/csv/decode.ts` -- BOM, UTF-16 without BOM, strict UTF-8, Windows-1252 and ISO-8859-1 decoding
- [x] `capture/csv/tokenize.ts` -- the `CsvTokenizer` port and a pure reference tokenizer
- [x] `capture/csv/amount.ts` -- `parseCsvAmount`, `detectNumberStyle`
- [x] `capture/csv/date.ts` -- `parseCsvDate`, `detectDateFormat` with `AMBIGUOUS_DATE_FORMAT`
- [x] `capture/csv/read.ts` -- `readCsv` with overrides, preamble, heading row, the 25-row sample and every row with its file row number
- [x] `capture/csv/csv.test.ts` -- 41 tests: a fixture per encoding, quoting, preamble, each override, every error, the spec amount examples, a round-trip property over every style, date formats, the London DST day, the German fixture, and a never-throws property

## Implementation Notes

- **Spec conflict, resolved:** the story says invalid UTF-8 falls back to Windows-1252 and that ISO-8859-1 is chosen only when no byte 0x80 to 0x9F appears, and also that the PRD German file (`ü`, `ä`) reads as Windows-1252. Both cannot hold for a file with no 0x80 to 0x9F byte. The reader follows the rule (ISO-8859-1 only without such a byte), and the German fixture carries an en dash (0x96, `Miete – November`), which is what a real Windows-1252 export has and what marks it.
- A heading row override is the 0-based index among the file's rows. File row numbers are 1-based record numbers (a quoted line break does not add one; blank lines do), which is what 9.2 reports as the row number.
- `readCsv` returns every data row, not only the sample, because 9.2 to 9.4 work on all of them. A 20 MB file of short rows is a few hundred thousand small arrays; fine for the phone, but the memory is worth measuring on the device.
- Papa Parse is not added: the pure tokenizer meets every acceptance criterion. If the phone needs its speed it plugs in through `CsvReadOptions.tokenizer`.
- The existing Story 7.3 writer writes LF and no BOM; Story 9.9 asks for UTF-8 with BOM and CRLF, so 9.9 adds those options.
- Source files hold no invisible characters: the no-break space and the Unicode minus are built from code points.

## Verification

core jest passes (new: 41 tests); `tsc` and ESLint are clean for the new code.
