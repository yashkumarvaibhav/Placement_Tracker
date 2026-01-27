import { Pool } from 'pg';
import dns from 'dns/promises';

const run = async () => {
    // Direct DB Host (from user screenshot)
    const directHost = 'db.bqldotdtsodmfmnxwavl.supabase.co';
    const password = process.env.PGPASSWORD;

    console.log(`[TEST] resolving ${directHost}...`);
    try {
        const [v4, v6] = await Promise.allSettled([
            dns.resolve4(directHost),
            dns.resolve6(directHost)
        ]);
        console.log('IPv4:', v4.status === 'fulfilled' ? v4.value : v4.reason);
        console.log('IPv6:', v6.status === 'fulfilled' ? v6.value : v6.reason);
    } catch (e) {
        console.error('DNS failed', e);
    }

    console.log('[TEST] Trying connection to Direct Host...');
    const pool = new Pool({
        host: directHost,
        port: 5432,
        database: 'postgres',
        user: 'postgres', // User from screenshot
        password: password,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000
    });

    try {
        const client = await pool.connect();
        console.log('SUCCESS! Connected to Direct Host.');
        client.release();
    } catch (e) {
        console.error('FAILED to connect to Direct Host:', e.message);
    }
    await pool.end();
};

run();
