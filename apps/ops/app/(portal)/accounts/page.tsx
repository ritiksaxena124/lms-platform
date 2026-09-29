import type { Metadata } from 'next';
import { PageHeader, RouteTransition } from '@lms/ui';

import { AccountTable } from '@/components/account-table';

export const metadata: Metadata = {
  title: 'Accounts',
  description: 'Find an account, disable it, and issue or revoke the ops role.',
};

/**
 * The accounts screen: the two writes this platform gives an operator, and the reason the ops role
 * exists at all.
 *
 * Phase 7 built a ledger and guarded it by a role nothing could issue. This page is what makes
 * issuing it a thing a person does from a chair rather than a thing a deploy script does — which is
 * also why the row you are standing in is named and not editable.
 */
export default function AccountsPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Accounts"
        description="Who may sign in, and who may open a portal. Everything else about an account belongs to its own person."
        meta="Two writes · a status and a role · each one recorded in the ledger beside the row it moved"
      />
      <div className="mt-8">
        <AccountTable />
      </div>
    </RouteTransition>
  );
}
