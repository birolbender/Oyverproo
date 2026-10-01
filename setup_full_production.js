import fs from 'fs';
import path from 'path';

const projectFiles = {
  // ==========================================
  // 1. PROJE VE DERLEYİCİ YAPILANDIRMASI
  // ==========================================
  "package.json": JSON.stringify({
    "name": "oyver-core",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
      "build": "tsc",
      "start": "node dist/app.js",
      "dev": "tsc && node dist/app.js",
      "migrate": "node --loader ts-node/esm src/db/migrate.ts",
      "seed": "node --loader ts-node/esm src/db/seed.ts --run",
      "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand",
      "test:unit": "node --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit",
      "test:concurrency": "node --experimental-vm-modules node_modules/jest/bin/jest.js tests/concurrency",
      "test:property": "node --experimental-vm-modules node_modules/jest/bin/jest.js tests/property"
    },
    "dependencies": {
      "@fastify/static": "^6.12.0",
      "@fastify/websocket": "^8.3.1",
      "decimal.js": "^10.4.3",
      "fastify": "^4.26.0",
      "pg": "^8.11.3",
      "ws": "^8.16.0"
    },
    "devDependencies": {
      "@types/node": "^20.11.0",
      "@types/pg": "^8.11.0",
      "@types/ws": "^8.5.10",
      "jest": "^29.7.0",
      "ts-jest": "^29.1.1",
      "ts-node": "^10.9.2",
      "typescript": "^5.3.3"
    }
  }, null, 2),

  "tsconfig.json": JSON.stringify({
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "outDir": "./dist",
      "rootDir": "./src"
    },
    "include": ["src/**/*"]
  }, null, 2),

  "jest.config.cjs": `module.exports = {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.ts'],
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: { '^(\\\\.{1,2}/.*)\\\\.js$': '$1' },
    transform: { '^.+\\\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }] },
    testTimeout: 60000,
    verbose: true,
    forceExit: true
};`,

  "Dockerfile": `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/
COPY public/ ./public/
EXPOSE 3000
CMD ["node", "dist/app.js"]`,

  "docker-compose.yml": `version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: oyver_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: oyver_secure_password
      POSTGRES_DB: oyver_core
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  api:
    build: .
    container_name: oyver_api
    depends_on:
      - postgres
    environment:
      PORT: 3000
      DATABASE_URL: postgresql://postgres:oyver_secure_password@postgres:5432/oyver_core
      SESSION_SECRET: e4d8c6b2a1f0987654321fedcba0123456789abcdef0123456789abcdef01234
      NODE_ENV: production
    ports:
      - "3000:3000"
volumes:
  pgdata:`,

  // ==========================================
  // 2. VERİTABANI GÖÇLERİ (MIGRATIONS)
  // ==========================================
  "migrations/001_initial_schema.sql": `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    balance_kor NUMERIC(24,6) NOT NULL DEFAULT 0.000000 CHECK (balance_kor >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    question TEXT NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'TRADING',
    resolution VARCHAR(16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ
);

CREATE TABLE amm_state (
    market_id UUID PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    yes_reserve NUMERIC(30,12) NOT NULL CHECK (yes_reserve > 0),
    no_reserve NUMERIC(30,12) NOT NULL CHECK (no_reserve > 0),
    yes_supply NUMERIC(30,12) NOT NULL DEFAULT 0,
    no_supply NUMERIC(30,12) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outcome VARCHAR(8) NOT NULL,
    shares NUMERIC(30,12) NOT NULL DEFAULT 0 CHECK (shares >= 0),
    avg_price NUMERIC(30,18) NOT NULL DEFAULT 0,
    realized_pnl NUMERIC(24,6) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_market_outcome UNIQUE (user_id, market_id, outcome)
);

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_account_user UNIQUE (code, owner_user_id),
    CONSTRAINT uq_account_market UNIQUE (code, market_id),
    CONSTRAINT chk_account_ownership CHECK (
        (code = '2000' AND owner_user_id IS NOT NULL AND market_id IS NULL) OR
        (code = '2100' AND market_id IS NOT NULL AND owner_user_id IS NULL) OR
        (code IN ('1000', '3000', '4000', '5000') AND owner_user_id IS NULL AND market_id IS NULL)
    )
);

CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_type VARCHAR(64) NOT NULL,
    reference_type VARCHAR(64),
    reference_id UUID,
    idempotency_key VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ledger_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    debit NUMERIC(24,6) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(24,6) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_line_not_both_zero CHECK (debit > 0 OR credit > 0),
    CONSTRAINT chk_line_exclusive CHECK (NOT (debit > 0 AND credit > 0))
);

CREATE OR REPLACE FUNCTION fn_prevent_ledger_line_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_LEDGER: Satirlar silinemez.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_ledger_line_delete
BEFORE DELETE ON ledger_lines
FOR EACH ROW EXECUTE FUNCTION fn_prevent_ledger_line_delete();

CREATE OR REPLACE FUNCTION fn_assert_entry_balance() RETURNS TRIGGER AS $$
DECLARE
    v_diff NUMERIC;
    v_count INT;
BEGIN
    SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0), COUNT(*)
    INTO v_diff, v_count
    FROM ledger_lines WHERE entry_id = NEW.entry_id;
    
    IF v_count < 2 THEN
        RAISE EXCEPTION 'LEDGER_INTEGRITY_VIOLATION: Entry en az 2 satir icermelidir.';
    END IF;
    IF v_diff != 0 THEN
        RAISE EXCEPTION 'LEDGER_UNBALANCED: Borc-Alacak farki %', v_diff;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_assert_entry_balance
AFTER INSERT OR UPDATE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_assert_entry_balance();

CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(24,6) NOT NULL CHECK (amount >= 0),
    outcome VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_settlement_market_user UNIQUE (market_id, user_id)
);

CREATE TABLE idempotency_keys (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint VARCHAR(128) NOT NULL,
    key VARCHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_status INT,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, endpoint, key)
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,

  "migrations/002_outbox_schema.sql": `CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON outbox_events(status, created_at) WHERE status = 'PENDING';`,

  "migrations/003_social_and_zarla.sql": `CREATE TABLE zarla_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(64) NOT NULL DEFAULT 'GÜNDEM',
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
    yes_votes INT NOT NULL DEFAULT 0 CHECK (yes_votes >= 0),
    no_votes INT NOT NULL DEFAULT 0 CHECK (no_votes >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE zarla_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES zarla_questions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote VARCHAR(8) NOT NULL CHECK (vote IN ('YES', 'NO')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_zarla_user_question UNIQUE (user_id, question_id)
);

CREATE TABLE market_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 1000),
    status VARCHAR(16) NOT NULL DEFAULT 'VISIBLE' CHECK (status IN ('VISIBLE', 'HIDDEN', 'FLAGGED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comments_market ON market_comments(market_id, created_at DESC) WHERE status = 'VISIBLE';

CREATE TABLE market_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type VARCHAR(16) NOT NULL CHECK (action_type IN ('BUY', 'SELL', 'SETTLE')),
    outcome VARCHAR(8),
    amount_kor NUMERIC(24,6) NOT NULL DEFAULT 0,
    shares NUMERIC(30,12) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activities_market ON market_activities(market_id, created_at DESC);`,

  // ==========================================
  // 3. ÇEKİRDEK YARDIMCILAR & DB BAĞLANTISI
  // ==========================================
  "src/utils/math.ts": `import Decimal from 'decimal.js';
Decimal.set({ precision: 50, rounding: Decimal.ROUND_DOWN });

export class MoneyMath {
    static roundDown(val: Decimal, scale: number = 6): Decimal {
        return val.toDecimalPlaces(scale, Decimal.ROUND_DOWN);
    }
    static roundUp(val: Decimal, scale: number = 6): Decimal {
        return val.toDecimalPlaces(scale, Decimal.ROUND_UP);
    }
}`,

  "src/utils/errors.ts": `import { FastifyReply } from 'fastify';

export class AppError extends Error {
    constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export function handleRouteError(error: unknown, reply: FastifyReply) {
    if (error instanceof AppError) {
        return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof Error) {
        const m = error.message;
        if (m.startsWith('INSUFFICIENT_BALANCE')) return reply.status(409).send({ error: { code: 'INSUFFICIENT_BALANCE', message: m } });
        if (m.startsWith('INSUFFICIENT_SHARES')) return reply.status(409).send({ error: { code: 'INSUFFICIENT_SHARES', message: m } });
        if (m.startsWith('SLIPPAGE_EXCEEDED')) return reply.status(422).send({ error: { code: 'SLIPPAGE_EXCEEDED', message: m } });
        if (m.startsWith('MARKET_NOT_TRADING')) return reply.status(422).send({ error: { code: 'MARKET_NOT_TRADING', message: m } });
        if (m.startsWith('MARKET_NOT_RESOLVED')) return reply.status(422).send({ error: { code: 'MARKET_NOT_RESOLVED', message: m } });
        if (m.startsWith('SOLVENCY_VIOLATION')) return reply.status(500).send({ error: { code: 'SOLVENCY_VIOLATION', message: m } });
        if (m.startsWith('LEDGER_UNBALANCED')) return reply.status(500).send({ error: { code: 'LEDGER_INTEGRITY_ERROR', message: m } });
    }
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message } });
}`,

  "src/db/index.ts": `import pg from 'pg';
const { Pool } = pg;
pg.types.setTypeParser(1700, (val: string) => val);

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:oyver_secure_password@localhost:5432/oyver_core',
    max: 20
});

