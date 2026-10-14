import type { CategoryId } from '../src/types.ts';

export const GOOGLE_IDENTITY_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export type GoogleProductId =
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'docs'
  | 'sheets'
  | 'slides'
  | 'forms'
  | 'tasks'
  | 'people'
  | 'chat'
  | 'meet'
  | 'admin'
  | 'analytics'
  | 'search-console'
  | 'apps-script'
  | 'workspace-events';

export type ScopeClass = 'non-sensitive' | 'sensitive' | 'restricted';

export interface GoogleScope {
  scope: string;
  classification: ScopeClass;
  purpose: string;
}

export interface GoogleProductDefinition {
  id: GoogleProductId;
  name: string;
  description: string;
  category: CategoryId;
  initials: string;
  icon: string;
  docsUrl: string;
  service: string;
  version: string;
  cloudApi: string;
  scopes: readonly GoogleScope[];
  operation: string;
  availability: 'confirmable' | 'blocked';
  reason: string;
  workspaceAdmin: boolean;
  billing: string;
  verification: string;
}

const CONFIRMABLE_REASON =
  'Shown after an administrator sets this id in GOOGLE_CONFIRMED_PRODUCTS. That value is the trusted confirmation that the named Google Cloud API is enabled. This app cannot see Cloud API enablement without administrator credentials, and it does not ask for those credentials.';

