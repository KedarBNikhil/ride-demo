-- `require_production_user()` already existed when the pilot migration added
-- a one-argument overload with a default. PostgreSQL considers both callable
-- with zero arguments, which breaks every existing lifecycle RPC. Keep the
-- established zero-argument name and give the pilot-only helper a distinct
-- name; calls compiled against its function OID remain valid.
alter function public.require_production_user(text) rename to require_pilot_user;
