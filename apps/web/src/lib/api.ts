const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export type Node = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  kind: 'file' | 'folder';
  name: string;
  normalized_name: string;
  full_path_cache: string | null;
  depth: number;
  blob_id: string | null;
  size_bytes: string | null;
  mime_type: string | null;
  created_at: string;
  updated_at: string;
};

export type SearchResult = {
  id: string;
  kind: string;
  name: string;
  full_path_cache: string | null;
  size_bytes: string | null;
  mime_type: string | null;
  updated_at: string;
};

export async function fetchNodes(
  workspaceId: string,
  parentId: string | null
): Promise<Node[]> {
  const url = new URL(`${API_BASE}/workspaces/${workspaceId}/nodes`);
  if (parentId !== null) url.searchParams.set('parentId', parentId);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json();
}

export async function fetchSearch(
  workspaceId: string,
  q: string
): Promise<SearchResult[]> {
  if (!q.trim()) return [];
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('workspaceId', workspaceId);
  url.searchParams.set('q', q);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json();
}

export async function createFolder(
  workspaceId: string,
  parentId: string | null,
  name: string
): Promise<Node> {
  const res = await fetch(`${API_BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, parentId, name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json();
}

export async function uploadFile(
  workspaceId: string,
  parentId: string | null,
  file: File
): Promise<{ node: Node }> {
  const form = new FormData();
  form.set('workspaceId', workspaceId);
  if (parentId) form.set('parentId', parentId);
  form.set('file', file);
  const res = await fetch(`${API_BASE}/files/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json();
}

export async function renameNode(
  nodeId: string,
  workspaceId: string,
  newName: string
): Promise<Node> {
  const res = await fetch(`${API_BASE}/nodes/${nodeId}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, newName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json();
}

export async function moveNode(
  nodeId: string,
  workspaceId: string,
  newParentId: string | null
): Promise<Node> {
  const res = await fetch(`${API_BASE}/nodes/${nodeId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, newParentId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json();
}

export function getDownloadUrl(nodeId: string, workspaceId: string): string {
  return `${API_BASE}/nodes/${nodeId}/download?workspaceId=${encodeURIComponent(workspaceId)}`;
}
