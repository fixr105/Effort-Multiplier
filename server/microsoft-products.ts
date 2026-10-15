import type { CategoryId } from '../src/types.ts';

export const MICROSOFT_IDENTITY_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/User.Read',
] as const;

export type MicrosoftProductId =
  | 'outlook-mail'
  | 'outlook-calendar'
  | 'contacts'
  | 'teams'
  | 'onedrive'
  | 'sharepoint'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'onenote'
  | 'todo'
  | 'planner'
  | 'teams-meetings'
  | 'bookings'
  | 'forms'
  | 'power-bi'
  | 'dynamics'
  | 'arm'
  | 'devops'
  | 'power-platform';

export interface MicrosoftScope {
  scope: string;
  purpose: string;
}

export interface MicrosoftProductDefinition {
  id: MicrosoftProductId;
  name: string;
  description: string;
  category: CategoryId;
  initials: string;
  icon: string;
  docsUrl: string;
  scopes: readonly MicrosoftScope[];
  operation: string;
  availability: 'confirmable' | 'blocked';
  adminConsent: boolean;
  reason: string;
}

const CONFIRMABLE_REASON =
  'Shown after an administrator sets this id in MICROSOFT_CONFIRMED_PRODUCTS. That value is the trusted confirmation that the Entra app has this permission and the named Microsoft API is available. This app cannot see that configuration without administrator credentials.';

