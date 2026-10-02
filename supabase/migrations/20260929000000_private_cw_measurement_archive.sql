-- Measurements are served by the Sofapaint API after verified company-domain
-- authentication. Browser clients must not bypass that check via Storage.
-- The service_role used by the server and importer bypasses RLS.
CREATE POLICY "CW measurement archive is server only"
ON storage.objects
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (bucket_id <> 'cw-measurement-archive')
WITH CHECK (bucket_id <> 'cw-measurement-archive');
