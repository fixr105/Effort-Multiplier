import { serviceOrigin } from './domains.ts';
import { fetchLeads, ZohoRequestError, type LeadPreview } from './zoho.ts';

export interface PreviewRecord {
  id: string;
  title: string;
  detail: string;
}

export interface PreviewSection {
  title: string;
  records: PreviewRecord[];
}

export interface OrganizationChoice {
  id: string;
  name: string;
}

export interface ProductPreview {
  sections: PreviewSection[];
  organizations: OrganizationChoice[];
}

const PAGE_SIZE = 5;

export async function previewProduct(
  product: string,
  input: { apiOrigin: string; accessToken: string; organizationId: string | null },
  fetchImpl: typeof fetch,
): Promise<ProductPreview> {
  switch (product) {
    case 'crm':
      return { sections: [{ title: 'Leads', records: (await fetchLeads(input, fetchImpl)).map(leadRecord) }], organizations: [] };
    case 'books':
      return booksPreview(input, fetchImpl);
    case 'inventory':
      return inventoryPreview(input, fetchImpl);
    case 'people':
      return peoplePreview(input, fetchImpl);
    case 'desk':
      return deskPreview(input, fetchImpl);
    default:
      throw new ZohoRequestError('provider_error');
  }
}

export async function listOrganizations(
  product: string,
  input: { apiOrigin: string; accessToken: string },
  fetchImpl: typeof fetch,
): Promise<OrganizationChoice[]> {
  switch (product) {
    case 'books':
      return readOrganizations(
        await zohoGet(new URL('/books/v3/organizations', input.apiOrigin), input.accessToken, fetchImpl),
        'organizations',
        'organization_id',
        'name',
      );
    case 'inventory':
      return readOrganizations(
        await zohoGet(new URL('/inventory/v1/organizations', input.apiOrigin), input.accessToken, fetchImpl),
        'organizations',
        'organization_id',
        'name',
      );
    case 'desk': {
      const origin = serviceOrigin(input.apiOrigin, 'desk');
      return readOrganizations(
        await zohoGet(new URL('/api/v1/organizations', origin), input.accessToken, fetchImpl),
        'data',
        'id',
        'companyName',
      );
    }
    default:
      return [];
  }
}

async function booksPreview(
  input: { apiOrigin: string; accessToken: string; organizationId: string | null },
  fetchImpl: typeof fetch,
): Promise<ProductPreview> {
  const organizations = await listOrganizations('books', input, fetchImpl);
  if (!input.organizationId) return { sections: [], organizations };
  const contactsUrl = new URL('/books/v3/contacts', input.apiOrigin);
  contactsUrl.searchParams.set('organization_id', input.organizationId);
  contactsUrl.searchParams.set('per_page', String(PAGE_SIZE));
  const invoicesUrl = new URL('/books/v3/invoices', input.apiOrigin);
  invoicesUrl.searchParams.set('organization_id', input.organizationId);
  invoicesUrl.searchParams.set('per_page', String(PAGE_SIZE));
  const [contacts, invoices] = await Promise.all([
    zohoGet(contactsUrl, input.accessToken, fetchImpl),
    zohoGet(invoicesUrl, input.accessToken, fetchImpl),
  ]);
  return {
    organizations,
    sections: [
      { title: 'Contacts', records: mapRows(contacts, 'contacts', 'contact_id', 'contact_name', 'email') },
      { title: 'Invoices', records: mapRows(invoices, 'invoices', 'invoice_id', 'invoice_number', 'status') },
    ],
  };
}

async function inventoryPreview(
  input: { apiOrigin: string; accessToken: string; organizationId: string | null },
  fetchImpl: typeof fetch,
): Promise<ProductPreview> {
  const organizations = await listOrganizations('inventory', input, fetchImpl);
  if (!input.organizationId) return { sections: [], organizations };
  const url = new URL('/inventory/v1/items', input.apiOrigin);
  url.searchParams.set('organization_id', input.organizationId);
  url.searchParams.set('per_page', String(PAGE_SIZE));
  const payload = await zohoGet(url, input.accessToken, fetchImpl);
  return {
    organizations,
    sections: [{ title: 'Items', records: mapRows(payload, 'items', 'item_id', 'name', 'sku') }],
  };
}

