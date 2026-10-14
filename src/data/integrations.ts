import type { Category, Integration } from '@/types';

export const CATEGORIES: Category[] = [
  { id: 'crm', label: 'CRM & Sales' },
  { id: 'email', label: 'Email & Messaging' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'project', label: 'Project Management' },
  { id: 'files', label: 'Files & Documents' },
  { id: 'accounting', label: 'Accounting & Finance' },
  { id: 'payments', label: 'Payments' },
  { id: 'hr', label: 'HR & Payroll' },
  { id: 'support', label: 'Customer Support' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'ecommerce', label: 'E-commerce' },
];

export const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  crm: 'CRM & Sales',
  email: 'Email & Messaging',
  calendar: 'Calendar',
  project: 'Project Management',
  files: 'Files & Documents',
  accounting: 'Accounting & Finance',
  payments: 'Payments',
  hr: 'HR & Payroll',
  support: 'Customer Support',
  marketing: 'Marketing',
  ecommerce: 'E-commerce',
};

export const INTEGRATIONS: Integration[] = [
  // CRM & Sales
  { id: 'salesforce', name: 'Salesforce', description: 'Manage customer relationships and sales.', category: 'crm', color: '#00a1e0', initials: 'SF', icon: 'Cloud' },
  { id: 'hubspot', name: 'HubSpot', description: 'Manage leads, marketing and customer data.', category: 'crm', color: '#ff7a59', initials: 'HS', icon: 'Target' },
  { id: 'pipedrive', name: 'Pipedrive', description: 'Track deals and sales activities.', category: 'crm', color: '#1a1a1a', initials: 'PD', icon: 'TrendingUp' },

  // Email & Messaging
  { id: 'outlook', name: 'Microsoft Outlook', description: 'Connect email and business communications.', category: 'email', color: '#0078d4', initials: 'OL', icon: 'Inbox' },
  { id: 'slack', name: 'Slack', description: 'Connect team conversations.', category: 'email', color: '#4a154b', initials: 'SL', icon: 'MessageSquare' },
  { id: 'whatsapp', name: 'WhatsApp Business', description: 'Connect business messaging.', category: 'email', color: '#25d366', initials: 'WA', icon: 'MessageCircle' },

  // Calendar
  { id: 'outlook-calendar', name: 'Outlook Calendar', description: 'Connect work calendars.', category: 'calendar', color: '#0078d4', initials: 'OC', icon: 'CalendarDays' },
  { id: 'calendly', name: 'Calendly', description: 'Connect scheduling information.', category: 'calendar', color: '#006bff', initials: 'CL', icon: 'Clock' },

  // Project Management
  { id: 'clickup', name: 'ClickUp', description: 'Tasks, projects and team workflows.', category: 'project', color: '#7b68ee', initials: 'CU', icon: 'CheckSquare' },
  { id: 'asana', name: 'Asana', description: 'Projects and task tracking.', category: 'project', color: '#f06a6a', initials: 'AS', icon: 'ListTodo' },
  { id: 'jira', name: 'Jira', description: 'Development tasks and issues.', category: 'project', color: '#0052cc', initials: 'JR', icon: 'SquareDot' },
  { id: 'notion', name: 'Notion', description: 'Workspace information and documents.', category: 'project', color: '#111111', initials: 'NT', icon: 'FileText' },

  // Files & Documents
  { id: 'dropbox', name: 'Dropbox', description: 'Store and access shared files.', category: 'files', color: '#0061ff', initials: 'DB', icon: 'HardDrive' },
  { id: 'docusign', name: 'DocuSign', description: 'Electronic signatures and agreements.', category: 'files', color: '#f4d03f', initials: 'DS', icon: 'PenTool' },

  // Accounting & Finance
  { id: 'quickbooks', name: 'QuickBooks', description: 'Accounting and financial records.', category: 'accounting', color: '#2ca01c', initials: 'QB', icon: 'Calculator' },
  { id: 'tally', name: 'Tally', description: 'Accounting and business financial data.', category: 'accounting', color: '#1d6e7e', initials: 'TY', icon: 'Landmark' },

  // Payments
  { id: 'razorpay', name: 'Razorpay', description: 'Payment and transaction information.', category: 'payments', color: '#3395ff', initials: 'RP', icon: 'CreditCard' },
  { id: 'cashfree', name: 'Cashfree', description: 'Payment and payout information.', category: 'payments', color: '#5b2dd4', initials: 'CF', icon: 'IndianRupee' },
  { id: 'stripe', name: 'Stripe', description: 'Payments and billing.', category: 'payments', color: '#635bff', initials: 'ST', icon: 'CreditCard' },

  // HR & Payroll
  { id: 'greythr', name: 'greytHR', description: 'Payroll and attendance.', category: 'hr', color: '#f47b20', initials: 'GT', icon: 'BadgeCheck' },
  { id: 'keka', name: 'Keka', description: 'HR and workforce management.', category: 'hr', color: '#ff6b6b', initials: 'KK', icon: 'Briefcase' },

  // Customer Support
  { id: 'zendesk', name: 'Zendesk', description: 'Customer support tickets.', category: 'support', color: '#03363d', initials: 'ZD', icon: 'LifeBuoy' },
  { id: 'freshdesk', name: 'Freshdesk', description: 'Customer service operations.', category: 'support', color: '#fc6d26', initials: 'FD', icon: 'Headset' },
  // Marketing
  { id: 'mailchimp', name: 'Mailchimp', description: 'Email campaigns and audience information.', category: 'marketing', color: '#ffe01b', initials: 'MC', icon: 'Send' },
  { id: 'meta-ads', name: 'Meta Ads', description: 'Advertising campaign performance.', category: 'marketing', color: '#0467df', initials: 'MA', icon: 'BarChart3' },
  { id: 'google-ads', name: 'Google Ads', description: 'Paid advertising performance.', category: 'marketing', color: '#4285f4', initials: 'GA', icon: 'Megaphone' },

  // E-commerce
  { id: 'shopify', name: 'Shopify', description: 'Orders and store information.', category: 'ecommerce', color: '#5e8e3e', initials: 'SH', icon: 'ShoppingBag' },
  { id: 'shiprocket', name: 'Shiprocket', description: 'Shipping and delivery information.', category: 'ecommerce', color: '#1a73e8', initials: 'SR', icon: 'Package' },
];
