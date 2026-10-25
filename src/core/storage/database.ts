import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CredentialSummary, ServerRecord } from '../../shared/contracts'
import { routeSchema, elevationSchema } from '../validation'
import { AppError } from '../../shared/errors'

export class Store {
  readonly db: DatabaseSync
  constructor(readonly path: string) {
    try {
      if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      this.db = new DatabaseSync(path)
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;')
      const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      if (version > 13) throw new AppError('STORAGE_FAILED')
      if (version === 0) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value BLOB NOT NULL);
        CREATE TABLE credentials (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('password','private-key')), secret BLOB NOT NULL, createdAt INTEGER NOT NULL);
        CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, credentialId TEXT NOT NULL REFERENCES credentials(id) ON DELETE RESTRICT, revision INTEGER NOT NULL, createdAt INTEGER NOT NULL);
        CREATE TABLE known_hosts (host TEXT NOT NULL, port INTEGER NOT NULL, key BLOB NOT NULL, fingerprint TEXT NOT NULL, confirmedAt INTEGER NOT NULL, PRIMARY KEY(host,port));
        PRAGMA user_version=1;
        COMMIT;
      `)
      if (version < 2) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE servers_v2 (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, credentialId TEXT REFERENCES credentials(id) ON DELETE RESTRICT, revision INTEGER NOT NULL, createdAt INTEGER NOT NULL);
        INSERT INTO servers_v2 SELECT id,name,host,port,username,credentialId,revision,createdAt FROM servers;
        DROP TABLE servers;
        ALTER TABLE servers_v2 RENAME TO servers;
        ALTER TABLE credentials ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
        PRAGMA user_version=2;
        COMMIT;
      `)
      if (version < 3) this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE servers ADD COLUMN route TEXT NOT NULL DEFAULT '{"type":"direct"}';
        PRAGMA user_version=3;
        COMMIT;
      `)
      if (version < 4) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, serverIds TEXT NOT NULL, mode TEXT NOT NULL, expiresAt INTEGER NOT NULL, revokedAt INTEGER, createdAt INTEGER NOT NULL);
        CREATE TABLE operations (id TEXT PRIMARY KEY, profileId TEXT NOT NULL, requestKey TEXT NOT NULL, state TEXT NOT NULL, detail BLOB NOT NULL, result BLOB, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, intentAt INTEGER, errorCode TEXT, outputBytes INTEGER NOT NULL DEFAULT 0, UNIQUE(profileId,requestKey));
        CREATE TABLE operation_output (operationId TEXT NOT NULL REFERENCES operations(id), seq INTEGER NOT NULL, stream TEXT NOT NULL, elapsedMs INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(operationId,seq));
        PRAGMA user_version=4;
        COMMIT;
      `)
      if (version < 5) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE approval_policy (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, detail BLOB);
        INSERT INTO approval_policy VALUES(1,0,NULL);
        PRAGMA user_version=5;
        COMMIT;
      `)
      if (version < 6) this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE operations ADD COLUMN replayClearedAt INTEGER;
        ALTER TABLE operations ADD COLUMN replayClearReason TEXT;
        ALTER TABLE operations ADD COLUMN decidedAt INTEGER;
        ALTER TABLE operations ADD COLUMN humanDecision TEXT;
        ALTER TABLE operation_output ADD COLUMN encoding TEXT NOT NULL DEFAULT 'json';
        CREATE TABLE recording_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, detail BLOB);
        INSERT INTO recording_settings VALUES(1,0,NULL);
        CREATE TABLE operation_tombstones (profileId TEXT NOT NULL, requestKey TEXT NOT NULL, PRIMARY KEY(profileId,requestKey));
        CREATE INDEX operations_history ON operations(createdAt DESC,id);
        CREATE INDEX operations_profile_history ON operations(profileId,createdAt DESC);
        PRAGMA user_version=6;
        COMMIT;
      `)
      if (version < 7) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE ai_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, detail BLOB);
        INSERT INTO ai_settings VALUES(1,0,NULL);
        PRAGMA user_version=7;
        COMMIT;
      `)
      if (version < 8) this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE profiles ADD COLUMN source TEXT NOT NULL DEFAULT 'mcp';
        CREATE TABLE server_dossiers (serverId TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE, detail BLOB NOT NULL);
        PRAGMA user_version=8;
        COMMIT;
      `)
      if (version < 9) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE applications (id TEXT PRIMARY KEY, serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL, detail BLOB NOT NULL);
        PRAGMA user_version=9;
        COMMIT;
      `)
      if (version < 10) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE profiles_v10 (id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, serverIds TEXT NOT NULL, mode TEXT NOT NULL, expiresAt INTEGER, revokedAt INTEGER, createdAt INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'mcp', CHECK(expiresAt IS NOT NULL OR (source='mcp' AND mode IN ('policy','confirm-each'))));
        INSERT INTO profiles_v10 SELECT id,name,tokenHash,serverIds,mode,expiresAt,revokedAt,createdAt,source FROM profiles;
        DROP TABLE profiles;
        ALTER TABLE profiles_v10 RENAME TO profiles;
        PRAGMA user_version=10;
        COMMIT;
      `)
      if (version < 11) this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE profiles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE profiles ADD COLUMN tokenSecret BLOB;
        PRAGMA user_version=11;
        COMMIT;
      `)
      if (version < 12) {
        if (!this.db.prepare('PRAGMA table_info(servers)').all().some(c => c.name === 'elevation')) this.db.exec(`ALTER TABLE servers ADD COLUMN elevation TEXT NOT NULL DEFAULT '{"type":"none"}'`)
        this.db.exec('PRAGMA user_version=12')
      }
      if (version < 13) this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE profiles ADD COLUMN deletedAt INTEGER;
        PRAGMA user_version=13;
        COMMIT;
      `)
      if (path !== ':memory:' && process.platform !== 'win32') chmodSync(path, 0o600)
    } catch (error) { throw error instanceof AppError ? error : new AppError('STORAGE_FAILED') }
  }
  getCheck(): Uint8Array | undefined {
    return (this.db.prepare('SELECT value FROM metadata WHERE key=?').get('vault-check') as { value: Uint8Array } | undefined)?.value
  }
  setCheck(value: Buffer): void { this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('vault-check', value) }
  listCredentials(): CredentialSummary[] {
    return this.db.prepare('SELECT id,name,kind,createdAt,revision FROM credentials ORDER BY createdAt,id').all() as unknown as CredentialSummary[]
  }
  getCredential(id: string): (CredentialSummary & { secret: Uint8Array }) | undefined {
    return this.db.prepare('SELECT * FROM credentials WHERE id=?').get(id) as unknown as (CredentialSummary & { secret: Uint8Array }) | undefined
  }
  private server(row: unknown): ServerRecord {
    try {
      const data = row as Omit<ServerRecord, 'route' | 'elevation'> & { route: string; elevation: string }
      return { ...data, route: routeSchema.parse(JSON.parse(data.route)), elevation: elevationSchema.parse(JSON.parse(data.elevation)) }
    } catch { throw new AppError('STORAGE_FAILED') }
  }
  listServers(): ServerRecord[] { return this.db.prepare('SELECT * FROM servers ORDER BY createdAt,id').all().map((row) => this.server(row)) }
  getServer(id: string): ServerRecord | undefined { const row = this.db.prepare('SELECT * FROM servers WHERE id=?').get(id); return row ? this.server(row) : undefined }
  getHost(host: string, port: number): { key: Uint8Array; fingerprint: string } | undefined {
    return this.db.prepare('SELECT key,fingerprint FROM known_hosts WHERE host=? AND port=?').get(host, port) as { key: Uint8Array; fingerprint: string } | undefined
  }
  close(): void { this.db.close() }
}
