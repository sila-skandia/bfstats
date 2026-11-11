// Takes down the Shorts and rolls nobody watched (features/replay-shorts,
// "Rolls and retention"): every one 7 days old or more with 0 or 1 views,
// except a player's own studio share. The API keeps each as a tombstone, so
// its kill is never filmed again. Run by the nightly Shorts job
// (scripts/shorts-nightly.sh) after its uploads; never on its own timer.
//
//   SHORTS_UPLOAD_KEY=... node scripts/shorts-prune.mjs [--dry-run] [--to=https://bfstats.io]
//
// --dry-run lists what would go and changes nothing.
const args = process.argv.slice(2);
const opt = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const TO = opt('to', 'https://bfstats.io');
const DRY = args.includes('--dry-run');
const KEY = process.env.SHORTS_UPLOAD_KEY ?? '';
if (!KEY) {
  console.error('shorts-prune needs SHORTS_UPLOAD_KEY');
  process.exit(1);
}
const res = await fetch(`${TO}/stats/shorts/prune?dryRun=${DRY}`, { method: 'POST', headers: { 'X-Shorts-Key': KEY } });
const body = await res.text();
if (!res.ok) {
  console.error(`prune ${res.status}: ${body.slice(0, 300)}`);
  process.exit(1);
}
const out = JSON.parse(body);
const verb = out.dryRun ? 'would take down' : 'took down';
console.log(`${verb} ${out.pruned.length} unwatched Shorts and rolls${out.dryRun ? '' : `, swept ${out.partsSwept} stale upload parts`}`);
for (const s of out.pruned) console.log(`  ${s.slug} ${s.kind} ${Number(s.ageDays).toFixed(1)} days, ${s.views} views`);
