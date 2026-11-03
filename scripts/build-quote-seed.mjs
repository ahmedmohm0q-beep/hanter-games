// Generates supabase/seed.sql from quotes/library.json (run: node scripts/build-quote-seed.mjs)
import { readFileSync, writeFileSync } from 'node:fs';

const lib = JSON.parse(readFileSync(new URL('../quotes/library.json', import.meta.url), 'utf8'));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const rows = lib.quotes.map((x) =>
  `(${[x.id, x.lang, x.text, x.translation, x.translationBy, x.author, x.authorAlt, x.work, x.year, x.sourceUrl, x.sourceNote, x.verifiedOn].map(q).join(', ')})`,
);
const sql = `-- Generated from quotes/library.json — do not edit by hand.
insert into public.quotes (id, lang, text, translation, translation_by, author, author_alt, work, year, source_url, source_note, verified_on) values
${rows.join(',\n')}
on conflict (id) do update set text = excluded.text, translation = excluded.translation, translation_by = excluded.translation_by,
  author = excluded.author, author_alt = excluded.author_alt, work = excluded.work, year = excluded.year,
  source_url = excluded.source_url, source_note = excluded.source_note, verified_on = excluded.verified_on;
`;
writeFileSync(new URL('../supabase/seed.sql', import.meta.url), sql);
console.log(`seed.sql: ${rows.length} quotes`);
