import type { MicrosoftProductDefinition } from './microsoft-products.ts';

export interface MicrosoftPreviewRecord {
  id: string;
  title: string;
  detail: string;
}

export interface MicrosoftPreviewSection {
  title: string;
  records: MicrosoftPreviewRecord[];
}

export class MicrosoftApiError extends Error {
  readonly code: 'missing_scope' | 'reconnect_required' | 'rate_limited' | 'provider_unavailable' | 'provider_error';

  constructor(code: 'missing_scope' | 'reconnect_required' | 'rate_limited' | 'provider_unavailable' | 'provider_error') {
    super(code);
    this.code = code;
  }
}

const ITEM_ID = /^[A-Za-z0-9!_.-]{1,200}$/;
const GRAPH = 'https://graph.microsoft.com/v1.0';

export async function previewMicrosoftProduct(
  product: MicrosoftProductDefinition,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<MicrosoftPreviewSection[]> {
  switch (product.id) {
    case 'outlook-mail':
      return previewMail(accessToken, fetchImpl);
    case 'outlook-calendar':
      return previewCalendar(accessToken, fetchImpl);
    case 'contacts':
      return previewContacts(accessToken, fetchImpl);
    case 'teams':
      return previewTeams(accessToken, fetchImpl);
    case 'onedrive':
      return previewDriveChildren(accessToken, fetchImpl);
    case 'sharepoint':
      return previewSites(accessToken, fetchImpl);
    case 'word':
      return previewSearch(accessToken, fetchImpl, 'docx', 'Word documents');
    case 'excel':
      return previewExcel(accessToken, fetchImpl);
    case 'powerpoint':
      return previewSearch(accessToken, fetchImpl, 'pptx', 'PowerPoint presentations');
    case 'onenote':
      return previewNotebooks(accessToken, fetchImpl);
    case 'todo':
      return previewTodo(accessToken, fetchImpl);
    case 'planner':
      return previewPlanner(accessToken, fetchImpl);
    case 'teams-meetings':
    case 'bookings':
    case 'forms':
    case 'power-bi':
    case 'dynamics':
    case 'arm':
    case 'devops':
    case 'power-platform':
      throw new MicrosoftApiError('provider_error');
    default: {
      const unknown: never = product.id;
      return unknown;
    }
  }
}

async function previewMail(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(
    `${GRAPH}/me/messages?$top=5&$select=id,subject,from,receivedDateTime`,
    token,
    fetchImpl,
  );
  const records = values(body).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    const from = record(record(row?.from)?.emailAddress);
    return [{
      id,
      title: text(row?.subject) || 'Message',
      detail: [text(from?.address), text(row?.receivedDateTime)].filter(Boolean).join(' · '),
    }];
  });
  return [{ title: 'Messages', records }];
}

async function previewCalendar(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(
    `${GRAPH}/me/events?$top=5&$select=id,subject,start,organizer&$orderby=start/dateTime`,
    token,
    fetchImpl,
  );
  const records = values(body).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    const organizer = record(record(row?.organizer)?.emailAddress);
    return [{
      id,
      title: text(row?.subject) || 'Event',
      detail: [text(record(row?.start)?.dateTime), text(organizer?.address)].filter(Boolean).join(' · '),
    }];
  });
  return [{ title: 'Events', records }];
}

async function previewContacts(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(
    `${GRAPH}/me/contacts?$top=5&$select=id,displayName,emailAddresses`,
    token,
    fetchImpl,
  );
  const records = values(body).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    const email = record(arrayOf(row?.emailAddresses)[0]);
    return [{ id, title: text(row?.displayName) || 'Contact', detail: text(email?.address) }];
  });
  return [{ title: 'Contacts', records }];
}

async function previewTeams(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(`${GRAPH}/me/joinedTeams`, token, fetchImpl);
  const records = values(body).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    return [{ id, title: text(row?.displayName) || 'Team', detail: text(row?.description) }];
  });
  return [{ title: 'Teams', records }];
}

async function previewDriveChildren(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(
    `${GRAPH}/me/drive/root/children?$top=5&$select=id,name,folder,lastModifiedDateTime`,
    token,
    fetchImpl,
  );
  return [{ title: 'Files', records: driveRecords(body) }];
}

async function previewSites(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(`${GRAPH}/me/followedSites?$top=5`, token, fetchImpl);
  const records = values(body).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    return [{ id, title: text(row?.displayName) || 'Site', detail: text(row?.name) }];
  });
  return [{ title: 'Followed sites', records }];
}

async function previewSearch(
  token: string,
  fetchImpl: typeof fetch,
  query: string,
  title: string,
): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(
    `${GRAPH}/me/drive/root/search(q='${query}')?$top=5&$select=id,name,lastModifiedDateTime`,
    token,
    fetchImpl,
  );
  return [{ title, records: driveRecords(body) }];
}

