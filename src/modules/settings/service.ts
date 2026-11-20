export async function getSetting(db: D1Database, key: string): Promise<{ value: string; updated_at: string } | null> {
  return (await db.prepare('SELECT value, updated_at FROM app_settings WHERE key = ?').bind(key).first<{ value: string; updated_at: string }>()) ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value)
    .run();
}
