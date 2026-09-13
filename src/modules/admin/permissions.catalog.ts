export type PermissionKey =
  | 'users.view'
  | 'users.manage'
  | 'users.export'
  | 'providers.view'
  | 'providers.verify'
  | 'providers.manage'
  | 'providers.export'
  | 'bookings.view'
  | 'bookings.export'
  | 'issues.view'
  | 'issues.resolve'
  | 'payments.view'
  | 'payments.withdrawals'
  | 'payments.export'
  | 'analytics.view'
  | 'analytics.export'
  | 'audit.view'
  | 'support.view'
  | 'system.view'
  | 'system.manage'
  | 'settings.view'
  | 'settings.update'
  | 'access.view'
  | 'access.manage';

export const PERMISSION_GROUPS: {
  module: string;
  label: string;
  hint: string;
  actions: { key: PermissionKey; label: string; hint: string }[];
}[] = [
  {
    module: 'users',
    label: 'Users',
    hint: 'Customer accounts',
    actions: [
      { key: 'users.view', label: 'View customers', hint: 'Open the Users tab and profiles' },
      { key: 'users.manage', label: 'Deactivate / restore', hint: 'Change customer access' },
      { key: 'users.export', label: 'Export register', hint: 'Download customer reports' },
    ],
  },
  {
    module: 'providers',
    label: 'Providers',
    hint: 'Listings and access',
    actions: [
      { key: 'providers.view', label: 'View providers', hint: 'Open the Providers tab and profiles' },
      { key: 'providers.verify', label: 'Verify KYC', hint: 'Approve providers whose identity check is under review' },
      { key: 'providers.manage', label: 'Block / restore', hint: 'Change provider access' },
      { key: 'providers.export', label: 'Export register', hint: 'Download provider reports' },
    ],
  },
  {
    module: 'bookings',
    label: 'Bookings',
    hint: 'Errand pipeline',
    actions: [
      { key: 'bookings.view', label: 'View bookings', hint: 'Open the Bookings tab' },
      { key: 'bookings.export', label: 'Export bookings', hint: 'Download booking reports' },
    ],
  },
  {
    module: 'issues',
    label: 'Issues',
    hint: 'Trust and quality cases',
    actions: [
      { key: 'issues.view', label: 'View issues', hint: 'Open the Issues tab' },
      { key: 'issues.resolve', label: 'Resolve issues', hint: 'Close or decide cases' },
    ],
  },
  {
    module: 'payments',
    label: 'Payments',
    hint: 'Payouts and settlements',
    actions: [
      { key: 'payments.view', label: 'View payments', hint: 'Open the Payments tab' },
      { key: 'payments.withdrawals', label: 'Process withdrawals', hint: 'Approve or reject payouts' },
      { key: 'payments.export', label: 'Export payments', hint: 'Download invoices and reports' },
    ],
  },
  {
    module: 'analytics',
    label: 'Analytics & Performance',
    hint: 'Finance and marketplace insights',
    actions: [
      { key: 'analytics.view', label: 'View analytics', hint: 'Open insights and reports' },
      { key: 'analytics.export', label: 'Export reports', hint: 'Download performance PDFs' },
    ],
  },
  {
    module: 'audit',
    label: 'Audit logs',
    hint: 'Administrator and client activity',
    actions: [
      { key: 'audit.view', label: 'View audit logs', hint: 'Inspect recorded actions' },
    ],
  },
  {
    module: 'support',
    label: 'Support',
    hint: 'Tickets and FAQ',
    actions: [
      { key: 'support.view', label: 'View support', hint: 'Open tickets and help content' },
    ],
  },
  {
    module: 'system',
    label: 'System',
    hint: 'Health, app and website control',
    actions: [
      { key: 'system.view', label: 'View system', hint: 'Open health and monitoring' },
      { key: 'system.manage', label: 'Manage live apps', hint: 'Publish branding, copy and restore points' },
    ],
  },
  {
    module: 'settings',
    label: 'Settings',
    hint: 'Platform configuration',
    actions: [
      { key: 'settings.view', label: 'View settings', hint: 'Open platform configuration' },
      { key: 'settings.update', label: 'Update settings', hint: 'Change commission, payments, security' },
    ],
  },
  {
    module: 'access',
    label: 'Access control',
    hint: 'Admins, roles and invites',
    actions: [
      { key: 'access.view', label: 'View team', hint: 'See administrators and roles' },
      { key: 'access.manage', label: 'Manage team', hint: 'Invite admins and edit roles' },
    ],
  },
];

export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_GROUPS.flatMap((group) =>
  group.actions.map((action) => action.key),
);

export const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function slugifyRoleName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function uniquePermissions(keys: string[]): PermissionKey[] {
  const next = new Set<PermissionKey>();
  for (const key of keys) {
    if (PERMISSION_SET.has(key)) next.add(key as PermissionKey);
  }
  return [...next];
}
