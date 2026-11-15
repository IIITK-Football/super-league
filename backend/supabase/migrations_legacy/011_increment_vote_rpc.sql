-- Create a secure function to atomically increment votes
CREATE OR REPLACE FUNCTION increment_vote(selected_option_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.poll_options
  SET vote_count = vote_count + 1
  WHERE id = selected_option_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;