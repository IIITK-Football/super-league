-- The synthetic seed's live match shows a goal whose scorer is not known yet and a yellow card. Only a goal may lose its
-- scorer: a card always names its player (match_events_player_needed), so re-running the seed on a database where the
-- card sorts first must still leave the card attributed (the staging deploy failed on exactly that).
begin;
select plan(3);

select is(
  (select count(*)::int from public.match_events e join public.matches m on m.id = e.match_id
    where m.status = 'live' and e.source = 'seed' and e.kind in ('yellow', 'red') and e.player_id is null),
  0, 'the seeded live-match cards keep their player');

select ok(
  (select count(*) from public.match_events e join public.matches m on m.id = e.match_id
    where m.status = 'live' and e.source = 'seed' and e.kind = 'goal' and e.player_id is null) >= 1,
  'the seeded live match still has a goal with an unknown scorer');

-- The statement the seed uses, applied with a card that sorts first: it must pick the goal, never the card.
insert into public.match_events (id, match_id, team_id, kind, player_id, minute, source)
select '00000000-0000-4000-8000-000000000000'::uuid, e.match_id, e.team_id, 'yellow', e.player_id, 5, 'seed'
from public.match_events e join public.matches m on m.id = e.match_id
where m.status = 'live' and e.source = 'seed' and e.kind = 'yellow' limit 1;
select lives_ok($$
  update public.match_events set player_id = null, assist_player_id = null
  where id = (select e.id from public.match_events e join public.matches m on m.id = e.match_id
              where m.status = 'live' and e.source = 'seed' and e.kind = 'goal' order by e.id limit 1)
$$, 'clearing the first seeded goal never touches a card, even one that sorts first');

select * from finish();
rollback;