async function peoplePreview(
  input: { apiOrigin: string; accessToken: string },
  fetchImpl: typeof fetch,
): Promise<ProductPreview> {
  const origin = serviceOrigin(input.apiOrigin, 'people');
  const url = new URL('/people/api/forms/employee/getRecords', origin);
  url.searchParams.set('sIndex', '1');
  url.searchParams.set('limit', String(PAGE_SIZE));
  const payload = await zohoGet(url, input.accessToken, fetchImpl);
  return { organizations: [], sections: [{ title: 'Employees', records: peopleRecords(payload) }] };
}

async function deskPreview(
  input: { apiOrigin: string; accessToken: string; organizationId: string | null },
  fetchImpl: typeof fetch,
): Promise<ProductPreview> {
  const organizations = await listOrganizations('desk', input, fetchImpl);
  if (!input.organizationId) return { sections: [], organizations };
  const origin = serviceOrigin(input.apiOrigin, 'desk');
  const url = new URL('/api/v1/tickets', origin);
  url.searchParams.set('limit', String(PAGE_SIZE));
  const payload = await zohoGet(url, input.accessToken, fetchImpl, { orgId: input.organizationId });
  return {
    organizations,
    sections: [{ title: 'Tickets', records: mapRows(payload, 'data', 'id', 'subject', 'status') }],
  };
}

function leadRecord(lead: LeadPreview): PreviewRecord {
  const title = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed lead';
  return {
    id: lead.id,
    title,
    detail: [lead.email, lead.company, lead.status].filter(Boolean).join(' · '),
  };
}

async function zohoGet(
  url: URL,
  accessToken: string,
  fetchImpl: typeof fetch,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ZohoRequestError('provider_unavailable');
  }
  if (response.status === 204) return null;
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }
  if (response.status === 429) throw new ZohoRequestError('rate_limited', codeOf(payload));
  if (!response.ok) {
    const code = codeOf(payload);
    if (code === 'INVALID_TOKEN' || code === 'AUTHENTICATION_FAILURE') {
      throw new ZohoRequestError('invalid_token', code);
    }
    if (code === 'OAUTH_SCOPE_MISMATCH' || code === 'INVALID_OAUTHSCOPE') {
      throw new ZohoRequestError('missing_scope', code);
    }
    throw new ZohoRequestError('provider_error', code);
  }
  return payload;
}

function readOrganizations(
  payload: unknown,
  listKey: string,
  idKey: string,
  nameKey: string,
): OrganizationChoice[] {
  const list = arrayField(payload, listKey);
  const organizations: OrganizationChoice[] = [];
  for (const item of list) {
    const record = asRecord(item);
    const id = text(record, idKey);
    if (!id) continue;
    organizations.push({ id, name: text(record, nameKey) ?? id });
    if (organizations.length === 20) break;
  }
  return organizations;
}

function mapRows(
  payload: unknown,
  listKey: string,
  idKey: string,
  titleKey: string,
  detailKey: string,
): PreviewRecord[] {
  const records: PreviewRecord[] = [];
  for (const item of arrayField(payload, listKey)) {
    const record = asRecord(item);
    const id = text(record, idKey);
    if (!id) continue;
    records.push({
      id,
      title: text(record, titleKey) ?? 'Untitled',
      detail: text(record, detailKey) ?? '',
    });
    if (records.length === PAGE_SIZE) break;
  }
  return records;
}

function peopleRecords(payload: unknown): PreviewRecord[] {
  const response = asRecord(payload)?.response;
  const result = asRecord(response)?.result;
  const rows = Array.isArray(result) ? result : [];
  const records: PreviewRecord[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const first = Object.values(record)[0];
    const fields = Array.isArray(first) ? asRecord(first[0]) : asRecord(first);
    const id = text(fields, 'Zoho_ID') ?? text(fields, 'recordId') ?? text(record, 'recordId');
    if (!id) continue;
    const title = [text(fields, 'FirstName'), text(fields, 'LastName')].filter(Boolean).join(' ')
      || text(fields, 'EmployeeID')
      || 'Employee';
    records.push({ id, title, detail: text(fields, 'EmailID') ?? '' });
    if (records.length === PAGE_SIZE) break;
  }
  return records;
}

function arrayField(payload: unknown, key: string): unknown[] {
  const value = asRecord(payload)?.[key];
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function codeOf(payload: unknown): string | null {
  const code = asRecord(payload)?.code ?? asRecord(payload)?.error;
  if (typeof code !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(code)) return null;
  return code;
}