export async function runInTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN;');
        const result = await callback(client);
        await client.query('COMMIT;');
        return result;
    } catch (error) {
        await client.query('ROLLBACK;');
        throw error;
    } finally {
        client.release();
    }
}`,

  "src/db/migrate.ts": `import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query(\`CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, version VARCHAR(255) UNIQUE NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());\`);
        const dir = path.resolve(__dirname, '../../migrations');
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
        for (const file of files) {
            const check = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [file]);
            if (check.rows.length === 0) {
                const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
                await client.query('BEGIN;');
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
                await client.query('COMMIT;');
                console.info(\`[MIGRATION] \${file} basariyla uygulandi.\`);
            }
        }
    } catch (err) {
        await client.query('ROLLBACK;');
        throw err;
    } finally {
        client.release();
    }
}`,

  "src/db/seed.ts": `import Decimal from 'decimal.js';
import crypto from 'crypto';
import { runInTransaction, pool } from './index.js';
import { LedgerEngine } from '../modules/ledger/engine.js';
import { runMigrations } from './migrate.js';

export async function seedDatabase() {
    await runMigrations();
    await runInTransaction(async (client) => {
        for (const code of ['1000', '3000', '4000', '5000']) {
            await client.query(\`INSERT INTO accounts (code) VALUES ($1) ON CONFLICT (code) WHERE owner_user_id IS NULL AND market_id IS NULL DO NOTHING\`, [code]);
        }
        const g = await client.query(\`SELECT id FROM ledger_entries WHERE idempotency_key = 'GENESIS_PLATFORM_CAPITAL'\`);
        if (g.rows.length === 0) {
            await LedgerEngine.recordEntry(client, 'GENESIS_CAPITAL', 'SYSTEM', '00000000-0000-0000-0000-000000000000', 'GENESIS_PLATFORM_CAPITAL', [
                { accountCode: '1000', debit: new Decimal(1000000), credit: new Decimal(0) },
                { accountCode: '3000', debit: new Decimal(0), credit: new Decimal(1000000) }
            ]);
        }
        const u = await client.query(\`SELECT id FROM users WHERE email = 'trader1@oyver.com'\`);
        if (u.rows.length === 0) {
            const salt = crypto.randomBytes(16).toString('hex');
            const pass = crypto.scryptSync('OyverSecure2026!', salt, 64).toString('hex') + ':' + salt;
            const ur = await client.query(\`INSERT INTO users (email, username, password_hash, balance_kor) VALUES ('trader1@oyver.com', 'Ali_Kaya', $1, 5000) RETURNING id\`, [pass]);
            const uid = ur.rows[0].id;
            await client.query(\`INSERT INTO accounts (code, owner_user_id) VALUES ('2000', $1)\`, [uid]);
            await LedgerEngine.recordEntry(client, 'USER_GENESIS_DEPOSIT', 'USER', uid, \`SEED_DEP_\${uid}\`, [
                { accountCode: '1000', debit: new Decimal(5000), credit: new Decimal(0) },
                { accountCode: '2000', userId: uid, debit: new Decimal(0), credit: new Decimal(5000) }
            ]);
        }
        const m = await client.query(\`SELECT id FROM markets WHERE slug = 'bist-100-rekor-2026'\`);
        if (m.rows.length === 0) {
            const mr = await client.query(\`INSERT INTO markets (slug, question, description) VALUES ('bist-100-rekor-2026', 'BIST 100 2026 Yilinda 15.000 Puanini Asar mi?', 'Resmi veri baz alinir.') RETURNING id\`);
            const mid = mr.rows[0].id;
            await client.query(\`INSERT INTO accounts (code, market_id) VALUES ('2100', $1)\`, [mid]);
            await client.query(\`INSERT INTO amm_state (market_id, yes_reserve, no_reserve) VALUES ($1, 10000, 10000)\`, [mid]);
            await LedgerEngine.recordEntry(client, 'MARKET_INITIAL_SUBSIDY', 'MARKET', mid, \`SEED_MKT_\${mid}\`, [
                { accountCode: '3000', debit: new Decimal(10000), credit: new Decimal(0) },
                { accountCode: '2100', marketId: mid, debit: new Decimal(0), credit: new Decimal(10000) }
            ]);
        }
    });
    console.info('[SEED] Tohumlama tamamlandi.');
}

if (process.argv[2] === '--run') {
    seedDatabase().then(() => pool.end()).catch(e => { console.error(e); pool.end(); process.exit(1); });
}`,

  // ==========================================
  // 4. MOTORLAR (AMM, LEDGER, POSITIONS)
  // ==========================================
  "src/modules/amm/engine.ts": `import Decimal from 'decimal.js';
import { MoneyMath } from '../../utils/math.js';

export interface AMMState {
    yesReserve: Decimal;
    noReserve: Decimal;
    yesSupply: Decimal;
    noSupply: Decimal;
}

export class AMMEngine {
    static calculateBuy(state: AMMState, mGross: Decimal, feeRate: Decimal) {
        const fee = MoneyMath.roundUp(mGross.mul(feeRate), 6);
        const mNet = mGross.minus(fee);
        if (mNet.lte(0)) throw new Error('INVALID_AMOUNT: Net yatirim sifirdan buyuk olmalidir.');

        const k = state.yesReserve.mul(state.noReserve);
        const newNoReserve = state.noReserve.plus(mNet);
        const newYesReserve = k.div(newNoReserve);
        const deltaY = state.yesReserve.minus(newYesReserve);
        const sharesOut = MoneyMath.roundDown(mNet.plus(deltaY), 12);

        return { mNet, fee, newYesReserve, newNoReserve, sharesOut };
    }

    static calculateSell(state: AMMState, sharesIn: Decimal, feeRate: Decimal) {
        if (sharesIn.lte(0)) throw new Error('INVALID_AMOUNT: Pay sifirdan buyuk olmalidir.');
        const Y = state.yesReserve;
        const N = state.noReserve;
        const S = sharesIn;

        const B = Y.plus(N).plus(S);
        const C = S.mul(N);
        const discriminant = B.pow(2).minus(C.mul(4));
        if (discriminant.lt(0)) throw new Error('MATH_ERROR: Negatif diskriminant');

        const sqrtDisc = discriminant.sqrt();
        const grossPayout = C.mul(2).div(B.plus(sqrtDisc)); // Citardauq kararlı kökü
        if (grossPayout.gte(N)) throw new Error('SOLVENCY_VIOLATION: Satis rezerv limitini asti');

        const fee = MoneyMath.roundUp(grossPayout.mul(feeRate), 6);
        const netPayout = MoneyMath.roundDown(grossPayout.minus(fee), 6);

        return {
            grossPayout: MoneyMath.roundDown(grossPayout, 6),
            fee,
            netPayout,
            newYesReserve: Y.plus(S).minus(grossPayout),
            newNoReserve: N.minus(grossPayout)
        };
    }
}`,

  "src/modules/positions/engine.ts": `import Decimal from 'decimal.js';
import { MoneyMath } from '../../utils/math.js';

export interface PositionRecord {
    shares: Decimal;
    avgPrice: Decimal;
    realizedPnl: Decimal;
}

export class PositionEngine {
    static applyBuy(current: PositionRecord, acquiredShares: Decimal, costKor: Decimal): PositionRecord {
        const newShares = current.shares.plus(acquiredShares);
        const newTotalCost = current.shares.mul(current.avgPrice).plus(costKor);
        return {
            shares: MoneyMath.roundDown(newShares, 12),
            avgPrice: newTotalCost.div(newShares).toDecimalPlaces(18, Decimal.ROUND_HALF_UP),
            realizedPnl: current.realizedPnl
        };
    }

    static applySell(current: PositionRecord, soldShares: Decimal, netPayoutKor: Decimal): PositionRecord {
        if (soldShares.gt(current.shares)) throw new Error('INSUFFICIENT_SHARES: Yetersiz pay adedi');
        const costBasisSold = soldShares.mul(current.avgPrice);
        const tradePnl = netPayoutKor.minus(costBasisSold);
        const newShares = current.shares.minus(soldShares);
        return {
            shares: MoneyMath.roundDown(newShares, 12),
            avgPrice: newShares.eq(0) ? new Decimal(0) : current.avgPrice,
            realizedPnl: MoneyMath.roundDown(current.realizedPnl.plus(tradePnl), 6)
        };
    }
}`,

  "src/modules/ledger/engine.ts": `import { PoolClient } from 'pg';
import Decimal from 'decimal.js';

export interface LedgerLineInput {
    accountCode: string;
    userId?: string | null;
    marketId?: string | null;
    debit: Decimal;
    credit: Decimal;
}

export class LedgerEngine {
    static async recordEntry(client: PoolClient, entryType: string, refType: string, refId: string, idempKey: string, lines: LedgerLineInput[]): Promise<string> {
        let totalD = new Decimal(0), totalC = new Decimal(0);
        for (const l of lines) { totalD = totalD.plus(l.debit); totalC = totalC.plus(l.credit); }
        if (!totalD.eq(totalC) || totalD.lte(0)) throw new Error(\`LEDGER_UNBALANCED: Borc (\${totalD}) Alacak (\${totalC}) dengesiz\`);
        if (lines.length < 2) throw new Error('LEDGER_INTEGRITY_VIOLATION: En az 2 satir zorunludur');

        const er = await client.query(\`INSERT INTO ledger_entries (entry_type, reference_type, reference_id, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING id\`, [entryType, refType, refId, idempKey]);
        const entryId = er.rows[0].id;

        for (const l of lines) {
            const ar = await client.query(\`SELECT id FROM accounts WHERE code = $1 AND (owner_user_id = $2 OR ($2 IS NULL AND owner_user_id IS NULL)) AND (market_id = $3 OR ($3 IS NULL AND market_id IS NULL))\`, [l.accountCode, l.userId || null, l.marketId || null]);
            let accId = ar.rows.length > 0 ? ar.rows[0].id : (await client.query(\`INSERT INTO accounts (code, owner_user_id, market_id) VALUES ($1, $2, $3) RETURNING id\`, [l.accountCode, l.userId || null, l.marketId || null])).rows[0].id;
            await client.query(\`INSERT INTO ledger_lines (entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)\`, [entryId, accId, l.debit.toFixed(6), l.credit.toFixed(6)]);
        }
        return entryId;
    }
}`,

  "src/modules/ledger/reconciliation.service.ts": `import { PoolClient } from 'pg';
import Decimal from 'decimal.js';

export class ReconciliationService {
    static async reconcileUser(client: PoolClient, userId: string) {
        const ur = await client.query(\`SELECT balance_kor FROM users WHERE id = $1\`, [userId]);
        const cached = new Decimal(ur.rows[0].balance_kor);
        const lr = await client.query(\`SELECT COALESCE(SUM(l.credit - l.debit), 0) as b FROM ledger_lines l JOIN accounts a ON l.account_id = a.id WHERE a.code = '2000' AND a.owner_user_id = $1\`, [userId]);
        const ledger = new Decimal(lr.rows[0].b);
        const diff = cached.minus(ledger).abs();
        return { matched: diff.eq(0), diff };
    }

    static async reconcileGlobalLedger(client: PoolClient) {
        const res = await client.query(\`SELECT 
            COALESCE(SUM(CASE WHEN a.code = '1000' THEN l.debit - l.credit ELSE 0 END), 0) as cash,
            COALESCE(SUM(CASE WHEN a.code IN ('2000', '2100', '3000', '4000') THEN l.credit - l.debit ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN a.code = '5000' THEN l.debit - l.credit ELSE 0 END), 0) as liabilities_and_equity
            FROM ledger_lines l JOIN accounts a ON l.account_id = a.id\`);
        const diff = new Decimal(res.rows[0].cash).minus(new Decimal(res.rows[0].liabilities_and_equity)).abs();
        return { balanced: diff.eq(0), netImbalance: diff };
    }
}`,

  "src/modules/ledger/reconciliation.worker.ts": `import { pool } from '../../db/index.js';
import { ReconciliationService } from './reconciliation.service.js';

let circuitBreaker = false;
export const isCircuitBreakerActive = () => circuitBreaker;

export function startReconciliationWorker(intervalMs: number = 30000) {
    setInterval(async () => {
        const client = await pool.connect();
        try {
            const audit = await ReconciliationService.reconcileGlobalLedger(client);
            if (!audit.balanced) {
                circuitBreaker = true;
                console.error(\`[CIRCUIT_BREAKER] Kasa dengesizligi tespit edildi: \${audit.netImbalance.toFixed(6)} KOR\`);
                await client.query(\`UPDATE markets SET status = 'CLOSED' WHERE status = 'TRADING'\`);
            } else if (circuitBreaker) {
                circuitBreaker = false;
            }
        } catch (e) {
            console.error('[RECONCILIATION_ERROR]', e);
        } finally {
            client.release();
        }
    }, intervalMs);
}`,

  // ==========================================
  // 5. İŞLEM SERVİSLERİ (TRADE & SETTLEMENT & AUTH)
  // ==========================================
  "src/modules/orders/trade.service.ts": `import { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import { AMMEngine, AMMState } from '../amm/engine.js';
import { PositionEngine } from '../positions/engine.js';
import { LedgerEngine } from '../ledger/engine.js';

export class TradeService {
    static async executeBuy(client: PoolClient, input: { userId: string; marketId: string; outcome: 'YES' | 'NO'; amountGross: Decimal; minSharesOut: Decimal; feeRate: Decimal; idempotencyKey: string }) {
        const mr = await client.query(\`SELECT m.id, m.status, a.yes_reserve, a.no_reserve, a.yes_supply, a.no_supply FROM markets m JOIN amm_state a ON m.id = a.market_id WHERE m.id = $1 FOR UPDATE\`, [input.marketId]);
        if (mr.rows.length === 0 || mr.rows[0].status !== 'TRADING') throw new Error('MARKET_NOT_TRADING');

        const ur = await client.query(\`UPDATE users SET balance_kor = balance_kor - $1, updated_at = NOW() WHERE id = $2 AND balance_kor >= $1 RETURNING balance_kor\`, [input.amountGross.toFixed(6), input.userId]);
        if (ur.rows.length === 0) throw new Error('INSUFFICIENT_BALANCE');

        const isYes = input.outcome === 'YES';
        const amm: AMMState = { yesReserve: new Decimal(mr.rows[0].yes_reserve), noReserve: new Decimal(mr.rows[0].no_reserve), yesSupply: new Decimal(mr.rows[0].yes_supply), noSupply: new Decimal(mr.rows[0].no_supply) };
        const calc = AMMEngine.calculateBuy(isYes ? amm : { yesReserve: amm.noReserve, noReserve: amm.yesReserve, yesSupply: amm.noSupply, noSupply: amm.yesSupply }, input.amountGross, input.feeRate);
        if (calc.sharesOut.lt(input.minSharesOut)) throw new Error('SLIPPAGE_EXCEEDED');

        const ny = isYes ? calc.newYesReserve : calc.newNoReserve;
        const nn = isYes ? calc.newNoReserve : calc.newYesReserve;
        await client.query(\`UPDATE amm_state SET yes_reserve = $1, no_reserve = $2, updated_at = NOW() WHERE market_id = $3\`, [ny.toFixed(12), nn.toFixed(12), input.marketId]);

        await LedgerEngine.recordEntry(client, 'TRADE_BUY', 'MARKET', input.marketId, input.idempotencyKey, [
            { accountCode: '2000', userId: input.userId, debit: input.amountGross, credit: new Decimal(0) },
            { accountCode: '2100', marketId: input.marketId, debit: new Decimal(0), credit: calc.mNet },
            { accountCode: '4000', debit: new Decimal(0), credit: calc.fee }
        ]);

        const pr = await client.query(\`SELECT shares, avg_price, realized_pnl FROM positions WHERE market_id = $1 AND user_id = $2 AND outcome = $3 FOR UPDATE\`, [input.marketId, input.userId, input.outcome]);
        const curPos = pr.rows.length > 0 ? { shares: new Decimal(pr.rows[0].shares), avgPrice: new Decimal(pr.rows[0].avg_price), realizedPnl: new Decimal(pr.rows[0].realized_pnl) } : { shares: new Decimal(0), avgPrice: new Decimal(0), realizedPnl: new Decimal(0) };
        const upPos = PositionEngine.applyBuy(curPos, calc.sharesOut, input.amountGross);

        await client.query(\`INSERT INTO positions (market_id, user_id, outcome, shares, avg_price, realized_pnl) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, market_id, outcome) DO UPDATE SET shares = $4, avg_price = $5, realized_pnl = $6, updated_at = NOW()\`, [input.marketId, input.userId, input.outcome, upPos.shares.toFixed(12), upPos.avgPrice.toFixed(18), upPos.realizedPnl.toFixed(6)]);
        await client.query(\`INSERT INTO market_activities (market_id, user_id, action_type, outcome, amount_kor, shares) VALUES ($1, $2, 'BUY', $3, $4, $5)\`, [input.marketId, input.userId, input.outcome, input.amountGross.toFixed(6), calc.sharesOut.toFixed(12)]);

        await this.verifySolvency(client, input.marketId);
        return { sharesOut: calc.sharesOut, feePaid: calc.fee, netInvested: calc.mNet, userBalance: new Decimal(ur.rows[0].balance_kor) };
    }

    static async executeSell(client: PoolClient, input: { userId: string; marketId: string; outcome: 'YES' | 'NO'; sharesToSell: Decimal; minPayoutKor: Decimal; feeRate: Decimal; idempotencyKey: string }) {
        const mr = await client.query(\`SELECT m.id, m.status, a.yes_reserve, a.no_reserve, a.yes_supply, a.no_supply FROM markets m JOIN amm_state a ON m.id = a.market_id WHERE m.id = $1 FOR UPDATE\`, [input.marketId]);
        if (mr.rows.length === 0 || mr.rows[0].status !== 'TRADING') throw new Error('MARKET_NOT_TRADING');

        const pr = await client.query(\`SELECT shares, avg_price, realized_pnl FROM positions WHERE market_id = $1 AND user_id = $2 AND outcome = $3 FOR UPDATE\`, [input.marketId, input.userId, input.outcome]);
        if (pr.rows.length === 0 || new Decimal(pr.rows[0].shares).lt(input.sharesToSell)) throw new Error('INSUFFICIENT_SHARES');

        const curPos = { shares: new Decimal(pr.rows[0].shares), avgPrice: new Decimal(pr.rows[0].avg_price), realizedPnl: new Decimal(pr.rows[0].realized_pnl) };
        const isYes = input.outcome === 'YES';
        const amm: AMMState = { yesReserve: new Decimal(mr.rows[0].yes_reserve), noReserve: new Decimal(mr.rows[0].no_reserve), yesSupply: new Decimal(mr.rows[0].yes_supply), noSupply: new Decimal(mr.rows[0].no_supply) };
        const calc = AMMEngine.calculateSell(isYes ? amm : { yesReserve: amm.noReserve, noReserve: amm.yesReserve, yesSupply: amm.noSupply, noSupply: amm.yesSupply }, input.sharesToSell, input.feeRate);
        if (calc.netPayout.lt(input.minPayoutKor)) throw new Error('SLIPPAGE_EXCEEDED');

        const ny = isYes ? calc.newYesReserve : calc.newNoReserve;
        const nn = isYes ? calc.newNoReserve : calc.newYesReserve;
        await client.query(\`UPDATE amm_state SET yes_reserve = $1, no_reserve = $2, updated_at = NOW() WHERE market_id = $3\`, [ny.toFixed(12), nn.toFixed(12), input.marketId]);

        await LedgerEngine.recordEntry(client, 'TRADE_SELL', 'MARKET', input.marketId, input.idempotencyKey, [
            { accountCode: '2100', marketId: input.marketId, debit: calc.grossPayout, credit: new Decimal(0) },
            { accountCode: '2000', userId: input.userId, debit: new Decimal(0), credit: calc.netPayout },
            { accountCode: '4000', debit: new Decimal(0), credit: calc.fee }
        ]);

        const ur = await client.query(\`UPDATE users SET balance_kor = balance_kor + $1, updated_at = NOW() WHERE id = $2 RETURNING balance_kor\`, [calc.netPayout.toFixed(6), input.userId]);
        const upPos = PositionEngine.applySell(curPos, input.sharesToSell, calc.netPayout);
        await client.query(\`UPDATE positions SET shares = $1, avg_price = $2, realized_pnl = $3, updated_at = NOW() WHERE market_id = $4 AND user_id = $5 AND outcome = $6\`, [upPos.shares.toFixed(12), upPos.avgPrice.toFixed(18), upPos.realizedPnl.toFixed(6), input.marketId, input.userId, input.outcome]);
        await client.query(\`INSERT INTO market_activities (market_id, user_id, action_type, outcome, amount_kor, shares) VALUES ($1, $2, 'SELL', $3, $4, $5)\`, [input.marketId, input.userId, input.outcome, calc.netPayout.toFixed(6), input.sharesToSell.toFixed(12)]);

        await this.verifySolvency(client, input.marketId);
        return { grossPayout: calc.grossPayout, netPayout: calc.netPayout, feePaid: calc.fee, userBalance: new Decimal(ur.rows[0].balance_kor) };
    }

    private static async verifySolvency(client: PoolClient, marketId: string) {
        const er = await client.query(\`SELECT COALESCE(SUM(l.credit - l.debit), 0) as b FROM ledger_lines l JOIN accounts a ON l.account_id = a.id WHERE a.code = '2100' AND a.market_id = $1\`, [marketId]);
        const cMarket = new Decimal(er.rows[0].b);
        const pr = await client.query(\`SELECT outcome, COALESCE(SUM(shares), 0) as s FROM positions WHERE market_id = $1 AND status = 'OPEN' GROUP BY outcome\`, [marketId]);
        let qY = new Decimal(0), qN = new Decimal(0);
        for (const r of pr.rows) { if (r.outcome === 'YES') qY = new Decimal(r.s); if (r.outcome === 'NO') qN = new Decimal(r.s); }
        if (cMarket.lt(Decimal.max(qY, qN))) throw new Error('SOLVENCY_VIOLATION');
    }
}`,

  "src/modules/settlement/settlement.service.ts": `import { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import { LedgerEngine } from '../ledger/engine.js';
import { MoneyMath } from '../../utils/math.js';

export class SettlementService {
    static async settleUserPosition(client: PoolClient, marketId: string, userId: string, idempKey: string) {
        const mr = await client.query(\`SELECT status, resolution FROM markets WHERE id = $1 FOR UPDATE\`, [marketId]);
        if (mr.rows.length === 0 || (mr.rows[0].status !== 'RESOLVED' && mr.rows[0].status !== 'VOID')) throw new Error('MARKET_NOT_RESOLVED');

        const pr = await client.query(\`SELECT id, outcome, shares FROM positions WHERE market_id = $1 AND user_id = $2 AND status = 'OPEN' FOR UPDATE\`, [marketId, userId]);
        if (pr.rows.length === 0) return { settled: false, payout: new Decimal(0) };

        const shares = new Decimal(pr.rows[0].shares);
        let payout = new Decimal(0);
        if (mr.rows[0].status === 'RESOLVED' && pr.rows[0].outcome === mr.rows[0].resolution) payout = MoneyMath.roundDown(shares, 6);
        else if (mr.rows[0].status === 'VOID') payout = MoneyMath.roundDown(shares.mul(0.5), 6);

        const sr = await client.query(\`INSERT INTO settlements (market_id, user_id, amount, outcome, idempotency_key) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (market_id, user_id) DO NOTHING RETURNING id\`, [marketId, userId, payout.toFixed(6), mr.rows[0].resolution, idempKey]);
        if (sr.rows.length === 0) return { settled: false, payout: new Decimal(0) };

        if (payout.gt(0)) {
            await LedgerEngine.recordEntry(client, 'SETTLEMENT_PAYOUT', 'SETTLEMENT', sr.rows[0].id, \`SETTLE:\${marketId}:\${userId}\`, [
                { accountCode: '2100', marketId, debit: payout, credit: new Decimal(0) },
                { accountCode: '2000', userId, debit: new Decimal(0), credit: payout }
            ]);
            await client.query(\`UPDATE users SET balance_kor = balance_kor + $1, updated_at = NOW() WHERE id = $2\`, [payout.toFixed(6), userId]);
        }
        await client.query(\`UPDATE positions SET status = 'SETTLED', updated_at = NOW() WHERE id = $1\`, [pr.rows[0].id]);
        return { settled: true, payout };
    }
}`,

  "src/modules/auth/session.service.ts": `import crypto from 'crypto';
import { PoolClient } from 'pg';

export class SessionService {
    static async createSession(client: PoolClient, userId: string): Promise<string> {
        const raw = crypto.randomBytes(32).toString('hex');
        const secret = process.env.SESSION_SECRET || 'oyver_default_hmac_secret_must_be_set_in_env_32b_strict';
        const hash = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        const exp = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        await client.query(\`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)\`, [userId, hash, exp]);
        return raw;
    }

    static async validateSession(client: PoolClient, token: string): Promise<string | null> {
        const secret = process.env.SESSION_SECRET || 'oyver_default_hmac_secret_must_be_set_in_env_32b_strict';
        const hash = crypto.createHmac('sha256', secret).update(token).digest('hex');
        const r = await client.query(\`SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW()\`, [hash]);
        return r.rows.length > 0 ? r.rows[0].user_id : null;
    }
}`,

  "src/modules/social/zarla.service.ts": `import { runInTransaction, pool } from '../../db/index.js';
import { AppError } from '../../utils/errors.js';

export class ZarlaService {
    static async castVote(userId: string, questionId: string, vote: 'YES' | 'NO') {
        return await runInTransaction(async (client) => {
            const qr = await client.query(\`SELECT status FROM zarla_questions WHERE id = $1 FOR UPDATE\`, [questionId]);
            if (qr.rows.length === 0 || qr.rows[0].status !== 'ACTIVE') throw new AppError(422, 'QUESTION_CLOSED', 'Soru oylamaya kapali');

            const vr = await client.query(\`SELECT vote FROM zarla_votes WHERE user_id = $1 AND question_id = $2\`, [userId, questionId]);
            const isNew = vr.rows.length === 0;
            const prev = isNew ? null : vr.rows[0].vote;
            if (!isNew && prev === vote) return { updated: false, currentVote: vote };

            await client.query(\`INSERT INTO zarla_votes (user_id, question_id, vote, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id, question_id) DO UPDATE SET vote = $3, updated_at = NOW()\`, [userId, questionId, vote]);
            if (isNew) {
                await client.query(\`UPDATE zarla_questions SET \${vote === 'YES' ? 'yes_votes = yes_votes + 1' : 'no_votes = no_votes + 1'} WHERE id = $1\`, [questionId]);
            } else {
                await client.query(\`UPDATE zarla_questions SET yes_votes = yes_votes \${vote === 'YES' ? '+ 1' : '- 1'}, no_votes = no_votes \${vote === 'NO' ? '+ 1' : '- 1'} WHERE id = $1\`, [questionId]);
            }
            const ur = await client.query(\`SELECT yes_votes, no_votes FROM zarla_questions WHERE id = $1\`, [questionId]);
            return { updated: true, currentVote: vote, yesVotes: ur.rows[0].yes_votes, noVotes: ur.rows[0].no_votes };
        });
    }

    static async getQuestions(userId?: string) {
        const r = await pool.query(\`SELECT q.*, v.vote as user_vote FROM zarla_questions q LEFT JOIN zarla_votes v ON q.id = v.question_id AND v.user_id = $1 WHERE q.status = 'ACTIVE' ORDER BY q.created_at DESC\`, [userId || null]);
        return r.rows;
    }
}`,

  "src/modules/events/outbox.service.ts": `import { PoolClient } from 'pg';
import { pool } from '../../db/index.js';

export class OutboxService {
    static async enqueueEvent(client: PoolClient, aggregateType: string, aggregateId: string, eventType: string, payload: unknown) {
        await client.query(\`INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ($1, $2, $3, $4)\`, [aggregateType, aggregateId, eventType, JSON.stringify(payload)]);
    }

    static async processPendingEvents(publish: (channel: string, data: unknown) => void) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN;');
            const r = await client.query(\`SELECT id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED\`);
            if (r.rows.length === 0) { await client.query('COMMIT;'); return; }

            const ids: string[] = [];
            for (const row of r.rows) {
                publish(\`\${row.aggregate_type.toLowerCase()}:\${row.aggregate_id}\`, { eventType: row.event_type, data: row.payload });
                ids.push(row.id);
            }
            await client.query(\`UPDATE outbox_events SET status = 'PUBLISHED', published_at = NOW() WHERE id = ANY($1::uuid[])\`, [ids]);
            await client.query('COMMIT;');
        } catch (e) {
            await client.query('ROLLBACK;');
        } finally {
            client.release();
        }
    }
}`,

  // ==========================================
  // 6. MIDDLEWARE VE PLUGINS
  // ==========================================
  "src/middleware/auth.ts": `import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db/index.js';
import { SessionService } from '../modules/auth/session.service.js';
import { AppError } from '../utils/errors.js';

declare module 'fastify' { interface FastifyRequest { userId?: string; } }

export async function authenticateSession(req: FastifyRequest, reply: FastifyReply) {
    let token: string | undefined;
    const cookie = req.headers.cookie;
    if (cookie) {
        const m = cookie.split(';').find(c => c.trim().startsWith('__Host-oyver_session='));
        if (m) token = m.split('=')[1];
    }
    if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.split(' ')[1];
    if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Giris yapmaniz gerekmektedir.');

    const client = await pool.connect();
    try {
        const uid = await SessionService.validateSession(client, token);
        if (!uid) throw new AppError(401, 'INVALID_SESSION', 'Gecersiz veya suresi dolmus oturum.');
        req.userId = uid;
    } finally { client.release(); }
}`,

  "src/middleware/idempotency.ts": `import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { pool } from '../db/index.js';
import { AppError } from '../utils/errors.js';

export function canonicalJson(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
    return '{' + Object.keys(obj as Record<string, unknown>).sort().map(k => \`\${JSON.stringify(k)}:\${canonicalJson((obj as Record<string, unknown>)[k])}\`).join(',') + '}';
}

export async function idempotencyPreHandler(req: FastifyRequest, reply: FastifyReply) {
    const key = req.headers['x-idempotency-key'] as string | undefined;
    if (!key || !req.userId) return;

    const endpoint = req.routerPath || req.url;
    const hash = crypto.createHash('sha256').update(canonicalJson(req.body || {})).digest('hex');
    const r = await pool.query(\`SELECT request_hash, status, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3\`, [req.userId, endpoint, key]);

    if (r.rows.length > 0) {
        if (r.rows[0].request_hash !== hash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSE', 'Farkli veri ile ayni anahtar kullanildi');
        if (r.rows[0].status === 'PROCESSING') throw new AppError(409, 'REQUEST_ALREADY_IN_PROGRESS', 'Istek isleniyor');
        return reply.status(r.rows[0].response_status).send(r.rows[0].response_body);
    }
    await pool.query(\`INSERT INTO idempotency_keys (user_id, endpoint, key, request_hash, status) VALUES ($1, $2, $3, $4, 'PROCESSING')\`, [req.userId, endpoint, key, hash]);
}

export async function persistIdempotencyResponse(userId: string, endpoint: string, key: string, status: number, body: unknown) {
    await pool.query(\`UPDATE idempotency_keys SET status = 'RESOLVED', response_status = $1, response_body = $2 WHERE user_id = $3 AND endpoint = $4 AND key = $5\`, [status, JSON.stringify(body), userId, endpoint, key]);
}`,

  "src/plugins/realtime.ts": `import { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { OutboxService } from '../modules/events/outbox.service.js';

export async function realtimePlugin(fastify: FastifyInstance) {
    await fastify.register(fastifyWebsocket);
    const clients = new Map<WebSocket, Set<string>>();

    fastify.get('/ws', { websocket: true }, (connection) => {
        const ws = connection.socket;
        clients.set(ws, new Set());
        ws.on('message', (m: string) => {
            try {
                const p = JSON.parse(m);
                if (p.action === 'SUBSCRIBE') clients.get(ws)?.add(p.channel);
            } catch {}
        });
        ws.on('close', () => clients.delete(ws));
    });

    setInterval(async () => {
        await OutboxService.processPendingEvents((ch, data) => {
            const msg = JSON.stringify({ channel: ch, payload: data });
            for (const [ws, subs] of clients) {
                if (subs.has(ch) && ws.readyState === WebSocket.OPEN) ws.send(msg);
            }
        });
    }, 400);
}`,

  "src/plugins/frontend.ts": `import { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function frontendPlugin(fastify: FastifyInstance) {
    const pub = path.resolve(__dirname, '../../public');
    await fastify.register(fastifyStatic, { root: pub, prefix: '/static/', serve: false });

    fastify.get('/', async (req, reply) => {
        const nonce = (reply.getHeader('content-security-policy') as string | undefined)?.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1] || '';
        let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf-8');
        return reply.type('text/html').send(html.replace(/{{NONCE}}/g, nonce));
    });

    fastify.get('/static/*', async (req, reply) => {
        const p = path.join(pub, (req.params as { '*': string })['*']);
        if (!p.startsWith(pub) || !fs.existsSync(p)) return reply.status(404).send('Not Found');
        const ext = path.extname(p);
        const mime = ext === '.js' ? 'application/javascript' : (ext === '.css' ? 'text/css' : 'text/plain');
        return reply.type(mime).send(fs.createReadStream(p));
    });
}`,

  // ==========================================
  // 7. REST ROTALARI
  // ==========================================
  "src/modules/auth/auth.routes.ts": `import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import Decimal from 'decimal.js';
import { runInTransaction, pool } from '../../db/index.js';
import { SessionService } from './session.service.js';
import { AppError, handleRouteError } from '../../utils/errors.js';

export async function authRoutes(f: FastifyInstance) {
    f.post('/auth/register', async (req, rep) => {
        try {
            const b = req.body as any;
            if (!b.email || !b.username || !b.password) throw new AppError(400, 'INVALID_PAYLOAD', 'Tum alanlar zorunludur.');
            const salt = crypto.randomBytes(16).toString('hex');
            const pass = crypto.scryptSync(b.password, salt, 64).toString('hex') + ':' + salt;

            const res = await runInTransaction(async (c) => {
                const ur = await c.query(\`INSERT INTO users (email, username, password_hash, balance_kor) VALUES ($1, $2, $3, 0) RETURNING id, email, username, balance_kor\`, [b.email, b.username, pass]);
                const u = ur.rows[0];
                await c.query(\`INSERT INTO accounts (code, owner_user_id) VALUES ('2000', $1)\`, [u.id]);
                const token = await SessionService.createSession(c, u.id);
                return { u, token };
            });
            rep.header('Set-Cookie', \`__Host-oyver_session=\${res.token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800\`);
            return rep.status(201).send({ user: res.u });
        } catch (e) { return handleRouteError(e, rep); }
    });

    f.post('/auth/login', async (req, rep) => {
        try {
            const b = req.body as any;
            const ur = await pool.query(\`SELECT id, email, username, password_hash, balance_kor, status FROM users WHERE email = $1\`, [b.email]);
            if (ur.rows.length === 0 || ur.rows[0].status !== 'ACTIVE') throw new AppError(401, 'INVALID_CREDENTIALS', 'Gecersiz e-posta veya sifre');
            const [saved, salt] = ur.rows[0].password_hash.split(':');
            if (crypto.scryptSync(b.password, salt, 64).toString('hex') !== saved) throw new AppError(401, 'INVALID_CREDENTIALS', 'Gecersiz e-posta veya sifre');

            const token = await runInTransaction(async c => SessionService.createSession(c, ur.rows[0].id));
            rep.header('Set-Cookie', \`__Host-oyver_session=\${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800\`);
            return rep.send({ user: { id: ur.rows[0].id, email: ur.rows[0].email, username: ur.rows[0].username, balanceKor: ur.rows[0].balance_kor } });
        } catch (e) { return handleRouteError(e, rep); }
    });

    f.post('/auth/logout', async (req, rep) => {
        rep.header('Set-Cookie', '__Host-oyver_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
        return rep.send({ success: true });
    });
}`,

  "src/modules/markets/markets.routes.ts": `import { FastifyInstance } from 'fastify';
import { pool } from '../../db/index.js';
import { authenticateSession } from '../../middleware/auth.js';
import { handleRouteError } from '../../utils/errors.js';

export async function marketRoutes(f: FastifyInstance) {
    f.get('/markets', async (req, rep) => {
        const r = await pool.query(\`SELECT m.*, a.yes_reserve, a.no_reserve FROM markets m JOIN amm_state a ON m.id = a.market_id ORDER BY m.created_at DESC\`);
        return rep.send({ markets: r.rows });
    });
    f.get('/markets/:id', async (req, rep) => {
        const r = await pool.query(\`SELECT m.*, a.yes_reserve, a.no_reserve FROM markets m JOIN amm_state a ON m.id = a.market_id WHERE m.id = $1\`, [(req.params as any).id]);
        return r.rows.length > 0 ? rep.send({ market: r.rows[0] }) : rep.status(404).send({ error: 'MARKET_NOT_FOUND' });
    });
    f.get('/markets/:id/positions', { preHandler: [authenticateSession] }, async (req, rep) => {
        const r = await pool.query(\`SELECT outcome, shares, avg_price, realized_pnl FROM positions WHERE market_id = $1 AND user_id = $2\`, [(req.params as any).id, req.userId]);
        return rep.send({ positions: r.rows });
    });
}`,

  "src/modules/orders/orders.routes.ts": `import { FastifyInstance } from 'fastify';
import Decimal from 'decimal.js';
import { runInTransaction } from '../../db/index.js';
import { TradeService } from './trade.service.js';
import { authenticateSession } from '../../middleware/auth.js';
import { idempotencyPreHandler, persistIdempotencyResponse } from '../../middleware/idempotency.js';
import { AppError, handleRouteError } from '../../utils/errors.js';

export async function orderRoutes(f: FastifyInstance) {
    f.post('/markets/:id/buy', { preHandler: [authenticateSession, idempotencyPreHandler] }, async (req, rep) => {
        try {
            const b = req.body as any;
            const mid = (req.params as any).id;
            const key = req.headers['x-idempotency-key'] as string;
            if (!key) throw new AppError(400, 'MISSING_KEY', 'X-Idempotency-Key zorunludur');

            const res = await runInTransaction(c => TradeService.executeBuy(c, {
                userId: req.userId!, marketId: mid, outcome: b.outcome, amountGross: new Decimal(b.amountGross),
                minSharesOut: new Decimal(b.minSharesOut || 0), feeRate: new Decimal(0.02), idempotencyKey: key
            }));
            const out = { success: true, sharesOut: res.sharesOut.toFixed(12), feePaid: res.feePaid.toFixed(6), balanceKor: res.userBalance.toFixed(6) };
            await persistIdempotencyResponse(req.userId!, req.routerPath || req.url, key, 200, out);
            return rep.send(out);
        } catch (e) { return handleRouteError(e, rep); }
    });

    f.post('/markets/:id/sell', { preHandler: [authenticateSession, idempotencyPreHandler] }, async (req, rep) => {
        try {
            const b = req.body as any;
            const mid = (req.params as any).id;
            const key = req.headers['x-idempotency-key'] as string;
            if (!key) throw new AppError(400, 'MISSING_KEY', 'X-Idempotency-Key zorunludur');

            const res = await runInTransaction(c => TradeService.executeSell(c, {
                userId: req.userId!, marketId: mid, outcome: b.outcome, sharesToSell: new Decimal(b.sharesToSell),
                minPayoutKor: new Decimal(b.minPayoutKor || 0), feeRate: new Decimal(0.02), idempotencyKey: key
            }));
            const out = { success: true, netPayout: res.netPayout.toFixed(6), feePaid: res.feePaid.toFixed(6), balanceKor: res.userBalance.toFixed(6) };
            await persistIdempotencyResponse(req.userId!, req.routerPath || req.url, key, 200, out);
            return rep.send(out);
        } catch (e) { return handleRouteError(e, rep); }
    });
}`,

  "src/modules/settlement/settlement.routes.ts": `import { FastifyInstance } from 'fastify';
import { runInTransaction, pool } from '../../db/index.js';
import { SettlementService } from './settlement.service.js';
import { authenticateSession } from '../../middleware/auth.js';
import { handleRouteError } from '../../utils/errors.js';

export async function settlementRoutes(f: FastifyInstance) {
    f.post('/markets/:id/close', { preHandler: [authenticateSession] }, async (req, rep) => {
        const r = await pool.query(\`UPDATE markets SET status = 'CLOSED', closed_at = NOW() WHERE id = $1 AND status = 'TRADING' RETURNING id\`, [(req.params as any).id]);
        return r.rows.length > 0 ? rep.send({ success: true, status: 'CLOSED' }) : rep.status(409).send({ error: 'INVALID_TRANSITION' });
    });
    f.post('/markets/:id/resolve', { preHandler: [authenticateSession] }, async (req, rep) => {
        const b = req.body as any;
        const r = await pool.query(\`UPDATE markets SET status = 'RESOLVED', resolution = $1, resolved_at = NOW() WHERE id = $2 AND status = 'CLOSED' RETURNING id\`, [b.outcome, (req.params as any).id]);
        return r.rows.length > 0 ? rep.send({ success: true, status: 'RESOLVED' }) : rep.status(409).send({ error: 'INVALID_TRANSITION' });
    });
    f.post('/markets/:id/settle', { preHandler: [authenticateSession] }, async (req, rep) => {
        try {
            const mid = (req.params as any).id;
            const res = await runInTransaction(c => SettlementService.settleUserPosition(c, mid, req.userId!, \`SETTLE:\${mid}:\${req.userId}\`));
            return rep.send({ success: true, settled: res.settled, payout: res.payout.toFixed(6) });
        } catch (e) { return handleRouteError(e, rep); }
    });
}`,

  "src/modules/ledger/ledger.routes.ts": `import { FastifyInstance } from 'fastify';
import { pool } from '../../db/index.js';
import { authenticateSession } from '../../middleware/auth.js';
import { ReconciliationService } from './reconciliation.service.js';

export async function ledgerRoutes(f: FastifyInstance) {
    f.get('/wallet', { preHandler: [authenticateSession] }, async (req, rep) => {
        const client = await pool.connect();
        try {
            const ur = await client.query(\`SELECT balance_kor FROM users WHERE id = $1\`, [req.userId]);
            const rec = await ReconciliationService.reconcileUser(client, req.userId!);
            return rep.send({ balanceKor: ur.rows[0].balance_kor, ledgerReconciled: rec.matched });
        } finally { client.release(); }
    });
    f.get('/ledger', { preHandler: [authenticateSession] }, async (req, rep) => {
        const r = await pool.query(\`SELECT e.entry_type, l.debit, l.credit, a.code FROM ledger_lines l JOIN ledger_entries e ON l.entry_id = e.id JOIN accounts a ON l.account_id = a.id WHERE a.owner_user_id = $1 ORDER BY e.created_at DESC LIMIT 50\`, [req.userId]);
        return rep.send({ entries: r.rows });
    });
}`,

  "src/modules/social/zarla.routes.ts": `import { FastifyInstance } from 'fastify';
import { ZarlaService } from './zarla.service.js';
import { authenticateSession } from '../../middleware/auth.js';
import { handleRouteError } from '../../utils/errors.js';

export async function zarlaRoutes(f: FastifyInstance) {
    f.get('/zarla/questions', async (req, rep) => rep.send({ questions: await ZarlaService.getQuestions(req.userId) }));
    f.post('/zarla/:id/vote', { preHandler: [authenticateSession] }, async (req, rep) => {
        try {
            return rep.send(await ZarlaService.castVote(req.userId!, (req.params as any).id, (req.body as any).vote));
        } catch (e) { return handleRouteError(e, rep); }
    });
}`,

  "src/modules/social/comments.routes.ts": `import { FastifyInstance } from 'fastify';
import { pool } from '../../db/index.js';
import { authenticateSession } from '../../middleware/auth.js';
import { handleRouteError, AppError } from '../../utils/errors.js';

export async function commentsRoutes(f: FastifyInstance) {
    f.get('/markets/:id/comments', async (req, rep) => {
        const r = await pool.query(\`SELECT c.body, c.created_at, u.username FROM market_comments c JOIN users u ON c.user_id = u.id WHERE c.market_id = $1 AND c.status = 'VISIBLE' ORDER BY c.created_at DESC LIMIT 50\`, [(req.params as any).id]);
        return rep.send({ comments: r.rows });
    });
    f.post('/markets/:id/comments', { preHandler: [authenticateSession] }, async (req, rep) => {
        try {
            const b = (req.body as any).text;
            if (!b || b.trim().length === 0) throw new AppError(400, 'EMPTY', 'Yorum bos olamaz');
            const clean = b.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
            const r = await pool.query(\`INSERT INTO market_comments (market_id, user_id, body) VALUES ($1, $2, $3) RETURNING body, created_at\`, [(req.params as any).id, req.userId, clean]);
            return rep.status(201).send({ comment: r.rows[0] });
        } catch (e) { return handleRouteError(e, rep); }
    });
    f.get('/markets/:id/activity', async (req, rep) => {
        const r = await pool.query(\`SELECT a.*, u.username FROM market_activities a JOIN users u ON a.user_id = u.id WHERE a.market_id = $1 ORDER BY a.created_at DESC LIMIT 50\`, [(req.params as any).id]);
        return rep.send({ activities: r.rows });
    });
}`,

  "src/modules/social/leaderboard.routes.ts": `import { FastifyInstance } from 'fastify';
import { pool } from '../../db/index.js';

export async function leaderboardRoutes(f: FastifyInstance) {
    f.get('/leaderboard', async (req, rep) => {
        const r = await pool.query(\`SELECT u.username, u.balance_kor, COALESCE(SUM(p.realized_pnl), 0) as total_pnl FROM users u LEFT JOIN positions p ON u.id = p.user_id WHERE u.status = 'ACTIVE' GROUP BY u.id, u.username, u.balance_kor ORDER BY total_pnl DESC LIMIT 50\`);
        return rep.send({ leaderboard: r.rows });
    });
}`,

  "src/modules/system/health.routes.ts": `import { FastifyInstance } from 'fastify';
import { pool } from '../../db/index.js';
import { isCircuitBreakerActive } from '../ledger/reconciliation.worker.js';
import { ReconciliationService } from '../ledger/reconciliation.service.js';

export async function healthRoutes(f: FastifyInstance) {
    f.get('/health/live', async () => ({ status: 'ALIVE' }));
    f.get('/health/ready', async (req, rep) => {
        const client = await pool.connect();
        try {
            await client.query('SELECT 1;');
            return isCircuitBreakerActive() ? rep.status(503).send({ status: 'UNREADY' }) : rep.send({ status: 'READY' });
        } finally { client.release(); }
    });
    f.get('/metrics/solvency', async (req, rep) => {
        const client = await pool.connect();
        try {
            const audit = await ReconciliationService.reconcileGlobalLedger(client);
            return rep.status(audit.balanced ? 200 : 500).send({ balanced: audit.balanced, netImbalance: audit.netImbalance.toFixed(6), circuitBreaker: isCircuitBreakerActive() });
        } finally { client.release(); }
    });
}`,

  // ==========================================
  // 8. ANA SUNUCU (APP.TS)
  // ==========================================
  "src/app.ts": `import fastify from 'fastify';
import crypto from 'crypto';
import { authRoutes } from './modules/auth/auth.routes.js';
import { marketRoutes } from './modules/markets/markets.routes.js';
import { orderRoutes } from './modules/orders/orders.routes.js';
import { settlementRoutes } from './modules/settlement/settlement.routes.js';
import { ledgerRoutes } from './modules/ledger/ledger.routes.js';
import { zarlaRoutes } from './modules/social/zarla.routes.js';
import { commentsRoutes } from './modules/social/comments.routes.js';
import { leaderboardRoutes } from './modules/social/leaderboard.routes.js';
import { healthRoutes } from './modules/system/health.routes.js';
import { realtimePlugin } from './plugins/realtime.js';
import { frontendPlugin } from './plugins/frontend.js';
import { startReconciliationWorker, isCircuitBreakerActive } from './modules/ledger/reconciliation.worker.js';

export function buildApp() {
    const app = fastify({ logger: false });

    app.addHook('onRequest', async (req, reply) => {
        if (isCircuitBreakerActive() && req.url.startsWith('/markets') && req.method === 'POST') {
            return reply.status(503).send({ error: { code: 'CIRCUIT_BREAKER_ACTIVE', message: 'Finansal kontrol sebebiyle islemler askida' } });
        }
        const nonce = crypto.randomBytes(16).toString('base64');
        reply.header('Content-Security-Policy', \`default-src 'self'; script-src 'self' 'nonce-\${nonce}'; style-src 'self' 'nonce-\${nonce}'; object-src 'none'; base-uri 'none';\`);
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
    });

    app.register(realtimePlugin);
    app.register(frontendPlugin);
    app.register(healthRoutes);
    app.register(authRoutes);
    app.register(marketRoutes);
    app.register(orderRoutes);
    app.register(settlementRoutes);
    app.register(ledgerRoutes);
    app.register(zarlaRoutes);
    app.register(commentsRoutes);
    app.register(leaderboardRoutes);

    return app;
}

if (process.env.NODE_ENV !== 'test') {
    const server = buildApp();
    server.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
        if (err) process.exit(1);
        console.log(\`OYVER Core ayakta: \${address}\`);
        startReconciliationWorker(30000);
    });
}`,

  // ==========================================
  // 9. ÖN YÜZ DOSYALARI (PUBLIC)
  // ==========================================
  "public/index.html": `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <title>OYVER Tahmin Pazari</title>
    <link rel="stylesheet" href="/static/css/style.css">
</head>
<body>
    <header class="app-header">
        <div class="header-left"><h1 class="logo">OYVER</h1></div>
        <div class="header-right" id="auth-panel"></div>
    </header>
    <main class="app-container">
        <section class="markets-container">
            <div class="section-title"><h2>Pazarlar</h2><button id="btn-refresh-markets" class="btn btn-secondary">Yenile</button></div>
            <div class="markets-grid" id="markets-list"></div>
        </section>
        <section class="trade-console">
            <div id="console-empty-state" class="empty-state">Lutfen pazar secin.</div>
            <div id="console-active-state" class="hidden">
                <h3 id="selected-market-question"></h3>
                <div class="pool-metrics">
                    <div class="metric-card"><label>YES Orani</label><span id="prob-yes" class="metric-value green">--%</span></div>
                    <div class="metric-card"><label>NO Orani</label><span id="prob-no" class="metric-value red">--%</span></div>
                </div>
                <div class="trade-tabs">
                    <button class="tab-btn active" id="tab-buy">Alim (BUY)</button>
                    <button class="tab-btn" id="tab-sell">Satis (SELL)</button>
                    <button class="tab-btn" id="tab-settle">Tasfiye</button>
                </div>
                <form id="form-buy" class="trade-form">
                    <div class="outcome-selector">
                        <button type="button" class="btn-outcome active" data-outcome="YES" id="buy-pick-yes">YES</button>
                        <button type="button" class="btn-outcome" data-outcome="NO" id="buy-pick-no">NO</button>
                    </div>
                    <input type="number" step="0.000001" id="buy-amount" required placeholder="Tutar (KOR)">
                    <button type="submit" class="btn btn-primary btn-block">Al</button>
                </form>
                <form id="form-sell" class="trade-form hidden">
                    <input type="number" step="0.000001" id="sell-shares" required placeholder="Pay Adedi">
                    <button type="submit" class="btn btn-danger btn-block">Sat</button>
                </form>
                <div id="panel-settle" class="hidden">
                    <button id="btn-execute-settle" class="btn btn-success btn-block">Tasfiyeyi Gerceklestir</button>
                </div>
                <div id="position-summary" class="user-position-box"></div>
            </div>
        </section>
    </main>
    <div id="auth-modal" class="modal hidden">
        <div class="modal-card">
            <form id="form-auth">
                <input type="email" id="auth-email" required placeholder="E-Posta">
                <input type="password" id="auth-password" required placeholder="Sifre">
                <button type="submit" id="btn-auth-submit" class="btn btn-primary btn-block">Giris Yap</button>
            </form>
        </div>
    </div>
    <div id="toast-container" class="toast-container"></div>
    <script nonce="{{NONCE}}" src="/static/js/api.js"></script>
    <script nonce="{{NONCE}}" src="/static/js/ws.js"></script>
    <script nonce="{{NONCE}}" src="/static/js/ui.js"></script>
    <script nonce="{{NONCE}}" src="/static/js/app.js"></script>
</body>
</html>`,

  "public/css/style.css": `body { background: #0f172a; color: #f8fafc; font-family: sans-serif; margin: 0; }
.app-header { display: flex; justify-content: space-between; padding: 1rem 2rem; background: #1e293b; }
.app-container { display: grid; grid-template-columns: 1fr 400px; gap: 2rem; padding: 2rem; }
.markets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
.market-card { background: #1e293b; padding: 1rem; border-radius: 8px; cursor: pointer; border: 1px solid #334155; }
.market-card.selected { border-color: #3b82f6; }
.pool-metrics { display: flex; gap: 1rem; margin: 1rem 0; }
.metric-card { background: #0f172a; padding: 0.5rem 1rem; border-radius: 6px; flex: 1; }
.green { color: #10b981; } .red { color: #ef4444; }
.btn { padding: 0.5rem 1rem; border-radius: 6px; border: none; cursor: pointer; font-weight: bold; }
.btn-primary { background: #3b82f6; color: white; }
.btn-danger { background: #ef4444; color: white; }
.btn-success { background: #10b981; color: white; }
.btn-secondary { background: #334155; color: white; }
.btn-block { width: 100%; margin-top: 0.5rem; }
.hidden { display: none !important; }
.toast-container { position: fixed; bottom: 1rem; right: 1rem; }
.toast { background: #1e293b; border-left: 4px solid #10b981; padding: 0.5rem 1rem; margin-top: 0.5rem; }`,

  "public/js/api.js": `const ApiClient = {
    key: () => 'idemp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
    async req(url, opt = {}) {
        const r = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) }, credentials: 'include', ...opt });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error?.message || 'Hata olustu');
        return d;
    },
    login: (email, password) => ApiClient.req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => ApiClient.req('/auth/logout', { method: 'POST' }),
    wallet: () => ApiClient.req('/wallet'),
    markets: () => ApiClient.req('/markets'),
    positions: (id) => ApiClient.req(\`/markets/\${id}/positions\`),
    buy: (id, outcome, amountGross) => ApiClient.req(\`/markets/\${id}/buy\`, { method: 'POST', headers: { 'X-Idempotency-Key': ApiClient.key() }, body: JSON.stringify({ outcome, amountGross }) }),
    sell: (id, outcome, sharesToSell) => ApiClient.req(\`/markets/\${id}/sell\`, { method: 'POST', headers: { 'X-Idempotency-Key': ApiClient.key() }, body: JSON.stringify({ outcome, sharesToSell }) }),
    settle: (id) => ApiClient.req(\`/markets/\${id}/settle\`, { method: 'POST', headers: { 'X-Idempotency-Key': ApiClient.key() } })
};`,

  "public/js/ws.js": `class RealtimeClient {
    constructor() { this.subs = new Set(); this.handlers = new Map(); }
    connect() {
        this.ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws');
        this.ws.onmessage = (e) => {
            try {
                const m = JSON.parse(e.data);
                if (m.channel && this.handlers.has(m.channel)) this.handlers.get(m.channel)(m.payload);
            } catch {}
        };
        this.ws.onclose = () => setTimeout(() => this.connect(), 3000);
    }
    subscribe(ch, cb) { this.subs.add(ch); this.handlers.set(ch, cb); if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ action: 'SUBSCRIBE', channel: ch })); }
}
const realtime = new RealtimeClient();`,

  "public/js/ui.js": `const UI = {
    toast(msg) {
        const c = document.getElementById('toast-container');
        const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
        c.appendChild(t); setTimeout(() => t.remove(), 3500);
    },
    renderMarkets(list, selId, onSelect) {
        const g = document.getElementById('markets-list'); g.replaceChildren();
        for (const m of list) {
            const el = document.createElement('div'); el.className = 'market-card ' + (m.id === selId ? 'selected' : '');
            const h = document.createElement('h4'); h.textContent = m.question;
            el.appendChild(h); el.onclick = () => onSelect(m); g.appendChild(el);
        }
    }
};`,

  "public/js/app.js": `(function() {
    let curMkt = null, outcome = 'YES';
    async function init() {
        realtime.connect();
        try { const w = await ApiClient.wallet(); document.getElementById('auth-panel').textContent = w.balanceKor + ' KOR'; } catch {}
        loadMarkets();
        document.getElementById('btn-refresh-markets').onclick = loadMarkets;
        document.getElementById('buy-pick-yes').onclick = () => outcome = 'YES';
        document.getElementById('buy-pick-no').onclick = () => outcome = 'NO';
        document.getElementById('form-buy').onsubmit = async (e) => {
            e.preventDefault();
            try {
                const r = await ApiClient.buy(curMkt.id, outcome, document.getElementById('buy-amount').value);
                UI.toast('Alim yapildi: ' + r.sharesOut + ' pay');
                loadMarkets();
            } catch(err) { UI.toast(err.message); }
        };
    }
    async function loadMarkets() {
        const res = await ApiClient.markets();
        UI.renderMarkets(res.markets, curMkt?.id, (m) => {
            curMkt = m;
            document.getElementById('console-empty-state').classList.add('hidden');
            document.getElementById('console-active-state').classList.remove('hidden');
            document.getElementById('selected-market-question').textContent = m.question;
            const y = parseFloat(m.yes_reserve), n = parseFloat(m.no_reserve);
            document.getElementById('prob-yes').textContent = '%' + ((n / (y + n)) * 100).toFixed(1);
            document.getElementById('prob-no').textContent = '%' + ((y / (y + n)) * 100).toFixed(1);
        });
    }
    window.addEventListener('DOMContentLoaded', init);
})();`,

  // ==========================================
  // 10. TEST PAKETLERİ (TESTS)
  // ==========================================
  "tests/unit/amm.test.ts": `import Decimal from 'decimal.js';
import { AMMEngine, AMMState } from '../../src/modules/amm/engine.js';

describe('AMM Engine Unit Tests', () => {
    test('Citardauq Round-Trip: BUY then SELL returns principal without fee', () => {
        const state: AMMState = { yesReserve: new Decimal(10000), noReserve: new Decimal(10000), yesSupply: new Decimal(0), noSupply: new Decimal(0) };
        const buy = AMMEngine.calculateBuy(state, new Decimal(500), new Decimal(0));
        const sell = AMMEngine.calculateSell({ yesReserve: buy.newYesReserve, noReserve: buy.newNoReserve, yesSupply: buy.sharesOut, noSupply: new Decimal(500) }, buy.sharesOut, new Decimal(0));
        expect(sell.netPayout.toDecimalPlaces(6).toNumber()).toBeCloseTo(500, 5);
    });

    test('Thin Volume Catastrophic Cancellation Immunity', () => {
        const state: AMMState = { yesReserve: new Decimal(1000000), noReserve: new Decimal(1000000), yesSupply: new Decimal(0), noSupply: new Decimal(0) };
        const sell = AMMEngine.calculateSell(state, new Decimal(0.000001), new Decimal(0));
        expect(sell.netPayout.gt(0)).toBe(true);
        expect(sell.netPayout.isFinite()).toBe(true);
    });
});`,

  "tests/concurrency/concurrency.test.ts": `import Decimal from 'decimal.js';
import { pool, runInTransaction } from '../../src/db/index.js';
import { TradeService } from '../../src/modules/orders/trade.service.js';
import { LedgerEngine } from '../../src/modules/ledger/engine.js';

describe('Concurrency Protection Tests', () => {
    test('User with 100 KOR executes 10 parallel 20 KOR orders: Exactly 5 succeed', async () => {
        let uid = '', mid = '';
        await runInTransaction(async c => {
            const u = await c.query("INSERT INTO users (email, username, password_hash, balance_kor) VALUES ('race@test.com', 'racer', 'p', 100) RETURNING id");
            uid = u.rows[0].id;
            const m = await c.query("INSERT INTO markets (slug, question) VALUES ('race-mkt', 'Race?') RETURNING id");
            mid = m.rows[0].id;
            await c.query("INSERT INTO accounts (code, owner_user_id) VALUES ('2000', $1)", [uid]);
            await c.query("INSERT INTO accounts (code, market_id) VALUES ('2100', $1)", [mid]);
            await c.query("INSERT INTO amm_state (market_id, yes_reserve, no_reserve) VALUES ($1, 50000, 50000)", [mid]);
            await LedgerEngine.recordEntry(c, 'DEP', 'USER', uid, 'K1', [{ accountCode: '1000', debit: new Decimal(100), credit: new Decimal(0) }, { accountCode: '2000', userId: uid, debit: new Decimal(0), credit: new Decimal(100) }]);
            await LedgerEngine.recordEntry(c, 'SUB', 'MARKET', mid, 'K2', [{ accountCode: '3000', debit: new Decimal(50000), credit: new Decimal(0) }, { accountCode: '2100', marketId: mid, debit: new Decimal(0), credit: new Decimal(50000) }]);
        });

        const attempts = Array.from({ length: 10 }).map((_, i) => runInTransaction(c => TradeService.executeBuy(c, {
            userId: uid, marketId: mid, outcome: 'YES', amountGross: new Decimal(20), minSharesOut: new Decimal(0), feeRate: new Decimal(0.02), idempotencyKey: 'RK_' + i
        })));

        const results = await Promise.allSettled(attempts);
        expect(results.filter(r => r.status === 'fulfilled').length).toBe(5);
        expect(results.filter(r => r.status === 'rejected').length).toBe(5);
    });
});`,

  "tests/property/monte_carlo.test.ts": `import Decimal from 'decimal.js';
import { AMMEngine, AMMState } from '../../src/modules/amm/engine.js';
import { MoneyMath } from '../../src/utils/math.js';

describe('Monte Carlo 10,000 Cycle Solvency Verification', () => {
    test('10,000 randomized BUY and SELL operations maintain C_market >= max(Q_Y, Q_N)', () => {
        let Y = new Decimal(10000), N = new Decimal(10000);
        let Q_Y = new Decimal(0), Q_N = new Decimal(0);
        let C_market = new Decimal(10000);

        for (let i = 0; i < 10000; i++) {
            const state: AMMState = { yesReserve: Y, noReserve: N, yesSupply: Q_Y, noSupply: Q_N };
            const isBuy = Math.random() > 0.4 || Q_Y.lt(1);
            const isYes = Math.random() > 0.5;

            if (isBuy) {
                const mGross = new Decimal((Math.random() * 99 + 1).toFixed(6));
                const res = AMMEngine.calculateBuy(isYes ? state : { yesReserve: N, noReserve: Y, yesSupply: Q_N, noSupply: Q_Y }, mGross, new Decimal(0.02));
                if (isYes) { Y = res.newYesReserve; N = res.newNoReserve; Q_Y = Q_Y.plus(res.sharesOut); }
                else { N = res.newYesReserve; Y = res.newNoReserve; Q_N = Q_N.plus(res.sharesOut); }
                C_market = C_market.plus(res.mNet);
            } else {
                const held = isYes ? Q_Y : Q_N;
                const sIn = MoneyMath.roundDown(held.mul(Math.random() * 0.49 + 0.01), 6);
                if (sIn.gt(0)) {
                    const res = AMMEngine.calculateSell(isYes ? state : { yesReserve: N, noReserve: Y, yesSupply: Q_N, noSupply: Q_Y }, sIn, new Decimal(0.02));
                    if (isYes) { Y = res.newYesReserve; N = res.newNoReserve; Q_Y = Q_Y.minus(sIn); }
                    else { N = res.newYesReserve; Y = res.newNoReserve; Q_N = Q_N.minus(sIn); }
                    C_market = C_market.minus(res.grossPayout);
                }
            }
            expect(C_market.gte(Decimal.max(Q_Y, Q_N))).toBe(true);
        }
    });
});`,

  "tests/integration/full_cycle.test.ts": `import Decimal from 'decimal.js';
import { runInTransaction } from '../../src/db/index.js';
import { TradeService } from '../../src/modules/orders/trade.service.js';
import { SettlementService } from '../../src/modules/settlement/settlement.service.js';
import { ReconciliationService } from '../../src/modules/ledger/reconciliation.service.js';
import { LedgerEngine } from '../../src/modules/ledger/engine.js';

describe('Full Lifecycle Integration Test', () => {
    test('End-to-end Lifecycle', async () => {
        await runInTransaction(async c => {
            const u = await c.query("INSERT INTO users (email, username, password_hash, balance_kor) VALUES ('full@test.com', 'fuller', 'p', 1000) RETURNING id");
            const uid = u.rows[0].id;
            const m = await c.query("INSERT INTO markets (slug, question) VALUES ('full-mkt', 'Full?') RETURNING id");
            const mid = m.rows[0].id;
            await c.query("INSERT INTO accounts (code, owner_user_id) VALUES ('2000', $1)", [uid]);
            await c.query("INSERT INTO accounts (code, market_id) VALUES ('2100', $1)", [mid]);
            await c.query("INSERT INTO amm_state (market_id, yes_reserve, no_reserve) VALUES ($1, 10000, 10000)", [mid]);

            await LedgerEngine.recordEntry(c, 'DEP', 'USER', uid, 'K1', [{ accountCode: '1000', debit: new Decimal(1000), credit: new Decimal(0) }, { accountCode: '2000', userId: uid, debit: new Decimal(0), credit: new Decimal(1000) }]);
            await LedgerEngine.recordEntry(c, 'SUB', 'MARKET', mid, 'K2', [{ accountCode: '3000', debit: new Decimal(10000), credit: new Decimal(0) }, { accountCode: '2100', marketId: mid, debit: new Decimal(0), credit: new Decimal(10000) }]);

            const b = await TradeService.executeBuy(c, { userId: uid, marketId: mid, outcome: 'YES', amountGross: new Decimal(100), minSharesOut: new Decimal(0), feeRate: new Decimal(0.02), idempotencyKey: 'TB1' });
            expect(b.sharesOut.gt(0)).toBe(true);

            await c.query("UPDATE markets SET status = 'RESOLVED', resolution = 'YES' WHERE id = $1", [mid]);
            const s = await SettlementService.settleUserPosition(c, mid, uid, 'TS1');
            expect(s.settled).toBe(true);

            const rec = await ReconciliationService.reconcileUser(c, uid);
            expect(rec.matched).toBe(true);
        });
    });
});`
};

// Dosyaları eksiksiz oluştur
for (const [file, content] of Object.entries(projectFiles)) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, content.trim(), 'utf-8');
    console.log(`[OLUSTURULDU] ${file}`);
}
console.log('\n[TAMAMLANDI] Tum uretim dosyalari eksiksiz yazildi.');