export const MICROSOFT_PRODUCTS: readonly MicrosoftProductDefinition[] = [
  {
    id: 'outlook-mail',
    name: 'Outlook Mail',
    description: 'Read subject, sender, and date for recent messages.',
    category: 'email',
    initials: 'OM',
    icon: 'Mail',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/user-list-messages',
    scopes: [{
      scope: 'https://graph.microsoft.com/Mail.ReadBasic',
      purpose: 'List messages and read subject, sender, and received time. Message bodies are not requested.',
    }],
    operation: 'List recent message metadata.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'outlook-calendar',
    name: 'Outlook Calendar',
    description: 'Read upcoming events on your calendar.',
    category: 'calendar',
    initials: 'OC',
    icon: 'Calendar',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/user-list-events',
    scopes: [{
      scope: 'https://graph.microsoft.com/Calendars.Read',
      purpose: 'List upcoming events.',
    }],
    operation: 'List upcoming events.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'contacts',
    name: 'Microsoft Contacts',
    description: 'Read names and email addresses from your contacts.',
    category: 'crm',
    initials: 'MC',
    icon: 'Users',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/user-list-contacts',
    scopes: [{
      scope: 'https://graph.microsoft.com/Contacts.Read',
      purpose: 'List contact names and email addresses.',
    }],
    operation: 'List contacts.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    description: 'List teams you have joined.',
    category: 'email',
    initials: 'MT',
    icon: 'MessageSquare',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/user-list-joinedteams',
    scopes: [{
      scope: 'https://graph.microsoft.com/Team.ReadBasic.All',
      purpose: 'List joined teams. A tenant administrator must consent to this permission.',
    }],
    operation: 'List joined teams.',
    availability: 'confirmable',
    adminConsent: true,
    reason: `${CONFIRMABLE_REASON} Team.ReadBasic.All requires tenant admin consent.`,
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    description: 'List files and folders in your OneDrive.',
    category: 'files',
    initials: 'OD',
    icon: 'Folder',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/driveitem-list-children',
    scopes: [{
      scope: 'https://graph.microsoft.com/Files.Read',
      purpose: 'List files in the signed-in user OneDrive. File contents are not downloaded.',
    }],
    operation: 'List OneDrive items.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'sharepoint',
    name: 'SharePoint',
    description: 'List SharePoint sites you follow.',
    category: 'files',
    initials: 'SP',
    icon: 'Folder',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/sites-list-followed',
    scopes: [{
      scope: 'https://graph.microsoft.com/Sites.Read.All',
      purpose: 'List followed sites. A tenant administrator must consent to this permission.',
    }],
    operation: 'List followed SharePoint sites.',
    availability: 'confirmable',
    adminConsent: true,
    reason: `${CONFIRMABLE_REASON} Sites.Read.All requires tenant admin consent.`,
  },
  {
    id: 'word',
    name: 'Word',
    description: 'Find Word documents in your OneDrive.',
    category: 'files',
    initials: 'WD',
    icon: 'FileText',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/driveitem-search',
    scopes: [{
      scope: 'https://graph.microsoft.com/Files.Read',
      purpose: 'Find Word documents. Document bodies are not downloaded.',
    }],
    operation: 'Find Word documents.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'excel',
    name: 'Excel',
    description: 'Find a workbook and read a small range.',
    category: 'files',
    initials: 'XL',
    icon: 'FileText',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/range-get',
    scopes: [{
      scope: 'https://graph.microsoft.com/Files.Read',
      purpose: 'Find a workbook and read A1:E5.',
    }],
    operation: 'Find one workbook and read A1:E5.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'powerpoint',
    name: 'PowerPoint',
    description: 'Find PowerPoint presentations in your OneDrive.',
    category: 'files',
    initials: 'PP',
    icon: 'FileText',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/driveitem-search',
    scopes: [{
      scope: 'https://graph.microsoft.com/Files.Read',
      purpose: 'Find presentations. Slide contents are not downloaded.',
    }],
    operation: 'Find PowerPoint presentations.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'onenote',
    name: 'OneNote',
    description: 'List your OneNote notebooks.',
    category: 'files',
    initials: 'ON',
    icon: 'FileText',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/onenote-list-notebooks',
    scopes: [{
      scope: 'https://graph.microsoft.com/Notes.Read',
      purpose: 'List notebooks. Page contents are not requested.',
    }],
    operation: 'List notebooks.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'todo',
    name: 'Microsoft To Do',
    description: 'Read your To Do lists and tasks.',
    category: 'project',
    initials: 'TD',
    icon: 'CheckSquare',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/todo-list-lists',
    scopes: [{
      scope: 'https://graph.microsoft.com/Tasks.Read',
      purpose: 'List To Do lists and tasks.',
    }],
    operation: 'List To Do lists and tasks.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'planner',
    name: 'Microsoft Planner',
    description: 'Read Planner tasks assigned to you.',
    category: 'project',
    initials: 'PL',
    icon: 'CheckSquare',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/planneruser-list-tasks',
    scopes: [{
      scope: 'https://graph.microsoft.com/Tasks.Read',
      purpose: 'List Planner tasks assigned to the signed-in user.',
    }],
    operation: 'List assigned Planner tasks.',
    availability: 'confirmable',
    adminConsent: false,
    reason: CONFIRMABLE_REASON,
  },
  {
    id: 'teams-meetings',
    name: 'Teams meetings',
    description: 'Read Teams meeting records.',
    category: 'calendar',
    initials: 'TM',
    icon: 'Calendar',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/onlinemeeting-get',
    scopes: [],
    operation: 'Not available. Listing meetings needs an application access policy.',
    availability: 'blocked',
    adminConsent: true,
    reason: 'Graph onlineMeetings does not provide a user list without a meeting id or an application access policy. The connector stays hidden.',
  },
  {
    id: 'bookings',
    name: 'Microsoft Bookings',
    description: 'Read Bookings businesses and appointments.',
    category: 'calendar',
    initials: 'BK',
    icon: 'Calendar',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/bookingbusiness-list',
    scopes: [],
    operation: 'Not available. Bookings has no delegated read-only permission.',
    availability: 'blocked',
    adminConsent: true,
    reason: 'The Bookings list API uses application or read-write permissions. A read-only delegated connector is not available, so it stays hidden.',
  },
  {
    id: 'forms',
    name: 'Microsoft Forms',
    description: 'Read forms and responses.',
    category: 'files',
    initials: 'MF',
    icon: 'FileText',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/overview',
    scopes: [],
    operation: 'Not available. Microsoft Forms has no supported personal list API.',
    availability: 'blocked',
    adminConsent: false,
    reason: 'Microsoft Graph does not offer a supported API to list a user\'s Forms. The connector stays hidden.',
  },
  {
    id: 'power-bi',
    name: 'Power BI',
    description: 'List Power BI reports.',
    category: 'marketing',
    initials: 'PB',
    icon: 'BarChart3',
    docsUrl: 'https://learn.microsoft.com/en-us/rest/api/power-bi/',
    scopes: [],
    operation: 'Not available. Power BI uses a separate resource audience.',
    availability: 'blocked',
    adminConsent: true,
    reason: 'Power BI tokens are issued for analysis.windows.net, not Microsoft Graph. That separate authorization flow is not configured, so the connector stays hidden.',
  },
  {
    id: 'dynamics',
    name: 'Dynamics 365',
    description: 'Read Dynamics 365 records.',
    category: 'crm',
    initials: 'D3',
    icon: 'Users',
    docsUrl: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview',
    scopes: [],
    operation: 'Not available. Dynamics needs an environment URL.',
    availability: 'blocked',
    adminConsent: true,
    reason: 'Dataverse calls a customer environment host that is not configured. The connector stays hidden.',
  },
  {
    id: 'arm',
    name: 'Azure Resource Manager',
    description: 'List Azure subscriptions.',
    category: 'project',
    initials: 'AZ',
    icon: 'Cloud',
    docsUrl: 'https://learn.microsoft.com/en-us/rest/api/resources/',
    scopes: [],
    operation: 'Not available. Azure Resource Manager uses a separate audience.',
    availability: 'blocked',
    adminConsent: true,
    reason: 'ARM tokens are issued for management.azure.com. That resource is not part of the Graph grant, so the connector stays hidden.',
  },
  {
    id: 'devops',
    name: 'Azure DevOps',
    description: 'List Azure DevOps projects.',
    category: 'project',
    initials: 'DO',
    icon: 'CheckSquare',
    docsUrl: 'https://learn.microsoft.com/en-us/rest/api/azure/devops/',
    scopes: [],
    operation: 'Not available. Azure DevOps uses a separate resource.',
    availability: 'blocked',
    adminConsent: true,
    reason: 'Azure DevOps uses its own resource id and organization URL. Neither is configured, so the connector stays hidden.',
  },
  {
    id: 'power-platform',
    name: 'Power Platform',
    description: 'List Power Platform environments.',
    category: 'project',
    initials: 'PW',
    icon: 'SquareDot',
    docsUrl: 'https://learn.microsoft.com/en-us/power-platform/admin/programming-power-platform',
    scopes: [],
    operation: 'Not available. Power Platform uses a separate admin API.',
    availability: 'blocked',
    adminConsent: true,
    reason: 'The Power Platform admin API is a separate audience and needs tenant configuration that is not present. The connector stays hidden.',
  },
];

export function microsoftProductById(id: string): MicrosoftProductDefinition | null {
  return MICROSOFT_PRODUCTS.find((product) => product.id === id) ?? null;
}

export function requestedScopes(product: MicrosoftProductDefinition): string[] {
  return [...product.scopes.map((item) => item.scope), ...MICROSOFT_IDENTITY_SCOPES];
}

export function visibleMicrosoftProducts(confirmed: readonly string[]): MicrosoftProductDefinition[] {
  const allowed = new Set(confirmed);
  return MICROSOFT_PRODUCTS.filter((product) => product.availability === 'confirmable' && allowed.has(product.id));
}
