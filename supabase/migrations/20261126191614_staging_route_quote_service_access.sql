-- Staging: allow the trusted route service to save and return route quotes.
grant select, insert on table public.google_route_quotes to service_role;
