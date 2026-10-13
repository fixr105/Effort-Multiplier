export type CategoryId =
  | 'crm'
  | 'email'
  | 'calendar'
  | 'project'
  | 'files'
  | 'accounting'
  | 'payments'
  | 'hr'
  | 'support'
  | 'marketing'
  | 'ecommerce';

export interface Category {
  id: CategoryId;
  label: string;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  /** Brand color used for the icon tile */
  color: string;
  /** Two-letter or short abbreviation shown on the icon tile */
  initials: string;
  /** Lucide icon name used as a fallback / decorative icon */
  icon: string;
}

export type ConnectionState = Record<string, boolean>;

export interface FilterChip {
  id: string;
  label: string;
}
