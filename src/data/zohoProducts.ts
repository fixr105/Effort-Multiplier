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
    note: 'This product is listed, but its API is not connected yet.',
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
  planned('mail', 'Zoho Mail', 'Business mailboxes.', 'email', 'ZM', 'Mail'),
  planned('calendar', 'Zoho Calendar', 'Events and schedules.', 'calendar', 'CL', 'Calendar'),
  planned('workdrive', 'Zoho WorkDrive', 'Team files and folders.', 'files', 'WD', 'Folder'),
  planned('writer', 'Zoho Writer', 'Documents.', 'files', 'WR', 'FileText'),
  planned('sheet', 'Zoho Sheet', 'Spreadsheets.', 'files', 'SH', 'FileText'),
  planned('cliq', 'Zoho Cliq', 'Team conversations.', 'email', 'CQ', 'MessageCircle'),
  planned('connect', 'Zoho Connect', 'Internal company network.', 'email', 'CN', 'MessageSquare'),
  planned('meeting', 'Zoho Meeting', 'Meetings and webinars.', 'calendar', 'MT', 'CalendarDays'),
  planned('projects', 'Zoho Projects', 'Projects and tasks.', 'project', 'PJ', 'CheckSquare'),
  planned('sprints', 'Zoho Sprints', 'Agile sprints and work items.', 'project', 'SP', 'ListTodo'),
  planned('sign', 'Zoho Sign', 'Signature requests.', 'files', 'SG', 'PenTool'),
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
  planned('creator', 'Zoho Creator', 'Custom apps and forms.', 'project', 'CR', 'SquareDot'),
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
