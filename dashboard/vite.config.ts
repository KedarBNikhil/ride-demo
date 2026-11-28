import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

function localProductionOperator() {
  const project = 'wgvzmgyyoboyxdusoent';
  return {
    name: 'local-production-operator',
    configureServer(server: import('vite').ViteDevServer) {
      if (server.config.server.host !== '127.0.0.1' || !server.config.server.port || !server.config.server.strictPort) {
        throw new Error('Production dashboard requires a fixed port on 127.0.0.1');
      }
      const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', project, '--reveal', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Array<{ name: string; api_key: string }>;
      const key = keys.find(item => item.name === 'service_role')?.api_key;
      if (!key) throw new Error('Production service key unavailable; sign in to the Supabase CLI');
      const admin = createClient(`https://${project}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } });
      server.middlewares.use('/__local_operator_session', async (req, res) => {
        const host = req.headers.host;
        if (req.method !== 'POST' || host !== `127.0.0.1:${server.config.server.port}` || req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] !== 'same-origin') { res.statusCode = 403; res.end(); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        try {
          const { data: operators, error: operatorError } = await admin.from('settlement_operators').select('user_id').eq('enabled', true).limit(2);
          if (operatorError || operators?.length !== 1) throw new Error('Expected one enabled operator');
          const { data: user, error: userError } = await admin.auth.admin.getUserById(operators[0].user_id);
          if (userError || !user.user?.email) throw new Error('Operator email unavailable');
          const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.user.email });
          if (error || !data.properties?.hashed_token) throw new Error('Unable to create operator session');
          const client = createClient(`https://${project}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } });
          const result = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' });
          if (result.error || !result.data.session) throw new Error('Unable to verify operator session');
          const { access_token, refresh_token } = result.data.session;
          res.end(JSON.stringify({ access_token, refresh_token }));
        } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Could not start the local operator session.' })); }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localProductionOperator()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
