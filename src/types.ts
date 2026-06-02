export interface Entry {
  id: number;
  sync_id: string;
  title: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  conflict: boolean;
  conflict_data?: string;
}

export interface NewEntry {
  title: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
}

export interface SyncStatus {
  is_configured: boolean;
  is_authenticated: boolean;
  user_email?: string;
  supabase_url_preview?: string;
  last_sync_timestamp: number;
}

export interface DownloadResult {
  added: number;
  conflicts: number;
}
