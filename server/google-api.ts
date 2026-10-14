import type { GoogleProductDefinition } from './google-products.ts';

export interface GooglePreviewRecord {
  id: string;
  title: string;
  detail: string;
}

export interface GooglePreviewSection {
  title: string;
  records: GooglePreviewRecord[];
}

export class GoogleApiError extends Error {
  readonly code: 'missing_scope' | 'reconnect_required' | 'rate_limited' | 'provider_unavailable' | 'provider_error';

  constructor(code: 'missing_scope' | 'reconnect_required' | 'rate_limited' | 'provider_unavailable' | 'provider_error') {
    super(code);
    this.code = code;
  }
}

const PAGE_TOKEN = /^[^&#?\s]{1,1024}$/;
const RESOURCE_ID = /^[A-Za-z0-9_.:@-]{1,200}$/;

export async function previewGoogleProduct(
  product: GoogleProductDefinition,
  accessToken: string,
  fetchImpl: typeof fetch,
  now: number,
): Promise<GooglePreviewSection[]> {
  switch (product.id) {
    case 'gmail':
      return previewGmail(accessToken, fetchImpl);
    case 'calendar':
      return previewCalendar(accessToken, fetchImpl, now);
    case 'drive':
      return previewDrive(accessToken, fetchImpl);
    case 'docs':
      return previewWorkspaceFile(accessToken, fetchImpl, 'application/vnd.google-apps.document', 'Documents', (id) =>
        readDocument(accessToken, fetchImpl, id),
      );
    case 'sheets':
      return previewWorkspaceFile(accessToken, fetchImpl, 'application/vnd.google-apps.spreadsheet', 'Spreadsheets', (id) =>
        readSheet(accessToken, fetchImpl, id),
      );
    case 'slides':
      return previewWorkspaceFile(accessToken, fetchImpl, 'application/vnd.google-apps.presentation', 'Presentations', (id) =>
        readSlides(accessToken, fetchImpl, id),
      );
    case 'forms':
      return previewWorkspaceFile(accessToken, fetchImpl, 'application/vnd.google-apps.form', 'Forms', (id) =>
        readForm(accessToken, fetchImpl, id),
      );
    case 'tasks':
      return previewTasks(accessToken, fetchImpl);
    case 'people':
      return previewPeople(accessToken, fetchImpl);
    case 'meet':
      return previewMeet(accessToken, fetchImpl);
    case 'analytics':
      return previewAnalytics(accessToken, fetchImpl);
    case 'search-console':
      return previewSearchConsole(accessToken, fetchImpl);
    case 'apps-script':
      return previewScripts(accessToken, fetchImpl);
    case 'chat':
    case 'admin':
    case 'workspace-events':
      throw new GoogleApiError('provider_error');
    default: {
      const unknown: never = product.id;
      return unknown;
    }
  }
}

async function previewGmail(token: string, fetchImpl: typeof fetch): Promise<GooglePreviewSection[]> {
  const listed = await googleGet(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5',
    token,
    fetchImpl,
  );
  const ids = arrayOf(record(listed)?.messages).flatMap((item) => {
    const id = text(record(item)?.id);
    return id && RESOURCE_ID.test(id) ? [id] : [];
  });
  const records: GooglePreviewRecord[] = [];
  for (const id of ids) {
    const message = await googleGet(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      token,
      fetchImpl,
    );
    const headers = arrayOf(record(record(message)?.payload)?.headers);
    records.push({
      id,
      title: headerValue(headers, 'Subject') || 'Message',
      detail: [headerValue(headers, 'From'), headerValue(headers, 'Date')].filter(Boolean).join(' · '),
    });
  }
  return [{ title: 'Messages', records }];
}

async function previewCalendar(token: string, fetchImpl: typeof fetch, now: number): Promise<GooglePreviewSection[]> {
  const calendars = await googleGet(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=5',
    token,
    fetchImpl,
  );
  const items = arrayOf(record(calendars)?.items);
  const records: GooglePreviewRecord[] = [];
  const first = record(items[0]);
  const calendarId = text(first?.id);
  for (const item of items) {
    const row = record(item);
    const id = text(row?.id);
    if (!id) continue;
    records.push({ id, title: text(row?.summary) || 'Calendar', detail: text(row?.accessRole) || '' });
  }
  const sections: GooglePreviewSection[] = [{ title: 'Calendars', records }];
  if (calendarId && RESOURCE_ID.test(calendarId)) {
    const start = new Date(now).toISOString();
    const events = await googleGet(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=5&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(start)}`,
      token,
      fetchImpl,
    );
    sections.push({
      title: 'Upcoming events',
      records: arrayOf(record(events)?.items).flatMap((item) => {
        const row = record(item);
        const id = text(row?.id);
        if (!id) return [];
        const startValue = text(record(row?.start)?.dateTime) || text(record(row?.start)?.date);
        return [{ id, title: text(row?.summary) || 'Event', detail: startValue || '' }];
      }),
    });
  }
  return sections;
}

async function previewDrive(token: string, fetchImpl: typeof fetch): Promise<GooglePreviewSection[]> {
  const files = await listFiles(token, fetchImpl, 'trashed=false');
  return [{ title: 'Files', records: files }];
}

async function previewWorkspaceFile(
  token: string,
  fetchImpl: typeof fetch,
  mimeType: string,
  title: string,
  read: (id: string) => Promise<GooglePreviewRecord | null>,
): Promise<GooglePreviewSection[]> {
  const files = await listFiles(token, fetchImpl, `mimeType='${mimeType}' and trashed=false`);
  const first = files[0];
  if (!first || !RESOURCE_ID.test(first.id)) return [{ title, records: files }];
  const detailed = await read(first.id);
  return [{ title, records: detailed ? [detailed, ...files.filter((file) => file.id !== first.id)] : files }];
}

async function readDocument(token: string, fetchImpl: typeof fetch, id: string): Promise<GooglePreviewRecord | null> {
  const body = await googleGet(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?fields=documentId,title`,
    token,
    fetchImpl,
  );
  const row = record(body);
  const documentId = text(row?.documentId);
  if (!documentId) return null;
  return { id: documentId, title: text(row?.title) || 'Document', detail: 'Document' };
}

async function readSheet(token: string, fetchImpl: typeof fetch, id: string): Promise<GooglePreviewRecord | null> {
  const body = await googleGet(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/A1:E5`,
    token,
    fetchImpl,
  );
  const values = arrayOf(record(body)?.values);
  const firstRow = arrayOf(values[0]).map((cell) => (typeof cell === 'string' ? cell : '')).filter(Boolean);
  return { id, title: firstRow[0] || 'Spreadsheet', detail: `${values.length} row${values.length === 1 ? '' : 's'} read` };
}

async function readSlides(token: string, fetchImpl: typeof fetch, id: string): Promise<GooglePreviewRecord | null> {
  const body = await googleGet(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}?fields=presentationId,title`,
    token,
    fetchImpl,
  );
  const row = record(body);
  return { id: text(row?.presentationId) || id, title: text(row?.title) || 'Presentation', detail: 'Presentation' };
}

async function readForm(token: string, fetchImpl: typeof fetch, id: string): Promise<GooglePreviewRecord | null> {
  const form = await googleGet(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(id)}`, token, fetchImpl);
  const responses = await googleGet(
    `https://forms.googleapis.com/v1/forms/${encodeURIComponent(id)}/responses?pageSize=5`,
    token,
    fetchImpl,
  );
  const title = text(record(record(form)?.info)?.title) || 'Form';
  const count = arrayOf(record(responses)?.responses).length;
  return { id, title, detail: `${count} response${count === 1 ? '' : 's'}` };
}

