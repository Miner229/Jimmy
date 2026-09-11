import { uuid, one, audit } from "./db.js";
export async function reviewRisks(db) {
  const clubs = (
    await db.query(`select c.id,c.created_at,count(t.id)::int as count,coalesce(sum(t.gross_amount),0)::bigint as gmv,
 count(t.id) filter(where t.refund_status='succeeded')::int as refunds,
 count(t.id) filter(where t.dispute_status not in ('none','won'))::int as disputes
 from clubs c left join booking_transactions t on t.club_id=c.id and t.payment_status='succeeded' and t.created_at>now()-interval '30 days' group by c.id`)
  ).rows;
  for (const c of clubs) {
    const signals = [];
    if (c.count >= 10 && c.refunds / c.count > 0.25)
      signals.push("high_refund_rate");
    if (c.count >= 10 && c.disputes / c.count > 0.02)
      signals.push("high_dispute_rate");
    if (
      Date.now() - new Date(c.created_at) < 7 * 86400000 &&
      Number(c.gmv) > Number(process.env.NEW_CLUB_REVIEW_GMV_PENCE || 500000)
    )
      signals.push("rapid_new_club_gmv");
    const changes = await one(
      db,
      "select count(*)::int as n from payout_changes where club_id=$1 and created_at>now()-interval '30 days'",
      [c.id],
    );
    if (changes.n >= 3) signals.push("repeated_payout_changes");
    for (const signal of signals) {
      if (
        !(await one(
          db,
          "select id from risk_flags where club_id=$1 and signal=$2 and status='review'",
          [c.id, signal],
        ))
      ) {
        await db.query(
          "insert into risk_flags(id,club_id,signal) values($1,$2,$3)",
          [uuid(), c.id, signal],
        );
        await audit(db, null, c.id, "risk.review_requested", c.id, { signal });
      }
    }
  }
  return { clubs_reviewed: clubs.length };
}
