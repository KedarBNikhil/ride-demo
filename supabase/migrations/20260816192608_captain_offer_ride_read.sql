-- A captain must be able to read the ride attached to their pending offer;
-- otherwise the nested offer query returns an empty `rides` relation until
-- acceptance and the request sheet has nothing to render.
create policy "Captains read rides offered to them"
on public.rides for select to authenticated
using (
  exists (
    select 1 from public.ride_offers offer
    where offer.ride_id = rides.id
      and offer.captain_id = (select auth.uid())
      and offer.status = 'offered'
      and offer.expires_at > now()
  )
);