async function previewTasks(token: string, fetchImpl: typeof fetch): Promise<GooglePreviewSection[]> {
  const lists = await googleGet('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=5', token, fetchImpl);
  const items = arrayOf(record(lists)?.items);
  const records = items.flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    return id ? [{ id, title: text(row?.title) || 'Task list', detail: 'Task list' }] : [];
  });
  const first = text(record(items[0])?.id);
  const sections: GooglePreviewSection[] = [{ title: 'Task lists', records }];
  if (first && RESOURCE_ID.test(first)) {
    const tasks = await googleGet(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(first)}/tasks?maxResults=5&showCompleted=false`,
      token,
      fetchImpl,
    );
    sections.push({
      title: 'Tasks',
      records: arrayOf(record(tasks)?.items).flatMap((item) => {
        const row = record(item);
        const id = text(row?.id);
        return id ? [{ id, title: text(row?.title) || 'Task', detail: text(row?.status) || '' }] : [];
      }),
    });
  }
  return sections;
}

async function previewPeople(token: string, fetchImpl: typeof fetch): Promise<GooglePreviewSection[]> {
  const body = await googleGet(
    'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=5',
    token,
    fetchImpl,
  );
  return [{
    title: 'Contacts',
    records: arrayOf(record(body)?.connections).flatMap((item) => {
      const row = record(item);
      const id = text(row?.resourceName);
      if (!id) return [];
      const name = text(record(arrayOf(row?.names)[0])?.displayName) || 'Contact';
      const email = text(record(arrayOf(row?.emailAddresses)[0])?.value);
      return [{ id, title: name, detail: email || '' }];
    }),
  }];
}

async function previewMeet(token: string, fetchImpl: typeof fetch): Promise<GooglePreviewSection[]> {
  const body = await googleGet('https://meet.googleapis.com/v2/conferenceRecords?pageSize=5', token, fetchImpl);
  return [{
    title: 'Conference records',
    records: arrayOf(record(body)?.conferenceRecords).flatMap((item) => {
      const row = record(item);
      const name = text(row?.name);
      if (!name) return [];
      return [{ id: name, title: name, detail: text(row?.startTime) || '' }];
    }),
  }];
}

async function previewAnalytics(token: string, fetchImpl: typeof fetch): Promise<GooglePreviewSection[]> {
  const body = await googleGet('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=5', token, fetchImpl);
  return [{
    title: 'Analytics accounts',
    records: arrayOf(record(body)?.accountSummaries).flatMap((item) => {
      const row = record(item);
      const name = text(row?.name);
      if (!name) return [];
      return [{ id: name, title: text(row?.displayName) || 'Analytics account', detail: name }];
    }),
  }];
}

async function previewSearchConsole(token: string, fetchImpl: typeof fetch): Promise<GooglePreviewSection[]> {
  const body = await googleGet('https://www.googleapis.com/webmasters/v3/sites', token, fetchImpl);
  return [{
    title: 'Sites',
    records: arrayOf(record(body)?.siteEntry).flatMap((item) => {
      const row = record(item);
      const site = text(row?.siteUrl);
      if (!site) return [];
      return [{ id: site, title: site, detail: text(row?.permissionLevel) || '' }];
    }),
  }];
}

async function previewScripts(token: string, fetchImpl: typeof fetch): Promise<GooglePreviewSection[]> {
  const body = await googleGet('https://script.googleapis.com/v1/projects?pageSize=5', token, fetchImpl);
  return [{
    title: 'Script projects',
    records: arrayOf(record(body)?.projects).flatMap((item) => {
      const row = record(item);
      const id = text(row?.scriptId);
      if (!id) return [];
      return [{ id, title: text(row?.title) || 'Script', detail: text(row?.updateTime) || '' }];
    }),
  }];
}

async function listFiles(token: string, fetchImpl: typeof fetch, query: string): Promise<GooglePreviewRecord[]> {
  const collected: GooglePreviewRecord[] = [];
  let pageToken = '';
  for (let page = 0; page < 2 && collected.length < 5; page += 1) {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('pageSize', '5');
    url.searchParams.set('fields', 'files(id,name,mimeType),nextPageToken');
    url.searchParams.set('q', query);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await googleGet(url.toString(), token, fetchImpl);
    for (const item of arrayOf(record(body)?.files)) {
      const row = record(item);
      const id = text(row?.id);
      if (!id || collected.length >= 5) continue;
      collected.push({ id, title: text(row?.name) || 'File', detail: text(row?.mimeType) || '' });
    }
    const next = text(record(body)?.nextPageToken);
    if (!next || !PAGE_TOKEN.test(next)) break;
    pageToken = next;
  }
  return collected;
}

async function googleGet(url: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
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
      if (error instanceof GoogleApiError) throw error;
      if (attempt === 0) {
        attempt += 1;
        continue;
      }
      throw new GoogleApiError('provider_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
  throw new GoogleApiError('provider_unavailable');
}

function mappedError(status: number, body: unknown): GoogleApiError {
  const reason = text(record(record(body)?.error)?.status)
    || text(record(arrayOf(record(record(body)?.error)?.errors)[0])?.reason)
    || '';
  if (status === 401 || reason === 'authError' || reason === 'invalid_grant') {
    return new GoogleApiError('reconnect_required');
  }
  if (status === 403 || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' || reason === 'insufficientPermissions') {
    return new GoogleApiError('missing_scope');
  }
  if (status === 429) return new GoogleApiError('rate_limited');
  if (status === 503) return new GoogleApiError('provider_unavailable');
  return new GoogleApiError('provider_error');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function headerValue(headers: unknown[], name: string): string {
  const match = headers.find((header) => text(record(header)?.name).toLowerCase() === name.toLowerCase());
  return text(record(match)?.value);
}
