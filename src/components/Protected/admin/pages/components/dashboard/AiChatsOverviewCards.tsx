'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { formatActiveProviderSummary, isAssistantConfigured } from '@/services/aiSettings';
import { useAdminAiSettingsQuery } from '@/hooks/useAiSettings';
import {
  FASHION_CHAT_PAGE_SIZE,
  useAdminFashionChatsQuery,
} from '@/hooks/useAdminFashionChats';
import { isStorefrontOrgSession } from '@/services/auth';

export default function AiChatsOverviewCards() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canAi = can(P.AiManage) && isStorefrontOrgSession(user);
  const canAiChats = can(P.AiChatsRead);

  const ai = useAdminAiSettingsQuery(canAi);
  const chats = useAdminFashionChatsQuery(canAiChats, {
    page: 1,
    limit: FASHION_CHAT_PAGE_SIZE,
  });

  if (!canAi && !canAiChats) return null;

  const aiValue = ai.isError
    ? 'Unavailable'
    : ai.isLoading
      ? '…'
      : ai.data?.botName || 'StyleForge AI';

  const assistantReady = ai.data ? isAssistantConfigured(ai.data) : true;

  const aiDetail = ai.isLoading || ai.isError
    ? 'Open settings to manage the assistant.'
    : [
        formatActiveProviderSummary(ai.data),
        ai.data?.usePublicData
          ? 'General fashion knowledge on'
          : 'Catalog-only answers',
        !assistantReady ? 'Setup required' : null,
      ]
        .filter(Boolean)
        .join(' · ');

  const handoffs = chats.data?.stats.handoffCount;
  const waiting = chats.data?.stats.waitingCount;
  const chatsValue = chats.isError
    ? 'Unavailable'
    : chats.isLoading
      ? '…'
      : `${handoffs ?? 0} handoff${handoffs === 1 ? '' : 's'}`;

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-3">AI Chats</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {canAiChats && (
          <AdminPendingLink
            href="/admin/ai-chats"
            className="block bg-white p-6 rounded-lg border border-gray-200 hover:border-[#D4AF37]/40 transition-colors"
          >
            <p className="text-sm font-medium text-gray-600">Conversations</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{chatsValue}</p>
            <p className="text-sm text-gray-500 mt-1">
              {chats.isLoading || chats.isError
                ? 'Open the inbox for customer history and staff replies.'
                : `${waiting ?? 0} waiting on staff · contacts, handoffs, and replies.`}
            </p>
          </AdminPendingLink>
        )}
        {canAi && (
          <AdminPendingLink
            href="/admin/ai-settings"
            className={`block bg-white p-6 rounded-lg border transition-colors ${
              !assistantReady && !ai.isLoading && !ai.isError
                ? 'border-amber-300 hover:border-amber-400'
                : 'border-gray-200 hover:border-[#D4AF37]/40'
            }`}
          >
            <p className="text-sm font-medium text-gray-600">Assistant settings</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{aiValue}</p>
            <p className="text-sm text-gray-500 mt-1">{aiDetail}</p>
          </AdminPendingLink>
        )}
      </div>
    </section>
  );
}
