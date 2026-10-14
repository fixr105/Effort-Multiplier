import type { CategoryId } from '../types.ts';

/**
 * Server and browser share this registry.
 * Scopes are requested only for products whose APIs this app actually calls.
 * Planned products stay visible and cannot start OAuth.
 */
export type ZohoAvailability = 'available' | 'planned' | 'setup_required';

export interface ZohoProductDefinition {
  id: string;
  cardId: string;
  name: string;
  description: string;
  category: CategoryId;
  initials: string;
  icon: string;
  availability: ZohoAvailability;
  scopes: readonly string[];
  docsUrl: string;
  note: string;
}

const PLANNED_DOCS = 'https://www.zoho.com/developer/';

function planned(
  id: string,
  name: string,
  description: string,
  category: CategoryId,
  initials: string,
  icon: string,
  note = 'Coming soon. This connector is not built yet, so Connect stays off.',
): ZohoProductDefinition {
  return {
    id,
    cardId: `zoho-${id}`,
    name,
    description,
    category,
    initials,
    icon,
    availability: 'planned',
    scopes: [],
    docsUrl: PLANNED_DOCS,
    note,
  };
}

export const ZOHO_PRODUCTS: readonly ZohoProductDefinition[] = [
  {
    id: 'crm',
    cardId: 'zoho-crm',
    name: 'Zoho CRM',
    description: 'Manage leads, contacts and sales pipelines.',
    category: 'crm',
    initials: 'ZC',
    icon: 'Users',
    availability: 'available',
    scopes: ['ZohoCRM.modules.leads.READ'],
    docsUrl: 'https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html',
    note: 'Read-only lead preview.',
  },
  planned('bigin', 'Zoho Bigin', 'Pipeline for small sales teams.', 'crm', 'BG', 'Target'),
  planned('salesiq', 'Zoho SalesIQ', 'Website visitor and chat information.', 'support', 'SQ', 'MessageSquare'),
  {
    id: 'books',
    cardId: 'zoho-books',
    name: 'Zoho Books',
    description: 'Invoices, expenses and receivables.',
    category: 'accounting',
    initials: 'ZB',
    icon: 'BookOpen',
    availability: 'available',
    scopes: ['ZohoBooks.contacts.READ', 'ZohoBooks.invoices.READ', 'ZohoBooks.settings.READ'],
    docsUrl: 'https://www.zoho.com/books/api/v3/oauth/',
    note: 'Read-only contacts and invoices. Choose an organization when Zoho returns more than one.',
  },
  {
    id: 'inventory',
    cardId: 'zoho-inventory',
    name: 'Zoho Inventory',
    description: 'Items and stock records.',
    category: 'ecommerce',
    initials: 'ZI',
    icon: 'Package',
    availability: 'available',
    scopes: ['ZohoInventory.items.READ', 'ZohoInventory.settings.READ'],
    docsUrl: 'https://www.zoho.com/inventory/api/v1/oauth/',
    note: 'Read-only items. Choose an organization when Zoho returns more than one.',
  },
  planned('invoice', 'Zoho Invoice', 'Customer invoices and estimates.', 'accounting', 'IV', 'FileText'),
  planned('expense', 'Zoho Expense', 'Expense reports and receipts.', 'accounting', 'EX', 'Calculator'),
  planned('billing', 'Zoho Billing', 'Subscriptions and recurring invoices.', 'accounting', 'BL', 'CreditCard'),
  planned('checkout', 'Zoho Checkout', 'Payment pages and checkout records.', 'payments', 'CH', 'CreditCard'),
  {
    id: 'people',
    cardId: 'zoho-people',
    name: 'Zoho People',
    description: 'Employee and HR information.',
    category: 'hr',
    initials: 'ZP',
    icon: 'Users',
    availability: 'available',
    scopes: ['ZOHOPEOPLE.forms.READ'],
    docsUrl: 'https://www.zoho.com/people/api/v3/scopes.html',
    note: 'Read-only employee form records.',
  },
  planned('recruit', 'Zoho Recruit', 'Candidates and hiring pipelines.', 'hr', 'ZR', 'Briefcase'),
  {
    id: 'desk',
    cardId: 'zoho-desk',
    name: 'Zoho Desk',
    description: 'Support tickets and customer queries.',
    category: 'support',
    initials: 'ZD',
    icon: 'Ticket',
    availability: 'available',
    scopes: ['Desk.tickets.READ', 'Desk.basic.READ'],
    docsUrl: 'https://desk.zoho.com/DeskAPIDocument',
    note: 'Read-only tickets. Choose a Desk organization when Zoho returns more than one.',
  },
  planned('assist', 'Zoho Assist', 'Remote support session information.', 'support', 'ZA', 'Headset'),
  planned(
    'mail',
    'Zoho Mail',
    'Business mailboxes.',
    'email',
    'ZM',
    'Mail',
    'Coming soon. A read-only mailbox preview is not built, so this app does not request mail access.',
  ),
  {
    id: 'calendar',
    cardId: 'zoho-calendar',
    name: 'Zoho Calendar',
    description: 'Events and schedules.',
    category: 'calendar',
    initials: 'CL',
    icon: 'Calendar',
    availability: 'available',
    scopes: ['ZohoCalendar.calendar.READ', 'ZohoCalendar.event.READ'],
    docsUrl: 'https://www.zoho.com/calendar/help/api/oauth2-user-guide.html',
    note: 'Read-only events from your own calendars for the next seven days.',
  },
  planned(
    'workdrive',
    'Zoho WorkDrive',
    'Team files and folders.',
    'files',
    'WD',
    'Folder',
    'Coming soon. Team folders can be listed with WorkDrive.team.READ and WorkDrive.teamfolders.READ, and that connector is not built yet.',
  ),
  planned('writer', 'Zoho Writer', 'Documents.', 'files', 'WR', 'FileText'),
  planned('sheet', 'Zoho Sheet', 'Spreadsheets.', 'files', 'SH', 'FileText'),
  planned('cliq', 'Zoho Cliq', 'Team conversations.', 'email', 'CQ', 'MessageCircle'),
  planned('connect', 'Zoho Connect', 'Internal company network.', 'email', 'CN', 'MessageSquare'),
  planned('meeting', 'Zoho Meeting', 'Meetings and webinars.', 'calendar', 'MT', 'CalendarDays'),
  {
    id: 'projects',
    cardId: 'zoho-projects',
    name: 'Zoho Projects',
    description: 'Projects and tasks.',
    category: 'project',
    initials: 'PJ',
    icon: 'CheckSquare',
    availability: 'available',
    scopes: ['ZohoProjects.portals.READ', 'ZohoProjects.projects.READ', 'ZohoProjects.tasks.READ'],
    docsUrl: 'https://www.zoho.com/projects/help/rest-api/projects-api.html',
    note: 'Read-only projects and tasks. Choose a portal when Zoho returns more than one.',
  },
  planned('sprints', 'Zoho Sprints', 'Agile sprints and work items.', 'project', 'SP', 'ListTodo'),
  {
    id: 'sign',
    cardId: 'zoho-sign',
    name: 'Zoho Sign',
    description: 'Signature requests.',
    category: 'files',
    initials: 'SG',
    icon: 'PenTool',
    availability: 'available',
    scopes: ['ZohoSign.documents.READ'],
    docsUrl: 'https://www.zoho.com/sign/api/document-managment/get-document-list.html',
    note: 'Read-only signature requests.',
  },
  planned('campaigns', 'Zoho Campaigns', 'Email campaigns.', 'marketing', 'CP', 'Send'),
  planned(
    'marketing-automation',
    'Zoho Marketing Automation',
    'Journeys and campaign automation.',
    'marketing',
    'MA',
    'Megaphone',
  ),
  planned('commerce', 'Zoho Commerce', 'Store orders and catalog.', 'ecommerce', 'CO', 'ShoppingBag'),
  planned('social', 'Zoho Social', 'Social media accounts.', 'marketing', 'SO', 'MessageCircle'),
  planned('analytics', 'Zoho Analytics', 'Reports and dashboards.', 'accounting', 'AN', 'BarChart3'),
  {
    id: 'creator',
    cardId: 'zoho-creator',
    name: 'Zoho Creator',
    description: 'Custom apps and forms.',
    category: 'project',
    initials: 'CR',
    icon: 'SquareDot',
    availability: 'setup_required',
    scopes: [],
    docsUrl: 'https://www.zoho.com/creator/help/api/v2/',
    note: 'Setup required. Creator records belong to a specific app, and this connector does not ask for the app owner or link name yet.',
  },
  planned('forms', 'Zoho Forms', 'Form submissions.', 'files', 'FM', 'FileText'),
  planned('flow', 'Zoho Flow', 'Integration workflows.', 'project', 'FL', 'TrendingUp'),
  planned('directory', 'Zoho Directory', 'Organization users and apps.', 'hr', 'DR', 'BadgeCheck'),
];

const BY_ID = new Map(ZOHO_PRODUCTS.map((product) => [product.id, product]));
const BY_CARD = new Map(ZOHO_PRODUCTS.map((product) => [product.cardId, product]));

export function zohoProductById(id: string): ZohoProductDefinition | null {
  return BY_ID.get(id) ?? null;
}

export function zohoProductByCardId(cardId: string): ZohoProductDefinition | null {
  return BY_CARD.get(cardId) ?? null;
}

export function isZohoCardId(cardId: string): boolean {
  return BY_CARD.has(cardId);
}
