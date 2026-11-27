import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

function stagingLocalOperator() {
  const enabled = process.env.SAWAARI_STAGING_LOCAL_OPERATOR === '1';
  return {
    name: 'staging-local-operator',
    configureServer(server: import('vite').ViteDevServer) {
      if (!enabled) return;
      if (server.config.server.host !== '127.0.0.1') throw new Error('Local operator mode requires 127.0.0.1 binding');
      const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', 'jhfjcujaspnkxznwytmb', '--reveal', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Array<{ name: string; api_key: string }>;
      const key = keys.find((item) => item.name === 'service_role')?.api_key;
      if (!key) throw new Error('Staging service key unavailable');
      const admin = createClient('https://jhfjcujaspnkxznwytmb.supabase.co', key, { auth: { persistSession: false, autoRefreshToken: false } });
      server.middlewares.use('/__staging_operator_session', async (req, res) => {
        const host = req.headers.host;
        const origin = req.headers.origin;
        if (req.method !== 'POST' || !host || !['localhost:3000', '127.0.0.1:3000'].includes(host) || origin !== `http://${host}` || req.headers['sec-fetch-site'] !== 'same-origin') { res.statusCode = 403; res.end(); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        try {
          const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'kedarnikhil10@gmail.com' });
          if (error || !data.properties?.hashed_token) throw new Error('Unable to create staging session');
          const client = createClient('https://jhfjcujaspnkxznwytmb.supabase.co', key, { auth: { persistSession: false, autoRefreshToken: false } });
          const result = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' });
          if (result.error || !result.data.session) throw new Error('Unable to verify staging session');
          const { access_token, refresh_token } = result.data.session;
          res.end(JSON.stringify({ access_token, refresh_token }));
        } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Could not start the local staging session.' })); }
      });
    },
  };
}


export default defineConfig({
  plugins: [react(), tailwindcss(), stagingLocalOperator()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