async function previewExcel(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const found = await graphGet(
    `${GRAPH}/me/drive/root/search(q='xlsx')?$top=1&$select=id,name`,
    token,
    fetchImpl,
  );
  const file = record(values(found)[0]);
  const id = text(file?.id);
  if (!id || !ITEM_ID.test(id)) return [{ title: 'Workbook', records: [] }];
  const sheets = await graphGet(
    `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/workbook/worksheets?$top=1&$select=name`,
    token,
    fetchImpl,
  );
  const sheetName = text(record(values(sheets)[0])?.name);
  if (!sheetName || /['()]/.test(sheetName)) {
    return [{ title: 'Workbook', records: [{ id, title: text(file?.name) || 'Workbook', detail: '' }] }];
  }
  const range = await graphGet(
    `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/workbook/worksheets('${encodeURIComponent(sheetName)}')/range(address='A1:E5')?$select=values`,
    token,
    fetchImpl,
  );
  const valuesGrid = arrayOf(record(range)?.values);
  const preview = valuesGrid
    .slice(0, 5)
    .map((row) => arrayOf(row).slice(0, 5).map((cell) => text(cell) || (typeof cell === 'number' ? String(cell) : '')).filter(Boolean).join(' | '))
    .filter(Boolean)
    .join(' · ');
  return [{
    title: 'Workbook',
    records: [{ id, title: text(file?.name) || 'Workbook', detail: preview }],
  }];
}

async function previewNotebooks(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(`${GRAPH}/me/onenote/notebooks?$top=5&$select=id,displayName`, token, fetchImpl);
  const records = values(body).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    return [{ id, title: text(row?.displayName) || 'Notebook', detail: '' }];
  });
  return [{ title: 'Notebooks', records }];
}

async function previewTodo(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const lists = await graphGet(`${GRAPH}/me/todo/lists?$top=5&$select=id,displayName`, token, fetchImpl);
  const records: MicrosoftPreviewRecord[] = [];
  for (const item of values(lists).slice(0, 5)) {
    const row = record(item);
    const id = text(row?.id);
    if (!id || !ITEM_ID.test(id)) continue;
    records.push({ id, title: text(row?.displayName) || 'List', detail: '' });
  }
  const first = records[0];
  if (!first) return [{ title: 'To Do', records }];
  const tasks = await graphGet(
    `${GRAPH}/me/todo/lists/${encodeURIComponent(first.id)}/tasks?$top=5&$select=id,title,status`,
    token,
    fetchImpl,
  );
  const taskRecords = values(tasks).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    return [{ id, title: text(row?.title) || 'Task', detail: text(row?.status) }];
  });
  return [{ title: 'Lists', records }, { title: 'Tasks', records: taskRecords }];
}

async function previewPlanner(token: string, fetchImpl: typeof fetch): Promise<MicrosoftPreviewSection[]> {
  const body = await graphGet(`${GRAPH}/me/planner/tasks`, token, fetchImpl);
  const records = values(body).slice(0, 5).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    return [{ id, title: text(row?.title) || 'Task', detail: text(row?.percentComplete) }];
  });
  return [{ title: 'Assigned tasks', records }];
}

function driveRecords(body: unknown): MicrosoftPreviewRecord[] {
  return values(body).flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    if (!id) return [];
    return [{
      id,
      title: text(row?.name) || 'File',
      detail: row?.folder ? 'Folder' : text(row?.lastModifiedDateTime),
    }];
  });
}

async function graphGet(url: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
  let attempt = 0;
  while (attempt < 2) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if ((response.status === 429 || response.status === 503) && attempt === 0) {
        attempt += 1;
        await delay(200);
        continue;
      }
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      throw mappedError(response.status, body);
    } catch (error) {
      if (error instanceof MicrosoftApiError) throw error;
      if (attempt === 0) {
        attempt += 1;
        continue;
      }
      throw new MicrosoftApiError('provider_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
  throw new MicrosoftApiError('provider_unavailable');
}

function mappedError(status: number, body: unknown): MicrosoftApiError {
  const code = text(record(record(body)?.error)?.code);
  if (status === 401 || code === 'InvalidAuthenticationToken') return new MicrosoftApiError('reconnect_required');
  if (status === 403 || code === 'ErrorAccessDenied' || code === 'Authorization_RequestDenied') {
    return new MicrosoftApiError('missing_scope');
  }
  if (status === 429) return new MicrosoftApiError('rate_limited');
  if (status === 503) return new MicrosoftApiError('provider_unavailable');
  return new MicrosoftApiError('provider_error');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function values(body: unknown): unknown[] {
  return arrayOf(record(body)?.value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value : '';
}
