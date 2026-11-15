CREATE TABLE IF NOT EXISTS public.freshers_fixtures (
  fixture_key TEXT PRIMARY KEY,
  match_date DATE NOT NULL,
  start_time TIME NOT NULL,
  round TEXT NOT NULL,
  fixture TEXT NOT NULL,
  display_order INTEGER NOT NULL UNIQUE
);

ALTER TABLE public.freshers_fixtures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view Freshers fixtures" ON public.freshers_fixtures;
CREATE POLICY "Anyone can view Freshers fixtures"
  ON public.freshers_fixtures FOR SELECT USING (true);

DROP POLICY IF EXISTS "Dictators manage Freshers fixtures" ON public.freshers_fixtures;
CREATE POLICY "Dictators manage Freshers fixtures"
  ON public.freshers_fixtures FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('dictator', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('dictator', 'admin')
  ));

INSERT INTO public.freshers_fixtures (fixture_key, match_date, start_time, round, fixture, display_order)
VALUES
  ('qf-1', '2026-10-12', '16:15', 'QF 1', 'Anna Ball vs PFC (Parotta Football Club)', 1),
  ('qf-2', '2026-10-12', '16:45', 'QF 2', 'KTM BLASTERS vs 23-Balls', 2),
  ('qf-3', '2026-10-12', '17:15', 'QF 3', 'THE GLADIATORS FC vs Arakkal Strikers', 3),
  ('sf-1', '2026-10-12', '17:45', 'SF 1', 'Winner of QF 1 vs Mourinho''s Pawn', 4),
  ('sf-2', '2026-10-13', '16:15', 'SF 2', 'Winner of QF 2 vs Winner of QF 3', 5),
  ('third-place', '2026-10-13', '17:00', '3rd Place Playoff', 'Loser of SF 1 vs Loser of SF 2', 6),
  ('final', '2026-10-13', '17:45', 'Final', 'Winner of SF 1 vs Winner of SF 2', 7)
ON CONFLICT (fixture_key) DO UPDATE SET
  match_date = EXCLUDED.match_date,
  start_time = EXCLUDED.start_time,
  round = EXCLUDED.round,
  fixture = EXCLUDED.fixture,
  display_order = EXCLUDED.display_order;
