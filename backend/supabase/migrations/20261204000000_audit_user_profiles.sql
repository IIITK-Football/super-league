-- Record profile changes in the existing audit history without retaining profile email values.
CREATE TRIGGER audit_user_profiles AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('id', 'email');
