-- 1. Create the Reusable Trigger Function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Set the updated_at column to the exact current timestamp
  NEW.updated_at = now();
  -- Return the newly updated row to be saved
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Attach the trigger to the Matches table
DROP TRIGGER IF EXISTS set_matches_updated_at ON public.matches;
CREATE TRIGGER set_matches_updated_at
BEFORE UPDATE ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- 3. Attach the trigger to the Players table
DROP TRIGGER IF EXISTS set_players_updated_at ON public.players;
CREATE TRIGGER set_players_updated_at
BEFORE UPDATE ON public.players
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();