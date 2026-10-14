import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ZOHO_PRODUCTS } from '../src/data/zohoProducts.ts';
import { previewProduct } from './preview.ts';

describe('Zoho product previews', () => {
  it('keeps the 33-product catalog and only enables implemented connectors', () => {
    assert.equal(ZOHO_PRODUCTS.length, 33);
    const available = ZOHO_PRODUCTS.filter((product) => product.availability === 'available').map((product) => product.id);
    assert.deepEqual(available, ['crm', 'books', 'inventory', 'people', 'desk', 'calendar', 'projects', 'sign']);
    assert.equal(ZOHO_PRODUCTS.find((product) => product.id === 'creator')?.availability, 'setup_required');
    assert.ok(ZOHO_PRODUCTS.filter((product) => product.availability === 'planned').every((product) => product.scopes.length === 0));
  });

  it('reads projects and tasks for one portal without inventing rows', async () => {
    const preview = await previewProduct(
      'projects',
      { apiOrigin: 'https://www.zohoapis.com', accessToken: 'token', organizationId: null },
      async (input) => {
        const url = String(input);
        if (url.endsWith('/restapi/portals/')) {
          return json({ portals: [{ id: 42, name: 'Founders' }] });
        }
        throw new Error(`unexpected ${url}`);
      },
    );
    assert.deepEqual(preview.organizations, [{ id: '42', name: 'Founders' }]);
    assert.deepEqual(preview.sections, []);

    const withPortal = await previewProduct(
      'projects',
      { apiOrigin: 'https://www.zohoapis.com', accessToken: 'token', organizationId: '42' },
      async (input) => {
        const url = String(input);
        if (url.includes('/tasks/')) {
          return json({ tasks: [{ id: 9, name: 'Write brief', status: 'open' }] });
        }
        if (url.includes('/projects/')) {
          return json({ projects: [{ id: 7, name: 'Launch', status: 'active' }] });
        }
        if (url.endsWith('/restapi/portals/')) {
          return json({ portals: [{ id: 42, name: 'Founders' }] });
        }
        throw new Error(`unexpected ${url}`);
      },
    );
    assert.equal(withPortal.sections[0]?.records[0]?.title, 'Launch');
    assert.equal(withPortal.sections[1]?.records[0]?.title, 'Write brief');
  });

  it('reads calendar events and signature requests from the official list fields', async () => {
    const calendar = await previewProduct(
      'calendar',
      { apiOrigin: 'https://www.zohoapis.eu', accessToken: 'token', organizationId: null },
      async (input) => {
        const url = String(input);
        assert.ok(url.startsWith('https://calendar.zoho.eu/'));
        if (url.includes('/events')) {
          return json({
            events: [{ uid: 'event-1', title: 'Standup', dateandtime: { start: '20261014T090000Z' } }],
          });
        }
        return json({ calendars: [{ uid: 'cal-1', name: 'Work', isdefault: true }] });
      },
    );
    assert.equal(calendar.sections[0]?.records[0]?.title, 'Standup');
    assert.equal(calendar.sections[0]?.records[0]?.detail, '20261014T090000Z');

    const sign = await previewProduct(
      'sign',
      { apiOrigin: 'https://www.zohoapis.com', accessToken: 'token', organizationId: null },
      async (input) => {
        const url = new URL(String(input));
        assert.equal(url.origin, 'https://sign.zoho.com');
        const data = JSON.parse(url.searchParams.get('data') ?? '{}') as { page_context?: { row_count?: number } };
        assert.equal(data.page_context?.row_count, 5);
        return json({
          requests: [{ request_id: 'req-1', request_name: 'Founder agreement', request_status: 'inprogress' }],
        });
      },
    );
    assert.equal(sign.sections[0]?.records[0]?.title, 'Founder agreement');
    assert.equal(sign.sections[0]?.records[0]?.detail, 'inprogress');
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