export const GOOGLE_PRODUCTS: readonly GoogleProductDefinition[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Search and read metadata for messages you authorize.',
    category: 'email',
    initials: 'GM',
    icon: 'Mail',
    docsUrl: 'https://developers.google.com/workspace/gmail/api/auth/scopes',
    service: 'Gmail API',
    version: 'v1',
    cloudApi: 'gmail.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/gmail.metadata',
        classification: 'restricted',
        purpose: 'List messages and read headers such as Subject, From, and Date. Message bodies are not requested.',
      },
    ],
    operation: 'List recent messages and read their metadata.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Gmail API has no separate billing charge for this read.',
    verification: 'Restricted scope. Google verification and a security assessment are required before unverified users can grant it. This app has not completed that review. In testing mode only listed test users can consent.',
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    description: 'Read calendars and upcoming events you can access.',
    category: 'calendar',
    initials: 'GC',
    icon: 'Calendar',
    docsUrl: 'https://developers.google.com/workspace/calendar/api/auth',
    service: 'Google Calendar API',
    version: 'v3',
    cloudApi: 'calendar-json.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        classification: 'sensitive',
        purpose: 'List calendars and upcoming events.',
      },
    ],
    operation: 'List calendars and upcoming events.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Calendar API has no separate billing charge for this read.',
    verification: 'Sensitive scope. Google verification is required for a public app. This review is not complete. Testing mode limits consent to test users.',
  },
  {
    id: 'drive',
    name: 'Google Drive',
    description: 'Search files and read their metadata.',
    category: 'files',
    initials: 'GD',
    icon: 'Folder',
    docsUrl: 'https://developers.google.com/workspace/drive/api/guides/api-specific-auth',
    service: 'Google Drive API',
    version: 'v3',
    cloudApi: 'drive.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
        classification: 'restricted',
        purpose: 'List accessible files and read metadata. File contents are not downloaded.',
      },
    ],
    operation: 'List accessible file names and types.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Drive API has no separate billing charge for this metadata read.',
    verification: 'Restricted scope. Verification and a security assessment are required for public use and are not complete.',
  },
  {
    id: 'docs',
    name: 'Google Docs',
    description: 'Find a document and read its title.',
    category: 'files',
    initials: 'DO',
    icon: 'FileText',
    docsUrl: 'https://developers.google.com/docs/api/reference/rest/v1/documents/get',
    service: 'Google Docs API',
    version: 'v1',
    cloudApi: 'docs.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/documents.readonly',
        classification: 'sensitive',
        purpose: 'Read a document the account can open.',
      },
      {
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
        classification: 'restricted',
        purpose: 'Find a document. The Docs API does not list a user\'s files.',
      },
    ],
    operation: 'Find one document and read its title.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Docs API has no separate billing charge for this read.',
    verification: 'Includes a restricted Drive scope. Verification and a security assessment are not complete. Editing is not requested.',
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    description: 'Find a spreadsheet and read a small range.',
    category: 'files',
    initials: 'SH',
    icon: 'FileText',
    docsUrl: 'https://developers.google.com/sheets/api/guides/concepts',
    service: 'Google Sheets API',
    version: 'v4',
    cloudApi: 'sheets.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        classification: 'sensitive',
        purpose: 'Read values from a spreadsheet.',
      },
      {
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
        classification: 'restricted',
        purpose: 'Find a spreadsheet. The Sheets API does not list a user\'s files.',
      },
    ],
    operation: 'Find one spreadsheet and read A1:E5.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Sheets API has no separate billing charge for this read.',
    verification: 'Includes a restricted Drive scope. Verification and a security assessment are not complete. Cell edits are not requested.',
  },
  {
    id: 'slides',
    name: 'Google Slides',
    description: 'Find a presentation and read its title.',
    category: 'files',
    initials: 'SL',
    icon: 'FileText',
    docsUrl: 'https://developers.google.com/slides/api/reference/rest/v1/presentations/get',
    service: 'Google Slides API',
    version: 'v1',
    cloudApi: 'slides.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/presentations.readonly',
        classification: 'sensitive',
        purpose: 'Read presentation metadata.',
      },
      {
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
        classification: 'restricted',
        purpose: 'Find a presentation. The Slides API does not list a user\'s files.',
      },
    ],
    operation: 'Find one presentation and read its title.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Slides API has no separate billing charge for this read.',
    verification: 'Includes a restricted Drive scope. Verification and a security assessment are not complete. Slide edits are not requested.',
  },
  {
    id: 'forms',
    name: 'Google Forms',
    description: 'Find a form and read its title and response count.',
    category: 'files',
    initials: 'FO',
    icon: 'FileText',
    docsUrl: 'https://developers.google.com/forms/api/reference/rest/v1/forms/get',
    service: 'Google Forms API',
    version: 'v1',
    cloudApi: 'forms.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/forms.body.readonly',
        classification: 'sensitive',
        purpose: 'Read a form title.',
      },
      {
        scope: 'https://www.googleapis.com/auth/forms.responses.readonly',
        classification: 'sensitive',
        purpose: 'Read a short list of form responses.',
      },
      {
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
        classification: 'restricted',
        purpose: 'Find a form. The Forms API does not list a user\'s forms.',
      },
    ],
    operation: 'Find one form and list up to five responses.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Forms API has no separate billing charge for this read.',
    verification: 'Includes a restricted Drive scope. Verification and a security assessment are not complete.',
  },
  {
    id: 'tasks',
    name: 'Google Tasks',
    description: 'Read task lists and tasks.',
    category: 'project',
    initials: 'GT',
    icon: 'CheckSquare',
    docsUrl: 'https://developers.google.com/tasks/reference/rest/v1/tasks/list',
    service: 'Google Tasks API',
    version: 'v1',
    cloudApi: 'tasks.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/tasks.readonly',
        classification: 'sensitive',
        purpose: 'List task lists and tasks. Completion and edits are not requested.',
      },
    ],
    operation: 'List task lists and tasks.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Tasks API has no separate billing charge for this read.',
    verification: 'Reads personal task content. Treat it as sensitive on the consent screen. Public verification is not complete.',
  },
  {
    id: 'people',
    name: 'Google Contacts',
    description: 'Read names and email addresses from contacts you allow.',
    category: 'crm',
    initials: 'GP',
    icon: 'Users',
    docsUrl: 'https://developers.google.com/people/api/rest/v1/people.connections/list',
    service: 'People API',
    version: 'v1',
    cloudApi: 'people.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        classification: 'sensitive',
        purpose: 'Read contact names and email addresses.',
      },
    ],
    operation: 'List contact names and email addresses.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'People API has no separate billing charge for this read.',
    verification: 'Sensitive scope. Public verification is not complete. Contact creation is not requested.',
  },
  {
    id: 'chat',
    name: 'Google Chat',
    description: 'Read Chat spaces the app has joined.',
    category: 'email',
    initials: 'CH',
    icon: 'MessageSquare',
    docsUrl: 'https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces/list',
    service: 'Google Chat API',
    version: 'v1',
    cloudApi: 'chat.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/chat.spaces.readonly',
        classification: 'sensitive',
        purpose: 'List spaces. This deployment has no Chat app installed in any space.',
      },
    ],
    operation: 'Not available. Chat only returns spaces that contain this app.',
    availability: 'blocked',
    reason: 'Google Chat requires a configured Chat app and membership in each space. This deployment has neither, so the connector stays hidden.',
    workspaceAdmin: true,
    billing: 'No billing configuration is present.',
    verification: 'Workspace app configuration is required. It is not set up.',
  },
  {
    id: 'meet',
    name: 'Google Meet',
    description: 'Read conference records for meetings you organized.',
    category: 'calendar',
    initials: 'MT',
    icon: 'Calendar',
    docsUrl: 'https://developers.google.com/workspace/meet/api/guides/overview',
    service: 'Google Meet API',
    version: 'v2',
    cloudApi: 'meet.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/meetings.space.readonly',
        classification: 'sensitive',
        purpose: 'List conference records. Recordings, transcripts, and arbitrary meeting content are not requested.',
      },
    ],
    operation: 'List recent conference records.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Meet API has no separate billing charge for listing conference records.',
    verification: 'Sensitive scope. The API does not provide recordings or transcripts through this scope. Public verification is not complete.',
  },
  {
    id: 'admin',
    name: 'Google Admin SDK',
    description: 'Read directory users for a Workspace domain.',
    category: 'hr',
    initials: 'AD',
    icon: 'Users',
    docsUrl: 'https://developers.google.com/admin-sdk/directory/v1/guides',
    service: 'Admin SDK Directory API',
    version: 'directory_v1',
    cloudApi: 'admin.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
        classification: 'sensitive',
        purpose: 'List domain users. Consumer accounts cannot call this API.',
      },
    ],
    operation: 'Not available. Administrator access is not configured.',
    availability: 'blocked',
    reason: 'Directory reads require a Workspace administrator. Domain-wide delegation is not configured, and ordinary Google accounts cannot use this API.',
    workspaceAdmin: true,
    billing: 'No billing configuration is present.',
    verification: 'Administrator consent is required. It is not configured.',
  },
  {
    id: 'analytics',
    name: 'Google Analytics',
    description: 'List Analytics accounts and properties you can access.',
    category: 'marketing',
    initials: 'AN',
    icon: 'BarChart3',
    docsUrl: 'https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list',
    service: 'Google Analytics Admin API',
    version: 'v1beta',
    cloudApi: 'analyticsadmin.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        classification: 'sensitive',
        purpose: 'List account summaries for properties the user can access.',
      },
    ],
    operation: 'List Analytics account summaries.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Analytics Admin API has no separate billing charge for listing properties. A property the user can access is still required.',
    verification: 'Sensitive scope. Public verification is not complete. An empty list means the account has no accessible property.',
  },
  {
    id: 'search-console',
    name: 'Google Search Console',
    description: 'List Search Console sites you can access.',
    category: 'marketing',
    initials: 'SC',
    icon: 'BarChart3',
    docsUrl: 'https://developers.google.com/webmaster-tools/v1/sites/list',
    service: 'Search Console API',
    version: 'v3',
    cloudApi: 'searchconsole.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/webmasters.readonly',
        classification: 'sensitive',
        purpose: 'List sites. Performance queries are not requested.',
      },
    ],
    operation: 'List verified sites.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Search Console API has no separate billing charge for listing sites.',
    verification: 'Sensitive scope. Public verification is not complete.',
  },
  {
    id: 'apps-script',
    name: 'Google Apps Script',
    description: 'List Apps Script projects you own.',
    category: 'project',
    initials: 'AS',
    icon: 'FileText',
    docsUrl: 'https://developers.google.com/apps-script/api/reference/rest/v1/projects/list',
    service: 'Apps Script API',
    version: 'v1',
    cloudApi: 'script.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/script.projects.readonly',
        classification: 'sensitive',
        purpose: 'List script projects. Script execution is not requested.',
      },
    ],
    operation: 'List Apps Script projects.',
    availability: 'confirmable',
    reason: CONFIRMABLE_REASON,
    workspaceAdmin: false,
    billing: 'Apps Script API has no separate billing charge for listing projects.',
    verification: 'Sensitive scope. Execution would need a separate script authorization and is not implemented. Public verification is not complete.',
  },
  {
    id: 'workspace-events',
    name: 'Google Workspace Events',
    description: 'Subscribe to Workspace event notifications.',
    category: 'project',
    initials: 'WE',
    icon: 'Calendar',
    docsUrl: 'https://developers.google.com/workspace/events/guides/overview',
    service: 'Google Workspace Events API',
    version: 'v1',
    cloudApi: 'workspaceevents.googleapis.com',
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/workspace.events.subscriptions',
        classification: 'sensitive',
        purpose: 'Manage event subscriptions. A Pub/Sub topic and renewal job are required and are not configured.',
      },
    ],
    operation: 'Not available. Subscription infrastructure is not configured.',
    availability: 'blocked',
    reason: 'Workspace Events needs a Cloud Pub/Sub topic, a subscription, and renewal handling. None of that is configured, so the connector stays hidden.',
    workspaceAdmin: true,
    billing: 'Pub/Sub billing is not configured.',
    verification: 'Workspace and Cloud prerequisites are not met.',
  },
];

export function googleProductById(id: string): GoogleProductDefinition | null {
  return GOOGLE_PRODUCTS.find((product) => product.id === id) ?? null;
}

export function requestedScopes(product: GoogleProductDefinition): string[] {
  return [...product.scopes.map((item) => item.scope), ...GOOGLE_IDENTITY_SCOPES];
}

export function visibleGoogleProducts(confirmed: readonly string[]): GoogleProductDefinition[] {
  const allowed = new Set(confirmed);
  return GOOGLE_PRODUCTS.filter((product) => product.availability === 'confirmable' && allowed.has(product.id));
}
